import type { RoomStatus } from '@hms/shared';

import { Prisma, type PrismaClient } from '../../generated/prisma/client.js';

export interface CurrentStayRecord {
  stayId: number;
  guestName: string;
  checkInAt: Date;
  expectedCheckOutDate: Date;
}

export interface RoomRecord {
  id: number;
  roomNumber: string;
  roomTypeId: number;
  roomTypeName: string;
  status: RoomStatus;
  note: string | null;
  currentStay: CurrentStayRecord | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface RoomListParams {
  status?: RoomStatus;
  roomTypeId?: number;
  roomNumberPrefix?: string;
  page: number;
  pageSize: number;
  orderBy: Array<Record<string, 'asc' | 'desc'>>;
}

export interface RoomListResult {
  items: RoomRecord[];
  total: number;
}

export interface AvailableRoomRecord {
  id: number;
  roomNumber: string;
  status: RoomStatus;
}

export interface CreateRoomData {
  roomNumber: string;
  roomTypeId: number;
  note?: string | undefined;
}

export interface UpdateRoomData {
  roomNumber?: string | undefined;
  roomTypeId?: number | undefined;
  note?: string | undefined;
}

export type CreateRoomOutcome =
  | { outcome: 'created'; room: RoomRecord }
  | { outcome: 'room_type_not_found' }
  | { outcome: 'room_type_archived' };

export type UpdateRoomOutcome =
  | { outcome: 'updated'; room: RoomRecord }
  | { outcome: 'not_found' }
  | { outcome: 'occupied_restricted' }
  | { outcome: 'room_type_not_found' }
  | { outcome: 'room_type_archived' }
  /** 预读房型与加锁后不一致（并发修改房型）：要求调用方刷新重试 */
  | { outcome: 'room_changed' };

export type UpdateRoomStatusOutcome =
  { outcome: 'updated'; room: RoomRecord } | { outcome: 'not_found' } | { outcome: 'conflict' };

export interface RoomsRepository {
  list(params: RoomListParams): Promise<RoomListResult>;
  findById(id: number): Promise<RoomRecord | null>;
  create(data: CreateRoomData): Promise<CreateRoomOutcome>;
  update(id: number, data: UpdateRoomData): Promise<UpdateRoomOutcome>;
  updateStatus(
    id: number,
    roomTypeId: number,
    from: RoomStatus,
    to: RoomStatus,
  ): Promise<UpdateRoomStatusOutcome>;
  listAvailable(params: {
    roomTypeId: number;
    checkInDate: Date;
    checkOutDate: Date;
  }): Promise<AvailableRoomRecord[]>;
}

type RoomRow = {
  id: bigint;
  roomNumber: string;
  roomTypeId: bigint;
  status: string;
  note: string | null;
  createdAt: Date;
  updatedAt: Date;
  roomType: { name: string };
};

type StayRow = {
  id: bigint;
  checkInAt: Date;
  expectedCheckOutDate: Date;
  guest: { name: string };
};

const staySelect = {
  id: true,
  checkInAt: true,
  expectedCheckOutDate: true,
  guest: { select: { name: true } },
} as const;

function mapRoom(row: RoomRow, stay: StayRow | null): RoomRecord {
  return {
    id: Number(row.id),
    roomNumber: row.roomNumber,
    roomTypeId: Number(row.roomTypeId),
    roomTypeName: row.roomType.name,
    status: row.status as RoomStatus,
    note: row.note,
    currentStay:
      stay === null
        ? null
        : {
            stayId: Number(stay.id),
            guestName: stay.guest.name,
            checkInAt: stay.checkInAt,
            expectedCheckOutDate: stay.expectedCheckOutDate,
          },
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function createRoomsRepository(prisma: PrismaClient): RoomsRepository {
  return {
    async list(params) {
      const where: Prisma.RoomWhereInput = {
        ...(params.status === undefined ? {} : { status: params.status }),
        ...(params.roomTypeId === undefined ? {} : { roomTypeId: params.roomTypeId }),
        ...(params.roomNumberPrefix === undefined
          ? {}
          : { roomNumber: { startsWith: params.roomNumberPrefix } }),
      };

      const [total, rows] = await Promise.all([
        prisma.room.count({ where }),
        prisma.room.findMany({
          where,
          include: { roomType: { select: { name: true } } },
          orderBy: params.orderBy as unknown as Prisma.RoomOrderByWithRelationInput[],
          skip: (params.page - 1) * params.pageSize,
          take: params.pageSize,
        }),
      ]);

      const occupiedIds = rows.filter((room) => room.status === 'OCCUPIED').map((room) => room.id);
      const stays =
        occupiedIds.length === 0
          ? []
          : await prisma.stay.findMany({
              where: { roomId: { in: occupiedIds }, status: 'CHECKED_IN' },
              select: { ...staySelect, roomId: true },
            });
      const stayByRoomId = new Map(stays.map((stay) => [Number(stay.roomId), stay]));

      return {
        total,
        items: rows.map((room) => mapRoom(room, stayByRoomId.get(Number(room.id)) ?? null)),
      };
    },

    async findById(id) {
      const room = await prisma.room.findUnique({
        where: { id },
        include: { roomType: { select: { name: true } } },
      });
      if (room === null) {
        return null;
      }
      if (room.status !== 'OCCUPIED') {
        return mapRoom(room, null);
      }
      const stay = await prisma.stay.findFirst({
        where: { roomId: id, status: 'CHECKED_IN' },
        select: staySelect,
      });
      return mapRoom(room, stay);
    },

    async create(data) {
      // 事务内先锁房型行（database-design §6.1 对称规则：新建房间影响可售房数）
      return prisma.$transaction(async (tx) => {
        const locked = await tx.$queryRaw<Array<{ id: bigint; status: string }>>`
          SELECT id, status FROM room_types WHERE id = ${data.roomTypeId} FOR UPDATE`;
        const roomTypeRow = locked[0];
        if (roomTypeRow === undefined) {
          return { outcome: 'room_type_not_found' };
        }
        if (roomTypeRow.status === 'ARCHIVED') {
          return { outcome: 'room_type_archived' };
        }

        const room = await tx.room.create({
          data: {
            roomNumber: data.roomNumber,
            roomTypeId: data.roomTypeId,
            note: data.note,
          },
          include: { roomType: { select: { name: true } } },
        });
        return { outcome: 'created', room: mapRoom(room, null) };
      });
    },

    async update(id, data) {
      return prisma.$transaction(
        async (tx) => {
          // 全局锁序 room_types → rooms（与预订/入住/房量操作一致，审查 A-1）：
          // 先无锁预读当前房型，用于按序（升序）获取涉及的房型行锁，再锁房间行并复核，
          // 避免与 walk-in 的 room_types → rooms 顺序形成死锁。
          // 注意：预读会建立 RR 快照，故本事务使用 READ COMMITTED，保证加锁后的
          // 目标房型校验（存在/归档）读取最新已提交数据。
          const preRead = await tx.$queryRaw<Array<{ room_type_id: bigint }>>`
            SELECT room_type_id FROM rooms WHERE id = ${id}`;
          const preReadRow = preRead[0];
          if (preReadRow === undefined) {
            return { outcome: 'not_found' };
          }
          const preReadRoomTypeId = Number(preReadRow.room_type_id);
          const changesRoomTypeRequested =
            data.roomTypeId !== undefined && data.roomTypeId !== preReadRoomTypeId;
          if (changesRoomTypeRequested) {
            // 同时锁定旧/新房型行（升序避免死锁），保证可售房数统计一致
            const roomTypeIds = [...new Set([preReadRoomTypeId, data.roomTypeId!])].sort(
              (left, right) => left - right,
            );
            for (const roomTypeId of roomTypeIds) {
              await tx.$queryRaw`SELECT id FROM room_types WHERE id = ${roomTypeId} FOR UPDATE`;
            }
          }

          // 行锁串行化与入住/退房事务的房间操作（database-design §6.2）
          const locked = await tx.$queryRaw<
            Array<{ id: bigint; room_number: string; status: string; room_type_id: bigint }>
          >`SELECT id, room_number, status, room_type_id FROM rooms WHERE id = ${id} FOR UPDATE`;
          const current = locked[0];
          if (current === undefined) {
            return { outcome: 'not_found' };
          }
          if (Number(current.room_type_id) !== preReadRoomTypeId) {
            // 预读与加锁之间房型被修改：本次持锁的房型集合可能不完整，要求刷新重试
            return { outcome: 'room_changed' };
          }

          const changesRoomNumber =
            data.roomNumber !== undefined && data.roomNumber !== current.room_number;
          const changesRoomType =
            data.roomTypeId !== undefined && data.roomTypeId !== Number(current.room_type_id);
          if (current.status === 'OCCUPIED' && (changesRoomNumber || changesRoomType)) {
            return { outcome: 'occupied_restricted' };
          }

          if (changesRoomType && data.roomTypeId !== undefined) {
            const targetType = await tx.roomType.findUnique({ where: { id: data.roomTypeId } });
            if (targetType === null) {
              return { outcome: 'room_type_not_found' };
            }
            if (targetType.status === 'ARCHIVED') {
              return { outcome: 'room_type_archived' };
            }
          }

          const room = await tx.room.update({
            where: { id },
            data: {
              ...(data.roomNumber === undefined ? {} : { roomNumber: data.roomNumber }),
              ...(data.roomTypeId === undefined ? {} : { roomTypeId: data.roomTypeId }),
              ...(data.note === undefined ? {} : { note: data.note }),
            },
            include: { roomType: { select: { name: true } } },
          });
          return { outcome: 'updated', room: mapRoom(room, null) };
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted },
      );
    },

    async updateStatus(id, roomTypeId, from, to) {
      return prisma.$transaction(async (tx) => {
        // 进入/退出维修与停用影响可售房数：先锁房型行（database-design §6.1 对称规则）
        await tx.$queryRaw`SELECT id FROM room_types WHERE id = ${roomTypeId} FOR UPDATE`;

        const result = await tx.room.updateMany({
          where: { id, status: from },
          data: { status: to },
        });
        if (result.count === 0) {
          const exists = await tx.room.findUnique({ where: { id }, select: { id: true } });
          return exists === null ? { outcome: 'not_found' } : { outcome: 'conflict' };
        }

        const room = await tx.room.findUniqueOrThrow({
          where: { id },
          include: { roomType: { select: { name: true } } },
        });
        return { outcome: 'updated', room: mapRoom(room, null) };
      });
    },

    async listAvailable(params) {
      const rooms = await prisma.room.findMany({
        where: {
          roomTypeId: params.roomTypeId,
          status: { in: ['VACANT_CLEAN', 'VACANT_DIRTY'] },
          occupancy: { none: { date: { gte: params.checkInDate, lt: params.checkOutDate } } },
        },
        select: { id: true, roomNumber: true, status: true },
        orderBy: { roomNumber: 'asc' },
      });
      return rooms.map((room) => ({
        id: Number(room.id),
        roomNumber: room.roomNumber,
        status: room.status as RoomStatus,
      }));
    },
  };
}

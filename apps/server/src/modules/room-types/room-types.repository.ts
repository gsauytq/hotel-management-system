import type { RoomTypeStatus } from '@hms/shared';

import { Prisma, type PrismaClient } from '../../generated/prisma/client.js';

export interface RoomTypeRecord {
  id: number;
  code: string;
  name: string;
  basePrice: number;
  capacity: number;
  description: string | null;
  status: RoomTypeStatus;
  /** 未停用（status != DISABLED）房间数 */
  roomCount: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateRoomTypeData {
  code: string;
  name: string;
  basePrice: number;
  capacity: number;
  description?: string | undefined;
}

export interface UpdateRoomTypeData {
  name?: string | undefined;
  basePrice?: number | undefined;
  capacity?: number | undefined;
  description?: string | undefined;
}

export type ArchiveRoomTypeOutcome =
  | { outcome: 'archived'; roomType: RoomTypeRecord }
  | { outcome: 'not_found' }
  | { outcome: 'already_archived' }
  | { outcome: 'referenced'; confirmedBookings: number; checkedInStays: number };

export interface RoomTypesRepository {
  list(filter: { status?: RoomTypeStatus }): Promise<RoomTypeRecord[]>;
  findById(id: number): Promise<RoomTypeRecord | null>;
  create(data: CreateRoomTypeData): Promise<RoomTypeRecord>;
  update(id: number, data: UpdateRoomTypeData): Promise<RoomTypeRecord | null>;
  archive(id: number): Promise<ArchiveRoomTypeOutcome>;
}

type RoomTypeRow = {
  id: bigint;
  code: string;
  name: string;
  basePrice: Prisma.Decimal;
  capacity: number;
  description: string | null;
  status: string;
  createdAt: Date;
  updatedAt: Date;
};

function mapRoomType(row: RoomTypeRow, roomCount: number): RoomTypeRecord {
  return {
    id: Number(row.id),
    code: row.code,
    name: row.name,
    basePrice: row.basePrice.toNumber(),
    capacity: row.capacity,
    description: row.description,
    status: row.status as RoomTypeStatus,
    roomCount,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function createRoomTypesRepository(prisma: PrismaClient): RoomTypesRepository {
  async function countUsableRooms(roomTypeId: number): Promise<number> {
    return prisma.room.count({
      where: { roomTypeId, status: { not: 'DISABLED' } },
    });
  }

  return {
    async list(filter) {
      const where: Prisma.RoomTypeWhereInput =
        filter.status === undefined ? {} : { status: filter.status };
      const roomTypes = await prisma.roomType.findMany({ where, orderBy: { id: 'desc' } });
      if (roomTypes.length === 0) {
        return [];
      }
      const counts = await prisma.room.groupBy({
        by: ['roomTypeId'],
        where: {
          roomTypeId: { in: roomTypes.map((roomType) => roomType.id) },
          status: { not: 'DISABLED' },
        },
        _count: { _all: true },
      });
      const countByTypeId = new Map(
        counts.map((entry) => [Number(entry.roomTypeId), entry._count._all]),
      );
      return roomTypes.map((roomType) =>
        mapRoomType(roomType, countByTypeId.get(Number(roomType.id)) ?? 0),
      );
    },

    async findById(id) {
      const roomType = await prisma.roomType.findUnique({ where: { id } });
      if (roomType === null) {
        return null;
      }
      return mapRoomType(roomType, await countUsableRooms(id));
    },

    async create(data) {
      const roomType = await prisma.roomType.create({
        data: {
          code: data.code,
          name: data.name,
          basePrice: data.basePrice,
          capacity: data.capacity,
          description: data.description,
        },
      });
      return mapRoomType(roomType, 0);
    },

    async update(id, data) {
      const existing = await prisma.roomType.findUnique({ where: { id }, select: { id: true } });
      if (existing === null) {
        return null;
      }
      const roomType = await prisma.roomType.update({
        where: { id },
        data: {
          name: data.name,
          basePrice: data.basePrice,
          capacity: data.capacity,
          description: data.description,
        },
      });
      return mapRoomType(roomType, await countUsableRooms(id));
    },

    async archive(id) {
      // 事务内先锁房型行（database-design §6.1 对称规则），再检查未完结引用后归档
      return prisma.$transaction(async (tx) => {
        const locked = await tx.$queryRaw<Array<{ id: bigint; status: string }>>`
          SELECT id, status FROM room_types WHERE id = ${id} FOR UPDATE`;
        const row = locked[0];
        if (row === undefined) {
          return { outcome: 'not_found' };
        }
        if (row.status === 'ARCHIVED') {
          return { outcome: 'already_archived' };
        }

        const confirmedBookings = await tx.booking.count({
          where: { roomTypeId: id, status: 'CONFIRMED' },
        });
        const checkedInStays = await tx.stay.count({
          where: { roomTypeId: id, status: 'CHECKED_IN' },
        });
        if (confirmedBookings > 0 || checkedInStays > 0) {
          return { outcome: 'referenced', confirmedBookings, checkedInStays };
        }

        const roomType = await tx.roomType.update({
          where: { id },
          data: { status: 'ARCHIVED' },
        });
        const roomCount = await tx.room.count({
          where: { roomTypeId: id, status: { not: 'DISABLED' } },
        });
        return { outcome: 'archived', roomType: mapRoomType(roomType, roomCount) };
      });
    },
  };
}

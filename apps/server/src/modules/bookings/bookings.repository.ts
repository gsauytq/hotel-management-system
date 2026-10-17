import type { BookingStatus } from '@hms/shared';

import { Prisma, type PrismaClient } from '../../generated/prisma/client.js';
import { formatDateOnly } from '../../utils/hotel-date.js';
import { multiplyMoney } from '../../utils/money.js';

export interface BookingRecord {
  id: number;
  guestId: number;
  guestName: string;
  guestPhone: string;
  roomTypeId: number;
  roomTypeName: string;
  checkInDate: Date;
  checkOutDate: Date;
  roomCount: number;
  pricePerNight: number;
  totalPrice: number;
  status: BookingStatus;
  note: string | null;
  createdBy: number;
  cancelledAt: Date | null;
  cancelReason: string | null;
  stayId: number | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateBookingParams {
  guestId: number;
  roomTypeId: number;
  checkInDate: Date;
  checkOutDate: Date;
  /** undefined → 使用房型 base_price 快照（A-12） */
  pricePerNight: number | undefined;
  note: string | undefined;
  createdBy: number;
  roomCount: number;
  nights: number;
}

export type CreateBookingOutcome =
  | { outcome: 'created'; booking: BookingRecord }
  | { outcome: 'room_type_not_found' }
  | { outcome: 'room_type_archived' }
  | { outcome: 'guest_not_found' }
  | { outcome: 'sold_out'; remaining: number };

/** 取消：仅 CONFIRMED → CANCELLED（无"未到入住日"限制，故与 NO_SHOW 类型区分） */
export type BookingCancelOutcome =
  | { outcome: 'updated'; booking: BookingRecord }
  | { outcome: 'not_found' }
  | { outcome: 'invalid_status'; status: BookingStatus }
  | { outcome: 'conflict' };

/** 标记未到：额外包含"未到入住日"（A-17） */
export type BookingNoShowOutcome = BookingCancelOutcome | { outcome: 'not_yet_due' };

export interface BookingListParams {
  status?: BookingStatus;
  guestId?: number;
  checkInDateFrom?: string;
  checkInDateTo?: string;
  checkOutDateFrom?: string;
  checkOutDateTo?: string;
  keyword?: string;
  page: number;
  pageSize: number;
  orderBy: Array<Record<string, 'asc' | 'desc'>>;
}

export interface BookingListResult {
  items: BookingRecord[];
  total: number;
}

export interface BookingsRepository {
  create(params: CreateBookingParams): Promise<CreateBookingOutcome>;
  list(params: BookingListParams): Promise<BookingListResult>;
  findById(id: number): Promise<BookingRecord | null>;
  cancel(
    id: number,
    params: { reason: string | undefined; now: Date },
  ): Promise<BookingCancelOutcome>;
  markNoShow(id: number, params: { hotelToday: string }): Promise<BookingNoShowOutcome>;
}

type BookingRow = {
  id: bigint;
  guestId: bigint;
  roomTypeId: bigint;
  checkInDate: Date;
  checkOutDate: Date;
  roomCount: number;
  pricePerNight: Prisma.Decimal;
  totalPrice: Prisma.Decimal;
  status: string;
  note: string | null;
  createdBy: bigint;
  cancelledAt: Date | null;
  cancelReason: string | null;
  createdAt: Date;
  updatedAt: Date;
  guest: { name: string; phone: string };
  roomType: { name: string };
  stay?: { id: bigint } | null;
};

const bookingListInclude = {
  guest: { select: { name: true, phone: true } },
  roomType: { select: { name: true } },
} as const;

const bookingDetailInclude = {
  ...bookingListInclude,
  stay: { select: { id: true } },
} as const;

function mapBooking(row: BookingRow, stayId: number | null): BookingRecord {
  return {
    id: Number(row.id),
    guestId: Number(row.guestId),
    guestName: row.guest.name,
    guestPhone: row.guest.phone,
    roomTypeId: Number(row.roomTypeId),
    roomTypeName: row.roomType.name,
    checkInDate: row.checkInDate,
    checkOutDate: row.checkOutDate,
    roomCount: row.roomCount,
    pricePerNight: row.pricePerNight.toNumber(),
    totalPrice: row.totalPrice.toNumber(),
    status: row.status as BookingStatus,
    note: row.note,
    createdBy: Number(row.createdBy),
    cancelledAt: row.cancelledAt,
    cancelReason: row.cancelReason,
    stayId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function createBookingsRepository(prisma: PrismaClient): BookingsRepository {
  /**
   * 写事务统一使用 READ COMMITTED：
   * 房间/预订计数读取必须看到最新已提交数据（避免 RR 快照读到旧计数导致超售误判），
   * 并发串行化由 room_types 行锁保证（database-design §6.1）。
   */
  const writeTransactionOptions = {
    isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
  } as const;

  return {
    async create(params) {
      return prisma.$transaction(async (tx) => {
        // ★ 房型行锁：串行化同房型的全部房量操作（创建/取消/NO_SHOW/房间维护）
        const locked = await tx.$queryRaw<Array<{ id: bigint; status: string }>>`
          SELECT id, status FROM room_types WHERE id = ${params.roomTypeId} FOR UPDATE`;
        const roomTypeRow = locked[0];
        if (roomTypeRow === undefined) {
          return { outcome: 'room_type_not_found' };
        }
        if (roomTypeRow.status === 'ARCHIVED') {
          return { outcome: 'room_type_archived' };
        }

        const guest = await tx.guest.findUnique({
          where: { id: params.guestId },
          select: { id: true },
        });
        if (guest === null) {
          return { outcome: 'guest_not_found' };
        }

        const roomType = await tx.roomType.findUniqueOrThrow({
          where: { id: params.roomTypeId },
          select: { basePrice: true },
        });

        // 半开区间重叠判定 [checkIn, checkOut)：统计 CONFIRMED 预订 + 在住（审查 A-1）。
        // 在住（CHECKED_IN stay）在其预计离店日之前持续占用房量；预订办理入住后状态翻为
        // CHECKED_IN 并退出 CONFIRMED 计数，若不计在住，等价于把已住房间再次出售。
        const overlapping = await tx.booking.count({
          where: {
            roomTypeId: params.roomTypeId,
            status: 'CONFIRMED',
            checkInDate: { lt: params.checkOutDate },
            checkOutDate: { gt: params.checkInDate },
          },
        });
        const inHouseStays = await tx.stay.count({
          where: {
            roomTypeId: params.roomTypeId,
            status: 'CHECKED_IN',
            expectedCheckOutDate: { gt: params.checkInDate },
          },
        });
        const occupiedDemand = overlapping + inHouseStays;
        const totalRooms = await tx.room.count({
          where: { roomTypeId: params.roomTypeId, status: { notIn: ['MAINTENANCE', 'DISABLED'] } },
        });
        const remaining = Math.max(0, totalRooms - occupiedDemand);
        if (occupiedDemand + params.roomCount > totalRooms) {
          return { outcome: 'sold_out', remaining };
        }

        // 价格快照：创建时锁定（默认房型基准价，可覆盖）；总价服务端计算，绝不信任客户端
        // 金额使用「分」精确运算（禁止浮点累计），落库仍为 DECIMAL(10,2)
        const pricePerNight = params.pricePerNight ?? roomType.basePrice.toNumber();
        const totalPrice = multiplyMoney(pricePerNight, params.nights * params.roomCount);

        const booking = await tx.booking.create({
          data: {
            guestId: params.guestId,
            roomTypeId: params.roomTypeId,
            checkInDate: params.checkInDate,
            checkOutDate: params.checkOutDate,
            roomCount: params.roomCount,
            pricePerNight,
            totalPrice,
            status: 'CONFIRMED',
            note: params.note,
            createdBy: params.createdBy,
          },
          include: bookingListInclude,
        });
        return { outcome: 'created', booking: mapBooking(booking, null) };
      }, writeTransactionOptions);
    },

    async list(params) {
      const where: Prisma.BookingWhereInput = {
        ...(params.status === undefined ? {} : { status: params.status }),
        ...(params.guestId === undefined ? {} : { guestId: params.guestId }),
        ...(params.checkInDateFrom === undefined && params.checkInDateTo === undefined
          ? {}
          : {
              checkInDate: {
                ...(params.checkInDateFrom === undefined
                  ? {}
                  : { gte: new Date(`${params.checkInDateFrom}T00:00:00.000Z`) }),
                ...(params.checkInDateTo === undefined
                  ? {}
                  : { lte: new Date(`${params.checkInDateTo}T00:00:00.000Z`) }),
              },
            }),
        ...(params.checkOutDateFrom === undefined && params.checkOutDateTo === undefined
          ? {}
          : {
              checkOutDate: {
                ...(params.checkOutDateFrom === undefined
                  ? {}
                  : { gte: new Date(`${params.checkOutDateFrom}T00:00:00.000Z`) }),
                ...(params.checkOutDateTo === undefined
                  ? {}
                  : { lte: new Date(`${params.checkOutDateTo}T00:00:00.000Z`) }),
              },
            }),
        ...(params.keyword === undefined
          ? {}
          : {
              guest: {
                OR: [
                  { name: { contains: params.keyword } },
                  { phone: { startsWith: params.keyword } },
                ],
              },
            }),
      };

      const [total, rows] = await Promise.all([
        prisma.booking.count({ where }),
        prisma.booking.findMany({
          where,
          include: bookingListInclude,
          orderBy: params.orderBy as unknown as Prisma.BookingOrderByWithRelationInput[],
          skip: (params.page - 1) * params.pageSize,
          take: params.pageSize,
        }),
      ]);
      return { total, items: rows.map((row) => mapBooking(row, null)) };
    },

    async findById(id) {
      const booking = await prisma.booking.findUnique({
        where: { id },
        include: bookingDetailInclude,
      });
      if (booking === null) {
        return null;
      }
      return mapBooking(booking, booking.stay === null ? null : Number(booking.stay.id));
    },

    async cancel(id, { reason, now }) {
      return prisma.$transaction(async (tx) => {
        const booking = await tx.booking.findUnique({
          where: { id },
          select: { id: true, roomTypeId: true, status: true },
        });
        if (booking === null) {
          return { outcome: 'not_found' };
        }
        if (booking.status !== 'CONFIRMED') {
          return { outcome: 'invalid_status', status: booking.status as BookingStatus };
        }

        // 先锁房型行再改状态：与创建预订串行化，防止取消/创建竞态（database-design §6.1）
        await tx.$queryRaw`SELECT id FROM room_types WHERE id = ${booking.roomTypeId} FOR UPDATE`;
        const updated = await tx.booking.updateMany({
          where: { id, status: 'CONFIRMED' },
          data: { status: 'CANCELLED', cancelledAt: now, cancelReason: reason ?? null },
        });
        if (updated.count === 0) {
          return { outcome: 'conflict' };
        }

        const row = await tx.booking.findUniqueOrThrow({
          where: { id },
          include: bookingDetailInclude,
        });
        return {
          outcome: 'updated',
          booking: mapBooking(row, row.stay === null ? null : Number(row.stay.id)),
        };
      }, writeTransactionOptions);
    },

    async markNoShow(id, { hotelToday }) {
      return prisma.$transaction(async (tx) => {
        const booking = await tx.booking.findUnique({
          where: { id },
          select: { id: true, roomTypeId: true, status: true, checkInDate: true },
        });
        if (booking === null) {
          return { outcome: 'not_found' };
        }
        if (booking.status !== 'CONFIRMED') {
          return { outcome: 'invalid_status', status: booking.status as BookingStatus };
        }
        // A-17：仅当入住日 ≤ 今日（酒店本地日）可标记未到
        if (formatDateOnly(booking.checkInDate) > hotelToday) {
          return { outcome: 'not_yet_due' };
        }

        await tx.$queryRaw`SELECT id FROM room_types WHERE id = ${booking.roomTypeId} FOR UPDATE`;
        const updated = await tx.booking.updateMany({
          where: { id, status: 'CONFIRMED' },
          data: { status: 'NO_SHOW' },
        });
        if (updated.count === 0) {
          return { outcome: 'conflict' };
        }

        const row = await tx.booking.findUniqueOrThrow({
          where: { id },
          include: bookingDetailInclude,
        });
        return {
          outcome: 'updated',
          booking: mapBooking(row, row.stay === null ? null : Number(row.stay.id)),
        };
      }, writeTransactionOptions);
    },
  };
}

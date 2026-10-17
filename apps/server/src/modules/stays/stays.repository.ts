import type {
  BookingStatus,
  OrderItemType,
  OrderStatus,
  PaymentMethod,
  RoomStatus,
  StayStatus,
} from '@hms/shared';

import { Prisma, type PrismaClient } from '../../generated/prisma/client.js';
import { isUniqueConstraintError } from '../../shared/http/prisma-errors.js';
import {
  enumerateDateRange,
  formatDateOnly,
  hotelDateOf,
  nightsBetween,
  toDateOnly,
} from '../../utils/hotel-date.js';

export interface StayRecord {
  id: number;
  bookingId: number | null;
  guestId: number;
  guestName: string;
  roomId: number;
  roomNumber: string;
  roomTypeId: number;
  roomTypeName: string;
  pricePerNight: number;
  checkInAt: Date;
  expectedCheckOutDate: Date;
  actualCheckOutAt: Date | null;
  depositAmount: number;
  status: StayStatus;
  note: string | null;
  createdBy: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface OrderItemRecord {
  type: OrderItemType;
  name: string;
  amount: number;
}

export interface OrderRecord {
  id: number;
  stayId: number;
  status: OrderStatus;
  items: OrderItemRecord[];
  totalAmount: number;
  depositAmount: number;
  depositApplied: number;
  paidAmount: number;
  paymentMethod: PaymentMethod;
  note: string | null;
  createdBy: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface OrderSummaryRecord {
  id: number;
  stayId: number;
  guestName: string;
  roomNumber: string;
  totalAmount: number;
  paidAmount: number;
  paymentMethod: PaymentMethod;
  status: OrderStatus;
  createdAt: Date;
  /** 杂费合计（由账单明细精确汇总，供 S3 在住/已退费用展示） */
  miscTotal: number;
}

export interface CreateStayParams {
  /** null = walk-in（无预订） */
  bookingId: number | null;
  /** walk-in 必填；预订入住由预订的客人决定（忽略该值） */
  guestId: number | undefined;
  roomId: number;
  /** undefined → 预订价（有预订）；walk-in 由 schema 必填 */
  pricePerNight: number | undefined;
  /** walk-in 必填；预订入住使用预订的离店日期 */
  expectedCheckOutDate: Date | undefined;
  depositAmount: number;
  note: string | undefined;
  createdBy: number;
  now: Date;
  hotelToday: string;
}

export type CreateStayOutcome =
  | { outcome: 'created'; stay: StayRecord }
  | { outcome: 'room_not_found' }
  | { outcome: 'guest_not_found' }
  | { outcome: 'booking_not_found' }
  | { outcome: 'room_not_assignable'; roomStatus: RoomStatus }
  | { outcome: 'room_type_mismatch' }
  | { outcome: 'booking_invalid'; bookingStatus: BookingStatus }
  | { outcome: 'booking_date_mismatch' }
  /** 预订离店日已到/已过：不可入住（防止 DB CHECK 约束失败被误报 500，审查 P-2） */
  | { outcome: 'booking_expired' }
  | { outcome: 'room_occupied' }
  /** walk-in 与「已确认预订 + 在住」的合并房量冲突（审查 A-1） */
  | { outcome: 'room_type_sold_out'; remaining: number }
  /** 预读房型与加锁后不一致（并发修改房型，极窄竞态）：要求调用方刷新重试 */
  | { outcome: 'room_changed' };

export type CheckoutOutcome =
  | { outcome: 'checked_out'; order: OrderRecord }
  | { outcome: 'not_found' }
  | { outcome: 'invalid_status'; status: StayStatus }
  | { outcome: 'conflict' };

export interface StayListParams {
  status?: StayStatus;
  roomId?: number;
  keyword?: string;
  page: number;
  pageSize: number;
  orderBy: Array<Record<string, 'asc' | 'desc'>>;
}

export interface CheckoutParams {
  paymentMethod: PaymentMethod;
  miscItems: Array<{ name: string; amount: number }>;
  note: string | undefined;
  createdBy: number;
  now: Date;
  hotelToday: string;
}

export interface StaysRepository {
  createStay(params: CreateStayParams): Promise<CreateStayOutcome>;
  list(params: StayListParams): Promise<{ items: StayRecord[]; total: number }>;
  findById(id: number): Promise<StayRecord | null>;
  findOrderSummaryByStayId(stayId: number): Promise<OrderSummaryRecord | null>;
  checkout(stayId: number, params: CheckoutParams): Promise<CheckoutOutcome>;
}

const stayInclude = {
  guest: { select: { name: true } },
  room: { select: { roomNumber: true } },
  roomType: { select: { name: true } },
} as const;

type StayRow = {
  id: bigint;
  bookingId: bigint | null;
  guestId: bigint;
  roomId: bigint;
  roomTypeId: bigint;
  pricePerNight: Prisma.Decimal;
  checkInAt: Date;
  expectedCheckOutDate: Date;
  actualCheckOutAt: Date | null;
  depositAmount: Prisma.Decimal;
  status: string;
  note: string | null;
  createdBy: bigint;
  createdAt: Date;
  updatedAt: Date;
  guest: { name: string };
  room: { roomNumber: string };
  roomType: { name: string };
};

type OrderRow = {
  id: bigint;
  stayId: bigint;
  status: string;
  totalAmount: Prisma.Decimal;
  depositAmount: Prisma.Decimal;
  depositApplied: Prisma.Decimal;
  paidAmount: Prisma.Decimal;
  paymentMethod: string;
  note: string | null;
  createdBy: bigint;
  createdAt: Date;
  updatedAt: Date;
  items: Array<{ type: string; name: string; amount: Prisma.Decimal }>;
};

function mapStay(row: StayRow): StayRecord {
  return {
    id: Number(row.id),
    bookingId: row.bookingId === null ? null : Number(row.bookingId),
    guestId: Number(row.guestId),
    guestName: row.guest.name,
    roomId: Number(row.roomId),
    roomNumber: row.room.roomNumber,
    roomTypeId: Number(row.roomTypeId),
    roomTypeName: row.roomType.name,
    pricePerNight: row.pricePerNight.toNumber(),
    checkInAt: row.checkInAt,
    expectedCheckOutDate: row.expectedCheckOutDate,
    actualCheckOutAt: row.actualCheckOutAt,
    depositAmount: row.depositAmount.toNumber(),
    status: row.status as StayStatus,
    note: row.note,
    createdBy: Number(row.createdBy),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function mapOrder(row: OrderRow): OrderRecord {
  return {
    id: Number(row.id),
    stayId: Number(row.stayId),
    status: row.status as OrderStatus,
    items: row.items.map((item) => ({
      type: item.type as OrderItemType,
      name: item.name,
      amount: item.amount.toNumber(),
    })),
    totalAmount: row.totalAmount.toNumber(),
    depositAmount: row.depositAmount.toNumber(),
    depositApplied: row.depositApplied.toNumber(),
    paidAmount: row.paidAmount.toNumber(),
    paymentMethod: row.paymentMethod as PaymentMethod,
    note: row.note,
    createdBy: Number(row.createdBy),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function createStaysRepository(prisma: PrismaClient): StaysRepository {
  /** 与预订写入一致：计数/读取需看到最新已提交数据（见 bookings.repository 说明） */
  const writeTransactionOptions = {
    isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
  } as const;

  return {
    async createStay(params) {
      try {
        return await prisma.$transaction(async (tx) => {
          // ⓪ walk-in 需要做合并视角房量校验：按全局锁序先取房型行锁（room_types → rooms），
          //    与预订创建/取消共用同一把锁串行化（审查 A-1；database-design §6.1）。
          //    预订入住分支不在此校验（预订创建时已计入房量），故保持原有 rooms → bookings 顺序。
          let preReadRoomTypeId: number | undefined;
          if (params.bookingId === null) {
            const preRead = await tx.$queryRaw<Array<{ room_type_id: bigint }>>`
              SELECT room_type_id FROM rooms WHERE id = ${params.roomId}`;
            const preReadRow = preRead[0];
            if (preReadRow === undefined) {
              return { outcome: 'room_not_found' };
            }
            preReadRoomTypeId = Number(preReadRow.room_type_id);
            await tx.$queryRaw`SELECT id FROM room_types WHERE id = ${preReadRow.room_type_id} FOR UPDATE`;
          }

          // ① 房间行锁：串行化同房间的分配/退房（database-design §6.2）
          const roomLock = await tx.$queryRaw<
            Array<{ id: bigint; status: string; room_type_id: bigint }>
          >`
            SELECT id, status, room_type_id FROM rooms WHERE id = ${params.roomId} FOR UPDATE`;
          const lockedRoom = roomLock[0];
          if (lockedRoom === undefined) {
            return { outcome: 'room_not_found' };
          }
          const roomStatus = lockedRoom.status as RoomStatus;
          if (roomStatus !== 'VACANT_CLEAN' && roomStatus !== 'VACANT_DIRTY') {
            return { outcome: 'room_not_assignable', roomStatus };
          }
          const roomTypeId = Number(lockedRoom.room_type_id);
          if (preReadRoomTypeId !== undefined && preReadRoomTypeId !== roomTypeId) {
            // 预读与加锁之间房型被修改：不得用错误的房型锁做房量判断，交由调用方刷新重试
            return { outcome: 'room_changed' };
          }

          // ② 预订分支：锁预订行并校验状态/房型/日期
          let bookingGuestId: number | undefined;
          let expectedCheckOutDate = params.expectedCheckOutDate;
          let pricePerNight = params.pricePerNight;
          if (params.bookingId !== null) {
            const bookingLock = await tx.$queryRaw<Array<{ id: bigint }>>`
              SELECT id FROM bookings WHERE id = ${params.bookingId} FOR UPDATE`;
            if (bookingLock.length === 0) {
              return { outcome: 'booking_not_found' };
            }
            const booking = await tx.booking.findUniqueOrThrow({
              where: { id: params.bookingId },
            });
            if (booking.status !== 'CONFIRMED') {
              return { outcome: 'booking_invalid', bookingStatus: booking.status as BookingStatus };
            }
            if (Number(booking.roomTypeId) !== roomTypeId) {
              return { outcome: 'room_type_mismatch' };
            }
            // A-18：允许入住日当天及之后入住，不可早于入住日
            if (formatDateOnly(booking.checkInDate) > params.hotelToday) {
              return { outcome: 'booking_date_mismatch' };
            }
            // 离店日不晚于今日 → 入住当晚数为 0/负数，且会触发 chk_stays_check_out_after_check_in，
            // 必须在此以业务错误拒绝（审查 P-2）
            if (formatDateOnly(booking.checkOutDate) <= params.hotelToday) {
              return { outcome: 'booking_expired' };
            }
            bookingGuestId = Number(booking.guestId);
            expectedCheckOutDate = booking.checkOutDate;
            pricePerNight = params.pricePerNight ?? booking.pricePerNight.toNumber();
          }

          const guestId = params.bookingId !== null ? bookingGuestId : params.guestId;
          if (guestId === undefined) {
            return { outcome: 'guest_not_found' };
          }
          const guest = await tx.guest.findUnique({ where: { id: guestId }, select: { id: true } });
          if (guest === null) {
            return { outcome: 'guest_not_found' };
          }
          if (expectedCheckOutDate === undefined) {
            return { outcome: 'booking_date_mismatch' };
          }

          const room = await tx.room.findUniqueOrThrow({
            where: { id: params.roomId },
            include: { roomType: { select: { basePrice: true } } },
          });
          const stayPricePerNight = pricePerNight ?? room.roomType.basePrice.toNumber();

          const expectedDate = formatDateOnly(expectedCheckOutDate);
          const occupancyDates = enumerateDateRange(params.hotelToday, expectedDate);

          // ③ 合并视角房量校验（审查 A-1）：在住（CHECKED_IN）+ 重叠 CONFIRMED 预订 + 本次入住
          //    必须 ≤ 可售房数。已持 room_types 行锁，与预订创建/取消串行化（database-design §6.1）。
          //    仅 walk-in 分支需要：预订入住的房量已在预订创建时计入，此处只做物理房间分配；
          //    否则会与「同房型多笔预订先后入住」的既有语义冲突（TC-BK-021）。
          if (params.bookingId === null) {
            const rangeStart = toDateOnly(params.hotelToday);
            const [otherConfirmed, inHouseStays, sellableRooms] = await Promise.all([
              tx.booking.count({
                where: {
                  roomTypeId,
                  status: 'CONFIRMED',
                  checkInDate: { lt: expectedCheckOutDate },
                  checkOutDate: { gt: rangeStart },
                },
              }),
              tx.stay.count({
                where: {
                  roomTypeId,
                  status: 'CHECKED_IN',
                  expectedCheckOutDate: { gt: rangeStart },
                },
              }),
              tx.room.count({
                where: { roomTypeId, status: { notIn: ['MAINTENANCE', 'DISABLED'] } },
              }),
            ]);
            const occupiedDemand = otherConfirmed + inHouseStays;
            if (occupiedDemand + 1 > sellableRooms) {
              return {
                outcome: 'room_type_sold_out',
                remaining: Math.max(0, sellableRooms - occupiedDemand),
              };
            }
          }

          // ④ 占用冲突预检（行锁下为当前读；唯一约束仍为最终兜底，ADR-006）
          const occupancyConflict = await tx.roomOccupancy.count({
            where: {
              roomId: params.roomId,
              date: { gte: toDateOnly(params.hotelToday), lt: expectedCheckOutDate },
            },
          });
          if (occupancyConflict > 0) {
            return { outcome: 'room_occupied' };
          }

          // ⑤ 全部写操作在同一事务内：stay → occupancy → room → booking
          const stay = await tx.stay.create({
            data: {
              bookingId: params.bookingId,
              guestId,
              roomId: params.roomId,
              roomTypeId,
              pricePerNight: stayPricePerNight,
              checkInAt: params.now,
              expectedCheckOutDate,
              depositAmount: params.depositAmount,
              status: 'CHECKED_IN',
              note: params.note,
              createdBy: params.createdBy,
            },
          });
          await tx.roomOccupancy.createMany({
            data: occupancyDates.map((date) => ({
              stayId: stay.id,
              roomId: params.roomId,
              date: toDateOnly(date),
            })),
          });
          await tx.room.update({ where: { id: params.roomId }, data: { status: 'OCCUPIED' } });
          if (params.bookingId !== null) {
            await tx.booking.update({
              where: { id: params.bookingId },
              data: { status: 'CHECKED_IN' },
            });
          }

          const fullStay = await tx.stay.findUniqueOrThrow({
            where: { id: stay.id },
            include: stayInclude,
          });
          return { outcome: 'created', stay: mapStay(fullStay) };
        }, writeTransactionOptions);
      } catch (error) {
        // uq_occupancy_room_date / uq_bookings_booking_stay 兜底：并发下最终只允许一次占用
        if (isUniqueConstraintError(error)) {
          return { outcome: 'room_occupied' };
        }
        throw error;
      }
    },

    async list(params) {
      const where: Prisma.StayWhereInput = {
        ...(params.status === undefined ? {} : { status: params.status }),
        ...(params.roomId === undefined ? {} : { roomId: params.roomId }),
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
        prisma.stay.count({ where }),
        prisma.stay.findMany({
          where,
          include: stayInclude,
          orderBy: params.orderBy as unknown as Prisma.StayOrderByWithRelationInput[],
          skip: (params.page - 1) * params.pageSize,
          take: params.pageSize,
        }),
      ]);
      return { total, items: rows.map(mapStay) };
    },

    async findById(id) {
      const stay = await prisma.stay.findUnique({ where: { id }, include: stayInclude });
      return stay === null ? null : mapStay(stay);
    },

    async findOrderSummaryByStayId(stayId) {
      const order = await prisma.order.findUnique({
        where: { stayId },
        include: {
          stay: {
            include: { guest: { select: { name: true } }, room: { select: { roomNumber: true } } },
          },
          items: { select: { type: true, amount: true } },
        },
      });
      if (order === null) {
        return null;
      }
      // 杂费合计以 DECIMAL 精确汇总（禁止浮点累计）
      const miscTotal = order.items
        .filter((item) => item.type === 'MISC')
        .reduce((sum, item) => sum.add(item.amount), new Prisma.Decimal(0));
      return {
        id: Number(order.id),
        stayId: Number(order.stayId),
        guestName: order.stay.guest.name,
        roomNumber: order.stay.room.roomNumber,
        totalAmount: order.totalAmount.toNumber(),
        paidAmount: order.paidAmount.toNumber(),
        paymentMethod: order.paymentMethod as PaymentMethod,
        status: order.status as OrderStatus,
        createdAt: order.createdAt,
        miscTotal: miscTotal.toNumber(),
      };
    },

    async checkout(stayId, params) {
      try {
        return await prisma.$transaction(async (tx) => {
          // ① 锁入住记录：防重复退房（第二次看到 CHECKED_OUT → 409）
          const stayLock = await tx.$queryRaw<Array<{ id: bigint }>>`
            SELECT id FROM stays WHERE id = ${stayId} FOR UPDATE`;
          if (stayLock.length === 0) {
            return { outcome: 'not_found' };
          }
          const stay = await tx.stay.findUniqueOrThrow({ where: { id: stayId } });
          if (stay.status !== 'CHECKED_IN') {
            return { outcome: 'invalid_status', status: stay.status as StayStatus };
          }

          // ② 锁房间行，保证与入住/房态操作串行化
          await tx.$queryRaw`SELECT id FROM rooms WHERE id = ${stay.roomId} FOR UPDATE`;

          // ③ 计费（A-06：按预计离店日计晚数，提前退房不自动退差价）
          // 晚数按酒店本地日历日（Asia/Shanghai）计算（A-10）：checkInAt 为 UTC 时间戳，
          // 必须换算为酒店本地日，否则凌晨 00:00-08:00 入住会被多计一晚（审查 P-1）。
          // 金额一律用 Prisma Decimal（DECIMAL(10,2)）运算，禁止浮点累计
          const nights = nightsBetween(
            hotelDateOf(stay.checkInAt),
            formatDateOnly(stay.expectedCheckOutDate),
          );
          const roomFee = stay.pricePerNight.mul(nights);
          const miscTotal = params.miscItems.reduce(
            (sum, item) => sum.add(item.amount),
            new Prisma.Decimal(0),
          );
          const totalAmount = roomFee.add(miscTotal);
          const depositAmount = stay.depositAmount;
          const depositApplied = Prisma.Decimal.min(depositAmount, totalAmount);
          const paidAmount = totalAmount.sub(depositApplied);

          const items: Array<{ type: OrderItemType; name: string; amount: Prisma.Decimal }> = [];
          if (roomFee.gt(0)) {
            items.push({
              type: 'ROOM_FEE',
              name: `房费 ${nights} 晚 × ${stay.pricePerNight.toFixed(2)}`,
              amount: roomFee,
            });
          }
          for (const misc of params.miscItems) {
            items.push({ type: 'MISC', name: misc.name, amount: new Prisma.Decimal(misc.amount) });
          }
          if (depositApplied.gt(0)) {
            items.push({ type: 'DEPOSIT_APPLIED', name: '押金抵扣', amount: depositApplied });
          }

          // ④ 同一事务：账单 → 入住状态 → 房态 → 释放占用（database-design §6.3）
          const order = await tx.order.create({
            data: {
              stayId,
              totalAmount,
              depositAmount,
              depositApplied,
              paidAmount,
              paymentMethod: params.paymentMethod,
              status: 'PAID',
              note: params.note,
              createdBy: params.createdBy,
              items: { create: items },
            },
            include: { items: { orderBy: { id: 'asc' } } },
          });
          await tx.stay.update({
            where: { id: stayId },
            data: { status: 'CHECKED_OUT', actualCheckOutAt: params.now },
          });
          await tx.room.update({ where: { id: stay.roomId }, data: { status: 'VACANT_DIRTY' } });
          await tx.roomOccupancy.deleteMany({
            where: { stayId, date: { gte: toDateOnly(params.hotelToday) } },
          });

          return { outcome: 'checked_out', order: mapOrder(order) };
        }, writeTransactionOptions);
      } catch (error) {
        // uq_orders_stay 兜底：并发重复退房最终只生成一张账单
        if (isUniqueConstraintError(error)) {
          return { outcome: 'conflict' };
        }
        throw error;
      }
    },
  };
}

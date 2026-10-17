import type { OrderItemType, OrderStatus, PaymentMethod } from '@hms/shared';

import { Prisma, type PrismaClient } from '../../generated/prisma/client.js';
import { addDaysToDateOnly, hotelDayStartUtc } from '../../utils/hotel-date.js';

export interface OrderListItemRecord {
  id: number;
  stayId: number;
  guestName: string;
  roomNumber: string;
  totalAmount: number;
  paidAmount: number;
  paymentMethod: PaymentMethod;
  status: OrderStatus;
  createdAt: Date;
}

export interface OrderDetailRecord extends OrderListItemRecord {
  items: Array<{ type: OrderItemType; name: string; amount: number }>;
  depositAmount: number;
  depositApplied: number;
  note: string | null;
  updatedAt: Date;
}

export interface OrderListParams {
  stayId?: number;
  /** 账单日期（酒店本地日）起，闭区间 */
  createdFrom?: string;
  createdTo?: string;
  page: number;
  pageSize: number;
  orderBy: Array<Record<string, 'asc' | 'desc'>>;
}

export interface OrdersRepository {
  list(params: OrderListParams): Promise<{ items: OrderListItemRecord[]; total: number }>;
  findById(id: number): Promise<OrderDetailRecord | null>;
}

const orderRelationsInclude = {
  stay: {
    include: { guest: { select: { name: true } }, room: { select: { roomNumber: true } } },
  },
} as const;

type OrderRow = {
  id: bigint;
  stayId: bigint;
  totalAmount: Prisma.Decimal;
  paidAmount: Prisma.Decimal;
  paymentMethod: string;
  status: string;
  createdAt: Date;
  stay: { guest: { name: string }; room: { roomNumber: string } };
};

type OrderDetailRow = OrderRow & {
  depositAmount: Prisma.Decimal;
  depositApplied: Prisma.Decimal;
  note: string | null;
  updatedAt: Date;
  items: Array<{ type: string; name: string; amount: Prisma.Decimal }>;
};

function mapOrderListItem(row: OrderRow): OrderListItemRecord {
  return {
    id: Number(row.id),
    stayId: Number(row.stayId),
    guestName: row.stay.guest.name,
    roomNumber: row.stay.room.roomNumber,
    totalAmount: row.totalAmount.toNumber(),
    paidAmount: row.paidAmount.toNumber(),
    paymentMethod: row.paymentMethod as PaymentMethod,
    status: row.status as OrderStatus,
    createdAt: row.createdAt,
  };
}

export function createOrdersRepository(prisma: PrismaClient): OrdersRepository {
  return {
    async list(params) {
      const where: Prisma.OrderWhereInput = {
        ...(params.stayId === undefined ? {} : { stayId: params.stayId }),
        ...(params.createdFrom === undefined && params.createdTo === undefined
          ? {}
          : {
              // createdFrom/To 为酒店本地日历日（A-10）：转换为 [起日 00:00, 止日+1 00:00) 的 UTC 边界
              createdAt: {
                ...(params.createdFrom === undefined
                  ? {}
                  : { gte: hotelDayStartUtc(params.createdFrom) }),
                ...(params.createdTo === undefined
                  ? {}
                  : { lt: hotelDayStartUtc(addDaysToDateOnly(params.createdTo, 1)) }),
              },
            }),
      };

      const [total, rows] = await Promise.all([
        prisma.order.count({ where }),
        prisma.order.findMany({
          where,
          include: orderRelationsInclude,
          orderBy: params.orderBy as unknown as Prisma.OrderOrderByWithRelationInput[],
          skip: (params.page - 1) * params.pageSize,
          take: params.pageSize,
        }),
      ]);
      return { total, items: rows.map(mapOrderListItem) };
    },

    async findById(id) {
      const order = await prisma.order.findUnique({
        where: { id },
        include: {
          ...orderRelationsInclude,
          items: { orderBy: { id: 'asc' } },
        },
      });
      if (order === null) {
        return null;
      }
      const row = order as OrderDetailRow;
      return {
        ...mapOrderListItem(row),
        items: row.items.map((item) => ({
          type: item.type as OrderItemType,
          name: item.name,
          amount: item.amount.toNumber(),
        })),
        depositAmount: row.depositAmount.toNumber(),
        depositApplied: row.depositApplied.toNumber(),
        note: row.note,
        updatedAt: row.updatedAt,
      };
    },
  };
}

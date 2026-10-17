import { z } from 'zod';

import {
  ORDER_ITEM_TYPES,
  ORDER_STATUSES,
  PAYMENT_METHODS,
  STAY_STATUSES,
  type OrderItemType,
  type OrderStatus,
  type PaymentMethod,
  type StayStatus,
} from './states.js';
import { dateOnlySchema, moneySchema } from './validation.js';

export interface StayDto {
  id: number;
  /** 无预订入住（walk-in）为 null */
  bookingId: number | null;
  guestId: number;
  guestName: string;
  roomId: number;
  roomNumber: string;
  roomTypeId: number;
  roomTypeName: string;
  pricePerNight: number;
  checkInAt: string;
  expectedCheckOutDate: string;
  depositAmount: number;
  status: StayStatus;
  note: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface OrderItemDto {
  type: OrderItemType;
  name: string;
  amount: number;
}

export interface OrderDto {
  id: number;
  stayId: number;
  status: OrderStatus;
  items: OrderItemDto[];
  totalAmount: number;
  depositAmount: number;
  depositApplied: number;
  paidAmount: number;
  paymentMethod: PaymentMethod;
  note: string | null;
  createdAt: string;
  updatedAt: string;
}

/** S3 订单摘要（OrderListItem） */
export interface OrderSummaryDto {
  id: number;
  stayId: number;
  guestName: string;
  roomNumber: string;
  totalAmount: number;
  paidAmount: number;
  paymentMethod: PaymentMethod;
  status: OrderStatus;
  createdAt: string;
}

export interface CurrentChargesDto {
  roomFee: number;
  /** 在住期间为 0（杂费退房录入，假设 A-19） */
  miscTotal: number;
  total: number;
  /** 预计晚数（expected_check_out_date − DATE(check_in_at)） */
  nights: number;
}

export interface StayDetailDto extends StayDto {
  actualCheckOutAt: string | null;
  currentCharges: CurrentChargesDto;
  order: OrderSummaryDto | null;
}

/** S2 排序白名单（api-contract S2） */
export const STAY_SORT_FIELDS = ['checkInAt', 'expectedCheckOutDate', 'status'] as const;

const pricePerNightSchema = moneySchema(0.01, 99999.99, '房价');
const depositAmountSchema = moneySchema(0, 99999.99, '押金');

/** B6 预订入住请求（api-contract B6） */
export const checkInBookingSchema = z.strictObject({
  roomId: z.number().int('房间 id 必须为整数').min(1, '房间 id 无效'),
  depositAmount: depositAmountSchema.optional(),
  /** 缺省取预订价（A-12/A-13 快照）；openapi 定义 nullable，null 与缺省等价 */
  pricePerNight: pricePerNightSchema.nullable().optional(),
});

/** S1 直接入住请求（api-contract S1；pricePerNight 必填） */
export const createStaySchema = z.strictObject({
  guestId: z.number().int('客人 id 必须为整数').min(1, '客人 id 无效'),
  roomId: z.number().int('房间 id 必须为整数').min(1, '房间 id 无效'),
  pricePerNight: pricePerNightSchema,
  expectedCheckOutDate: dateOnlySchema,
  depositAmount: depositAmountSchema.optional(),
  note: z.string().max(500, '备注不得超过 500 个字符').optional(),
});

/** S4 退房结算请求（api-contract S4） */
export const checkoutStaySchema = z.strictObject({
  paymentMethod: z.enum(PAYMENT_METHODS),
  miscItems: z
    .array(
      z.strictObject({
        name: z.string().trim().min(1, '杂费名称不能为空').max(100, '杂费名称不得超过 100 个字符'),
        amount: moneySchema(0.01, 99999.99, '杂费金额'),
      }),
    )
    .max(20, '杂费最多 20 项')
    .optional(),
  note: z.string().max(500, '备注不得超过 500 个字符').optional(),
});

export const PAYMENT_METHOD_VALUES = PAYMENT_METHODS;
export const ORDER_STATUS_VALUES = ORDER_STATUSES;
export const ORDER_ITEM_TYPE_VALUES = ORDER_ITEM_TYPES;
export const STAY_STATUS_VALUES = STAY_STATUSES;

export type CheckInBookingRequest = z.infer<typeof checkInBookingSchema>;
export type CreateStayRequest = z.infer<typeof createStaySchema>;
export type CheckoutStayRequest = z.infer<typeof checkoutStaySchema>;

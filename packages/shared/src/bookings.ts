import { z } from 'zod';

import type { BookingStatus } from './states.js';
import { dateOnlySchema, hasAtMostTwoDecimals } from './validation.js';

export interface BookingDto {
  id: number;
  guestId: number;
  guestName: string;
  guestPhone: string;
  roomTypeId: number;
  roomTypeName: string;
  /** 酒店日历日 YYYY-MM-DD（区间左闭右开 [checkInDate, checkOutDate)） */
  checkInDate: string;
  checkOutDate: string;
  roomCount: number;
  pricePerNight: number;
  totalPrice: number;
  status: BookingStatus;
  note: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface BookingDetailDto extends BookingDto {
  /** 已办理入住时非空（stay 由 T-10 创建） */
  stayId: number | null;
  cancelledAt: string | null;
  cancelReason: string | null;
}

/** B2 排序白名单（api-contract B2） */
export const BOOKING_SORT_FIELDS = ['createdAt', 'checkInDate', 'status'] as const;

const pricePerNightSchema = z
  .number()
  .min(0.01, '房价最低为 0.01')
  .max(99999.99, '房价超出上限')
  .refine(hasAtMostTwoDecimals, '房价最多两位小数');

export const createBookingSchema = z
  .strictObject({
    guestId: z.number().int('客人 id 必须为整数').min(1, '客人 id 无效'),
    roomTypeId: z.number().int('房型 id 必须为整数').min(1, '房型 id 无效'),
    checkInDate: dateOnlySchema,
    checkOutDate: dateOnlySchema,
    // openapi 定义 nullable：null 与缺省等价（取房型基准价快照）
    pricePerNight: pricePerNightSchema.nullable().optional(),
    note: z.string().max(500, '备注不得超过 500 个字符').optional(),
  })
  .refine((value) => value.checkOutDate > value.checkInDate, {
    message: '必须晚于入住日期',
    path: ['checkOutDate'],
  });

export const cancelBookingSchema = z.strictObject({
  reason: z.string().max(200, '取消原因不得超过 200 个字符').optional(),
});

export type CreateBookingRequest = z.infer<typeof createBookingSchema>;
export type CancelBookingRequest = z.infer<typeof cancelBookingSchema>;

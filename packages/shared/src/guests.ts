import { z } from 'zod';

import type { BookingStatus, IdType } from './states.js';
import { ID_TYPES } from './states.js';

export interface GuestDto {
  id: number;
  name: string;
  phone: string;
  idType: IdType;
  /** 证件号恒为掩码（前 1 后 1，中间 *；明文永不返回） */
  idNumberMasked: string;
  remark: string | null;
  createdAt: string;
}

export interface RecentBookingDto {
  id: number;
  checkInDate: string;
  checkOutDate: string;
  status: BookingStatus;
}

export interface GuestDetailDto extends GuestDto {
  updatedAt: string;
  /** 最近 10 条预订摘要 */
  recentBookings: RecentBookingDto[];
}

/** G1 排序白名单（api-contract G1，默认 createdAt:desc） */
export const GUEST_SORT_FIELDS = ['createdAt', 'name'] as const;

/** 手机号：大陆手机号或 6-20 位国际号码（api-contract G2） */
export const guestPhoneSchema = z
  .string()
  .regex(/^(?:1[3-9]\d{9}|\+?\d{6,20})$/, '手机号格式不正确');

export const guestNameSchema = z
  .string()
  .trim()
  .min(1, '客人姓名不能为空')
  .max(100, '客人姓名不得超过 100 个字符');

export const guestIdNumberSchema = z
  .string()
  .regex(/^[A-Za-z0-9]{5,30}$/, '证件号须为 5-30 位字母或数字');

const remarkSchema = z.string().max(500, '备注不得超过 500 个字符');

export const createGuestSchema = z.strictObject({
  name: guestNameSchema,
  phone: guestPhoneSchema,
  idType: z.enum(ID_TYPES),
  idNumber: guestIdNumberSchema,
  remark: remarkSchema.optional(),
});

/**
 * G4：name/phone/remark 可改；idType/idNumber 仅用于识别"试图修改证件号"
 * （服务层返回 409 GUEST_EXISTS，证件号不可修改，见 api-contract §7 G4）。
 */
export const updateGuestSchema = z.strictObject({
  name: guestNameSchema.optional(),
  phone: guestPhoneSchema.optional(),
  remark: remarkSchema.optional(),
  idType: z.enum(ID_TYPES).optional(),
  idNumber: guestIdNumberSchema.optional(),
});

export type CreateGuestRequest = z.infer<typeof createGuestSchema>;
export type UpdateGuestRequest = z.infer<typeof updateGuestSchema>;

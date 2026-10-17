import { z } from 'zod';

import type { RoomTypeStatus } from './states.js';
import { hasAtMostTwoDecimals } from './validation.js';

export interface RoomTypeDto {
  id: number;
  code: string;
  name: string;
  basePrice: number;
  capacity: number;
  description: string | null;
  status: RoomTypeStatus;
  /** 该房型未停用（status != DISABLED）房间数（api-contract R1） */
  roomCount: number;
  createdAt: string;
  updatedAt: string;
}

/** R1 排序白名单（如后续评审为 R1 增加排序参数时使用） */
export const ROOM_TYPE_SORT_FIELDS = ['code', 'name', 'basePrice', 'createdAt'] as const;

const codeSchema = z.string().regex(/^[A-Z0-9]{2,20}$/, '房型代码须为 2-20 位大写字母或数字');

const nameSchema = z
  .string()
  .trim()
  .min(1, '房型名称不能为空')
  .max(50, '房型名称不得超过 50 个字符');

const basePriceSchema = z
  .number()
  .min(0, '基准房价不能为负数')
  .max(99999.99, '基准房价超出上限')
  .refine(hasAtMostTwoDecimals, '基准房价最多两位小数');

const capacitySchema = z
  .number()
  .int('可住人数必须为整数')
  .min(1, '可住人数至少为 1')
  .max(20, '可住人数最多为 20');

const descriptionSchema = z.string().max(500, '描述不得超过 500 个字符');

export const createRoomTypeSchema = z.strictObject({
  code: codeSchema,
  name: nameSchema,
  basePrice: basePriceSchema,
  capacity: capacitySchema,
  description: descriptionSchema.optional(),
});

export const updateRoomTypeSchema = z.strictObject({
  name: nameSchema.optional(),
  basePrice: basePriceSchema.optional(),
  capacity: capacitySchema.optional(),
  description: descriptionSchema.optional(),
});

export type CreateRoomTypeRequest = z.infer<typeof createRoomTypeSchema>;
export type UpdateRoomTypeRequest = z.infer<typeof updateRoomTypeSchema>;

import { z } from 'zod';

import { ROOM_STATUSES, type RoomStatus } from './states.js';
import { dateOnlySchema } from './validation.js';

export interface CurrentStayDto {
  stayId: number;
  guestName: string;
  checkInAt: string;
  expectedCheckOutDate: string;
}

export interface RoomDto {
  id: number;
  roomNumber: string;
  roomTypeId: number;
  roomTypeName: string;
  status: RoomStatus;
  note: string | null;
  currentStay: CurrentStayDto | null;
  createdAt: string;
  updatedAt: string;
}

export interface AvailableRoomDto {
  id: number;
  roomNumber: string;
  status: RoomStatus;
}

/** M1 排序白名单（api-contract M1） */
export const ROOM_SORT_FIELDS = ['roomNumber', 'status', 'createdAt'] as const;

const roomNumberSchema = z.string().trim().min(1, '房号不能为空').max(20, '房号不得超过 20 个字符');

const roomTypeIdSchema = z.number().int('房型 id 必须为整数').min(1, '房型 id 无效');

const noteSchema = z.string().max(200, '备注不得超过 200 个字符');

export const createRoomSchema = z.strictObject({
  roomNumber: roomNumberSchema,
  roomTypeId: roomTypeIdSchema,
  note: noteSchema.optional(),
});

export const updateRoomSchema = z.strictObject({
  roomNumber: roomNumberSchema.optional(),
  roomTypeId: roomTypeIdSchema.optional(),
  note: noteSchema.optional(),
});

export const updateRoomStatusSchema = z.strictObject({
  status: z.enum(ROOM_STATUSES),
});

export const availableRoomsQuerySchema = z
  .object({
    roomTypeId: z.coerce.number().int('房型 id 必须为整数').min(1, '房型 id 无效'),
    checkInDate: dateOnlySchema,
    checkOutDate: dateOnlySchema,
  })
  .refine((value) => value.checkOutDate > value.checkInDate, {
    message: '离店日期必须晚于入住日期',
    path: ['checkOutDate'],
  });

export type CreateRoomRequest = z.infer<typeof createRoomSchema>;
export type UpdateRoomRequest = z.infer<typeof updateRoomSchema>;
export type UpdateRoomStatusRequest = z.infer<typeof updateRoomStatusSchema>;
export type AvailableRoomsQuery = z.infer<typeof availableRoomsQuerySchema>;

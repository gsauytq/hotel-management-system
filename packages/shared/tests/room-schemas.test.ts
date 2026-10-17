import { describe, expect, it } from 'vitest';

import { createRoomTypeSchema, updateRoomTypeSchema } from '../src/room-types.js';
import {
  availableRoomsQuerySchema,
  createRoomSchema,
  updateRoomSchema,
  updateRoomStatusSchema,
} from '../src/rooms.js';
import {
  ADMIN_ONLY_ROOM_STATUSES,
  ROOM_STATUS_MANUAL_TRANSITIONS,
  ROOM_STATUSES,
} from '../src/states.js';

describe('房型 schema（api-contract R2/R3）', () => {
  it('合法创建请求通过', () => {
    const result = createRoomTypeSchema.safeParse({
      code: 'DLX',
      name: '豪华大床房',
      basePrice: 388,
      capacity: 2,
      description: '25㎡，高层城景',
    });
    expect(result.success).toBe(true);
  });

  it('拒绝非法 code / 价格 / 容量', () => {
    const base = { name: '标准房', basePrice: 288, capacity: 2 };
    expect(createRoomTypeSchema.safeParse({ ...base, code: 'dlx' }).success).toBe(false);
    expect(createRoomTypeSchema.safeParse({ ...base, code: 'D1' }).success).toBe(true);
    expect(createRoomTypeSchema.safeParse({ ...base, code: 'D' }).success).toBe(false);
    expect(createRoomTypeSchema.safeParse({ ...base, code: 'A'.repeat(21) }).success).toBe(false);
    expect(createRoomTypeSchema.safeParse({ ...base, code: 'DLX', basePrice: -1 }).success).toBe(
      false,
    );
    expect(
      createRoomTypeSchema.safeParse({ ...base, code: 'DLX', basePrice: 288.001 }).success,
    ).toBe(false);
    expect(createRoomTypeSchema.safeParse({ ...base, code: 'DLX', capacity: 0 }).success).toBe(
      false,
    );
    expect(createRoomTypeSchema.safeParse({ ...base, code: 'DLX', capacity: 21 }).success).toBe(
      false,
    );
    expect(createRoomTypeSchema.safeParse({ ...base, code: 'DLX', capacity: 2.5 }).success).toBe(
      false,
    );
  });

  it('更新 schema 不含 code（api-contract R3），部分字段与空对象均可解析', () => {
    expect(updateRoomTypeSchema.safeParse({ basePrice: 428 }).success).toBe(true);
    expect(updateRoomTypeSchema.safeParse({}).success).toBe(true);
    expect(updateRoomTypeSchema.safeParse({ code: 'NEW' }).success).toBe(false);
  });
});

describe('客房 schema（api-contract M3/M4/M5/M2）', () => {
  it('创建客房校验房号长度与房型 id', () => {
    expect(createRoomSchema.safeParse({ roomNumber: '0822', roomTypeId: 1 }).success).toBe(true);
    expect(createRoomSchema.safeParse({ roomNumber: '', roomTypeId: 1 }).success).toBe(false);
    expect(createRoomSchema.safeParse({ roomNumber: 'A'.repeat(21), roomTypeId: 1 }).success).toBe(
      false,
    );
    expect(createRoomSchema.safeParse({ roomNumber: '0822', roomTypeId: 0 }).success).toBe(false);
  });

  it('更新客房允许部分字段，空对象可解析', () => {
    expect(updateRoomSchema.safeParse({ roomNumber: '0901' }).success).toBe(true);
    expect(updateRoomSchema.safeParse({}).success).toBe(true);
    expect(updateRoomSchema.safeParse({ roomTypeId: -1 }).success).toBe(false);
  });

  it('房态变更只接受受支持的状态值', () => {
    expect(updateRoomStatusSchema.safeParse({ status: 'VACANT_CLEAN' }).success).toBe(true);
    expect(updateRoomStatusSchema.safeParse({ status: 'OCCUPIED' }).success).toBe(true);
    expect(updateRoomStatusSchema.safeParse({ status: 'CLEANING' }).success).toBe(false);
    expect(updateRoomStatusSchema.safeParse({}).success).toBe(false);
  });

  it('可分配房间查询校验日期格式与先后顺序', () => {
    expect(
      availableRoomsQuerySchema.safeParse({
        roomTypeId: '1',
        checkInDate: '2026-10-14',
        checkOutDate: '2026-10-16',
      }).success,
    ).toBe(true);
    expect(
      availableRoomsQuerySchema.safeParse({
        roomTypeId: 1,
        checkInDate: '2026-10-16',
        checkOutDate: '2026-10-16',
      }).success,
    ).toBe(false);
    expect(
      availableRoomsQuerySchema.safeParse({
        roomTypeId: 1,
        checkInDate: '2026-02-30',
        checkOutDate: '2026-03-02',
      }).success,
    ).toBe(false);
  });
});

describe('房态状态机常量（database-design §5.2）', () => {
  it('人工迁移中 OCCUPIED 不可作为目标或来源', () => {
    expect(ROOM_STATUS_MANUAL_TRANSITIONS.OCCUPIED).toEqual([]);
    for (const status of ROOM_STATUSES) {
      if (status === 'OCCUPIED') continue;
      expect(ROOM_STATUS_MANUAL_TRANSITIONS[status]).not.toContain('OCCUPIED');
    }
  });

  it('清洁完成与停用/维修迁移齐全', () => {
    expect(ROOM_STATUS_MANUAL_TRANSITIONS.VACANT_DIRTY).toContain('VACANT_CLEAN');
    expect(ROOM_STATUS_MANUAL_TRANSITIONS.DISABLED).toEqual(['VACANT_DIRTY']);
    expect(ROOM_STATUS_MANUAL_TRANSITIONS.MAINTENANCE).toEqual(['VACANT_DIRTY', 'DISABLED']);
    expect(ADMIN_ONLY_ROOM_STATUSES).toEqual(['MAINTENANCE', 'DISABLED']);
  });
});

import { describe, expect, it } from 'vitest';

import { cancelBookingSchema, createBookingSchema } from '../src/bookings.js';
import { BOOKING_STATUS_TRANSITIONS } from '../src/states.js';

describe('createBookingSchema（api-contract B1）', () => {
  const valid = {
    guestId: 9,
    roomTypeId: 1,
    checkInDate: '2026-10-15',
    checkOutDate: '2026-10-17',
  };

  it('合法请求通过（pricePerNight/note 可选）', () => {
    expect(createBookingSchema.safeParse(valid).success).toBe(true);
    expect(
      createBookingSchema.safeParse({
        ...valid,
        pricePerNight: 288,
        note: '高楼层',
      }).success,
    ).toBe(true);
  });

  it('入住日期必须早于退房日期（同日/倒挂 422 语义）', () => {
    expect(createBookingSchema.safeParse({ ...valid, checkOutDate: '2026-10-15' }).success).toBe(
      false,
    );
    expect(createBookingSchema.safeParse({ ...valid, checkOutDate: '2026-10-14' }).success).toBe(
      false,
    );
  });

  it('拒绝无效客人/房型 id 与不存在日期', () => {
    expect(createBookingSchema.safeParse({ ...valid, guestId: 0 }).success).toBe(false);
    expect(createBookingSchema.safeParse({ ...valid, roomTypeId: -1 }).success).toBe(false);
    expect(createBookingSchema.safeParse({ ...valid, checkInDate: '2026-02-30' }).success).toBe(
      false,
    );
  });

  it('价格范围与小数位校验；不信任客户端总价（totalPrice 为未知字段 → 拒绝）', () => {
    expect(createBookingSchema.safeParse({ ...valid, pricePerNight: 0 }).success).toBe(false);
    expect(createBookingSchema.safeParse({ ...valid, pricePerNight: 288.001 }).success).toBe(false);
    expect(createBookingSchema.safeParse({ ...valid, totalPrice: 0.01 }).success).toBe(false);
  });

  it('pricePerNight 允许 null（openapi nullable），等价于缺省', () => {
    const parsed = createBookingSchema.safeParse({ ...valid, pricePerNight: null });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.pricePerNight).toBeNull();
    }
  });
});

describe('cancelBookingSchema（api-contract B4）', () => {
  it('原因可选且 ≤200 字符；未知字段拒绝', () => {
    expect(cancelBookingSchema.safeParse({}).success).toBe(true);
    expect(cancelBookingSchema.safeParse({ reason: '客人行程变更' }).success).toBe(true);
    expect(cancelBookingSchema.safeParse({ reason: 'x'.repeat(201) }).success).toBe(false);
    expect(cancelBookingSchema.safeParse({ comment: 'x' }).success).toBe(false);
  });
});

describe('预订状态机常量（database-design §5.1）', () => {
  it('仅 CONFIRMED 可迁移；终态无出边', () => {
    expect(BOOKING_STATUS_TRANSITIONS.CONFIRMED).toEqual(['CHECKED_IN', 'CANCELLED', 'NO_SHOW']);
    expect(BOOKING_STATUS_TRANSITIONS.CANCELLED).toEqual([]);
    expect(BOOKING_STATUS_TRANSITIONS.NO_SHOW).toEqual([]);
    expect(BOOKING_STATUS_TRANSITIONS.CHECKED_IN).toEqual([]);
  });
});

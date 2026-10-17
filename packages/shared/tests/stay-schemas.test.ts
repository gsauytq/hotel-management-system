import { describe, expect, it } from 'vitest';

import { checkInBookingSchema, checkoutStaySchema, createStaySchema } from '../src/stays.js';
import { STAY_STATUS_TRANSITIONS } from '../src/states.js';

describe('checkInBookingSchema（api-contract B6）', () => {
  it('仅 roomId 必填；押金/房价可选且有边界', () => {
    expect(checkInBookingSchema.safeParse({ roomId: 12 }).success).toBe(true);
    expect(
      checkInBookingSchema.safeParse({ roomId: 12, depositAmount: 200, pricePerNight: 288 })
        .success,
    ).toBe(true);
    expect(checkInBookingSchema.safeParse({ roomId: 0 }).success).toBe(false);
    expect(checkInBookingSchema.safeParse({ roomId: 12, depositAmount: -1 }).success).toBe(false);
    expect(checkInBookingSchema.safeParse({ roomId: 12, pricePerNight: 0 }).success).toBe(false);
    expect(checkInBookingSchema.safeParse({ roomId: 12, pricePerNight: 288.001 }).success).toBe(
      false,
    );
    expect(checkInBookingSchema.safeParse({ roomId: 12, something: 1 }).success).toBe(false);
  });

  it('pricePerNight 允许 null（openapi nullable），等价于缺省', () => {
    const parsed = checkInBookingSchema.safeParse({ roomId: 12, pricePerNight: null });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.pricePerNight).toBeNull();
    }
  });
});

describe('createStaySchema（api-contract S1 walk-in）', () => {
  const valid = {
    guestId: 9,
    roomId: 13,
    pricePerNight: 318,
    expectedCheckOutDate: '2026-10-16',
  };

  it('guestId/roomId/pricePerNight/expectedCheckOutDate 必填', () => {
    expect(createStaySchema.safeParse(valid).success).toBe(true);
    expect(createStaySchema.safeParse({ ...valid, pricePerNight: undefined }).success).toBe(false);
    expect(createStaySchema.safeParse({ ...valid, expectedCheckOutDate: undefined }).success).toBe(
      false,
    );
    expect(
      createStaySchema.safeParse({ ...valid, depositAmount: 0, note: '深夜到店' }).success,
    ).toBe(true);
  });

  it('拒绝非法日期与越界金额', () => {
    expect(
      createStaySchema.safeParse({ ...valid, expectedCheckOutDate: '2026-02-30' }).success,
    ).toBe(false);
    expect(createStaySchema.safeParse({ ...valid, depositAmount: 100000 }).success).toBe(false);
    expect(createStaySchema.safeParse({ ...valid, pricePerNight: -5 }).success).toBe(false);
  });
});

describe('checkoutStaySchema（api-contract S4）', () => {
  it('paymentMethod 必填且为枚举；杂费 0–20 项、金额/名称受校验', () => {
    expect(checkoutStaySchema.safeParse({ paymentMethod: 'WECHAT' }).success).toBe(true);
    expect(
      checkoutStaySchema.safeParse({
        paymentMethod: 'MIXED',
        miscItems: [{ name: '迷你吧消费', amount: 38 }],
        note: '客人对房费无异议',
      }).success,
    ).toBe(true);

    expect(checkoutStaySchema.safeParse({}).success).toBe(false);
    expect(checkoutStaySchema.safeParse({ paymentMethod: 'CASH_ONLINE' }).success).toBe(false);
    expect(
      checkoutStaySchema.safeParse({ paymentMethod: 'CASH', miscItems: [{ name: '', amount: 1 }] })
        .success,
    ).toBe(false);
    expect(
      checkoutStaySchema.safeParse({ paymentMethod: 'CASH', miscItems: [{ name: 'x', amount: 0 }] })
        .success,
    ).toBe(false);
    expect(
      checkoutStaySchema.safeParse({
        paymentMethod: 'CASH',
        miscItems: Array.from({ length: 21 }, (_, index) => ({ name: `项${index}`, amount: 1 })),
      }).success,
    ).toBe(false);
    expect(checkoutStaySchema.safeParse({ paymentMethod: 'CASH', unknownField: 1 }).success).toBe(
      false,
    );
  });
});

describe('入住状态机常量（database-design §5.3）', () => {
  it('仅 CHECKED_IN → CHECKED_OUT；CHECKED_OUT 为终态', () => {
    expect(STAY_STATUS_TRANSITIONS.CHECKED_IN).toEqual(['CHECKED_OUT']);
    expect(STAY_STATUS_TRANSITIONS.CHECKED_OUT).toEqual([]);
  });
});

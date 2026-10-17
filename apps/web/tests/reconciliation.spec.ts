import type { BookingDetailDto, OrderDto, OrderSummaryDto, StayDetailDto } from '@hms/shared';
import { describe, expect, it, vi } from 'vitest';

import { ApiRequestError } from '../src/utils/errors';
import {
  reconcileCheckIn,
  reconcileCheckout,
  shouldReconcileCheckInError,
} from '../src/views/stays/reconciliation';

function booking(overrides: Partial<BookingDetailDto> = {}): BookingDetailDto {
  return {
    id: 301,
    guestId: 9,
    guestName: '张三',
    guestPhone: '13800138000',
    roomTypeId: 1,
    roomTypeName: '标准大床房',
    checkInDate: '2026-10-17',
    checkOutDate: '2026-10-19',
    roomCount: 1,
    pricePerNight: 288,
    totalPrice: 576,
    status: 'CONFIRMED',
    note: null,
    createdAt: '2026-10-14T06:10:00.000Z',
    updatedAt: '2026-10-14T06:10:00.000Z',
    stayId: null,
    cancelledAt: null,
    cancelReason: null,
    ...overrides,
  };
}

const orderSummary: OrderSummaryDto = {
  id: 900,
  stayId: 501,
  guestName: '张三',
  roomNumber: '0821',
  totalAmount: 614,
  paidAmount: 414,
  paymentMethod: 'WECHAT',
  status: 'PAID',
  createdAt: '2026-10-17T04:30:00.000Z',
};

function stay(overrides: Partial<StayDetailDto> = {}): StayDetailDto {
  return {
    id: 501,
    bookingId: 301,
    guestId: 9,
    guestName: '张三',
    roomId: 12,
    roomNumber: '0821',
    roomTypeId: 1,
    roomTypeName: '标准大床房',
    pricePerNight: 288,
    checkInAt: '2026-10-17T04:00:00.000Z',
    expectedCheckOutDate: '2026-10-19',
    depositAmount: 200,
    status: 'CHECKED_IN',
    note: null,
    createdAt: '2026-10-17T04:00:00.000Z',
    updatedAt: '2026-10-17T04:00:00.000Z',
    actualCheckOutAt: null,
    currentCharges: { roomFee: 576, miscTotal: 0, total: 576, nights: 2 },
    order: null,
    ...overrides,
  };
}

const order: OrderDto = {
  id: 900,
  stayId: 501,
  status: 'PAID',
  items: [{ type: 'ROOM_FEE', name: '房费 2 晚 × 288.00', amount: 576 }],
  totalAmount: 614,
  depositAmount: 200,
  depositApplied: 200,
  paidAmount: 414,
  paymentMethod: 'WECHAT',
  note: null,
  createdAt: '2026-10-17T04:30:00.000Z',
  updatedAt: '2026-10-17T04:30:00.000Z',
};

describe('入住/退房结果核对', () => {
  it('重复入住可能返回 ROOM_NOT_ASSIGNABLE，也需查询服务端核对', () => {
    const duplicate = new ApiRequestError({
      status: 409,
      code: 'ROOM_NOT_ASSIGNABLE',
      message: '房间处于维修或停用状态，不可分配',
    });
    expect(shouldReconcileCheckInError(duplicate)).toBe(true);
    expect(
      shouldReconcileCheckInError(
        new ApiRequestError({
          status: 409,
          code: 'ROOM_OCCUPIED',
          message: '该房间在所选日期已被占用',
        }),
      ),
    ).toBe(false);
    expect(
      shouldReconcileCheckInError(
        new ApiRequestError({ message: '网络异常', isNetworkError: true }),
      ),
    ).toBe(true);
  });

  it('入住仅在服务端返回 CHECKED_IN 且有 stayId 时判定成功', async () => {
    await expect(
      reconcileCheckIn(301, async () => booking({ status: 'CHECKED_IN', stayId: 501 })),
    ).resolves.toMatchObject({ confirmed: true });

    await expect(
      reconcileCheckIn(301, async () => booking({ status: 'CONFIRMED', stayId: null })),
    ).resolves.toMatchObject({ confirmed: false });

    await expect(
      reconcileCheckIn(301, async () => {
        throw new Error('network');
      }),
    ).resolves.toEqual({ confirmed: false, detail: null });
  });

  it('退房仅在服务端返回 CHECKED_OUT 时判定完成，并加载账单明细', async () => {
    const result = await reconcileCheckout(501, {
      fetchStay: async () =>
        stay({
          status: 'CHECKED_OUT',
          actualCheckOutAt: '2026-10-17T04:30:00.000Z',
          order: orderSummary,
        }),
      fetchOrder: async () => order,
    });

    expect(result.completed).toBe(true);
    expect(result.order).toEqual(order);
    expect(result.orderError).toBeNull();
  });

  it('服务端仍为在住时不判定退房完成', async () => {
    const result = await reconcileCheckout(501, {
      fetchStay: async () => stay({ status: 'CHECKED_IN' }),
      fetchOrder: vi.fn(),
    });

    expect(result.completed).toBe(false);
    expect(result.order).toBeNull();
  });

  it('已退房但账单明细加载失败时不误报为未完成，并保留错误信息', async () => {
    const result = await reconcileCheckout(501, {
      fetchStay: async () =>
        stay({
          status: 'CHECKED_OUT',
          order: orderSummary,
        }),
      fetchOrder: async () => {
        throw new Error('账单服务异常');
      },
    });

    expect(result.completed).toBe(true);
    expect(result.order).toBeNull();
    expect(result.orderError).toBe('账单服务异常');
  });

  it('无法查询服务端状态时不判定成功', async () => {
    const result = await reconcileCheckout(501, {
      fetchStay: async () => {
        throw new Error('network');
      },
    });

    expect(result.completed).toBe(false);
  });
});

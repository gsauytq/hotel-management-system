import { describe, expect, it, vi } from 'vitest';

import type {
  OrderRecord,
  OrderSummaryRecord,
  StayRecord,
  StaysRepository,
} from '../src/modules/stays/stays.repository.js';
import { createStaysService } from '../src/modules/stays/stays.service.js';
import type { AuditEvent, AuditLogger } from '../src/utils/audit.js';
import { hotelToday } from '../src/utils/hotel-date.js';

function createRepositoryMock() {
  return {
    createStay: vi.fn<StaysRepository['createStay']>(),
    list: vi.fn<StaysRepository['list']>(),
    findById: vi.fn<StaysRepository['findById']>(),
    findOrderSummaryByStayId: vi.fn<StaysRepository['findOrderSummaryByStayId']>(),
    checkout: vi.fn<StaysRepository['checkout']>(),
  };
}

function dayOffset(offset: number): string {
  const today = new Date(`${hotelToday()}T00:00:00.000Z`);
  return new Date(today.getTime() + offset * 86_400_000).toISOString().slice(0, 10);
}

function makeStay(overrides: Partial<StayRecord> = {}): StayRecord {
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
    checkInAt: new Date('2026-10-14T06:02:11.000Z'),
    expectedCheckOutDate: new Date('2026-10-17T00:00:00.000Z'),
    actualCheckOutAt: null,
    depositAmount: 200,
    status: 'CHECKED_IN',
    note: null,
    createdBy: 1,
    createdAt: new Date('2026-10-14T06:02:11.000Z'),
    updatedAt: new Date('2026-10-14T06:02:11.000Z'),
    ...overrides,
  };
}

function makeOrder(overrides: Partial<OrderRecord> = {}): OrderRecord {
  return {
    id: 900,
    stayId: 501,
    status: 'PAID',
    items: [
      { type: 'ROOM_FEE', name: '房费 3 晚 × 288.00', amount: 864 },
      { type: 'MISC', name: '迷你吧消费', amount: 38 },
      { type: 'DEPOSIT_APPLIED', name: '押金抵扣', amount: 200 },
    ],
    totalAmount: 902,
    depositAmount: 200,
    depositApplied: 200,
    paidAmount: 702,
    paymentMethod: 'WECHAT',
    note: null,
    createdBy: 1,
    createdAt: new Date('2026-10-17T04:30:00.000Z'),
    updatedAt: new Date('2026-10-17T04:30:00.000Z'),
    ...overrides,
  };
}

function makeOrderSummary(overrides: Partial<OrderSummaryRecord> = {}): OrderSummaryRecord {
  return {
    id: 900,
    stayId: 501,
    guestName: '张三',
    roomNumber: '0821',
    totalAmount: 902,
    paidAmount: 702,
    paymentMethod: 'WECHAT',
    status: 'PAID',
    createdAt: new Date('2026-10-17T04:30:00.000Z'),
    miscTotal: 38,
    ...overrides,
  };
}

describe('stays.service 入住（B6/S1）', () => {
  it('B6：预订入住透传 bookingId 与操作员工，房间客人由预订决定', async () => {
    const repository = createRepositoryMock();
    repository.createStay.mockResolvedValue({ outcome: 'created', stay: makeStay() });
    const service = createStaysService({ repository, audit: vi.fn<AuditLogger>() });

    const dto = await service.checkInBooking(301, { roomId: 12, depositAmount: 200 }, 7);

    expect(repository.createStay).toHaveBeenCalledWith(
      expect.objectContaining({
        bookingId: 301,
        guestId: undefined,
        roomId: 12,
        depositAmount: 200,
        pricePerNight: undefined,
        createdBy: 7,
        hotelToday: hotelToday(),
      }),
    );
    expect(dto).toMatchObject({
      id: 501,
      bookingId: 301,
      guestName: '张三',
      roomNumber: '0821',
      roomTypeName: '标准大床房',
      status: 'CHECKED_IN',
      checkInAt: '2026-10-14T06:02:11.000Z',
      expectedCheckOutDate: '2026-10-17',
    });
  });

  it('S1：离店日期必须晚于酒店今日（次日边界允许，同日/过去 422）', async () => {
    const repository = createRepositoryMock();
    repository.createStay.mockResolvedValue({
      outcome: 'created',
      stay: makeStay({ bookingId: null }),
    });
    const service = createStaysService({ repository, audit: vi.fn<AuditLogger>() });

    await expect(
      service.createWalkIn(
        { guestId: 9, roomId: 13, pricePerNight: 318, expectedCheckOutDate: dayOffset(0) },
        1,
      ),
    ).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
      status: 422,
      details: [{ field: 'expectedCheckOutDate' }],
    });
    expect(repository.createStay).not.toHaveBeenCalled();

    await expect(
      service.createWalkIn(
        { guestId: 9, roomId: 13, pricePerNight: 318, expectedCheckOutDate: dayOffset(1) },
        1,
      ),
    ).resolves.toMatchObject({ bookingId: null });
  });

  it('异常映射：房间占用/房态/日期/重复办理/资源不存在', async () => {
    const repository = createRepositoryMock();
    const service = createStaysService({ repository, audit: vi.fn<AuditLogger>() });
    const input = { roomId: 12 };
    const cases = [
      [{ outcome: 'room_occupied' }, 'ROOM_OCCUPIED', 409],
      [{ outcome: 'room_not_assignable', roomStatus: 'MAINTENANCE' }, 'ROOM_NOT_ASSIGNABLE', 409],
      [{ outcome: 'room_type_mismatch' }, 'ROOM_NOT_ASSIGNABLE', 409],
      [{ outcome: 'booking_invalid', bookingStatus: 'CHECKED_IN' }, 'BOOKING_STATUS_INVALID', 409],
      [{ outcome: 'booking_date_mismatch' }, 'BOOKING_DATE_MISMATCH', 409],
      [{ outcome: 'booking_expired' }, 'BOOKING_DATE_MISMATCH', 409],
      [{ outcome: 'booking_not_found' }, 'NOT_FOUND', 404],
      [{ outcome: 'room_not_found' }, 'NOT_FOUND', 404],
      [{ outcome: 'guest_not_found' }, 'NOT_FOUND', 404],
    ] as const;

    for (const [outcome, code, status] of cases) {
      repository.createStay.mockResolvedValueOnce(outcome as never);
      await expect(service.checkInBooking(301, input, 1)).rejects.toMatchObject({ code, status });
    }
  });
});

describe('stays.service 列表与详情（S2/S3）', () => {
  it('列表分页与筛选透传；日期格式化', async () => {
    const repository = createRepositoryMock();
    repository.list.mockResolvedValue({ total: 1, items: [makeStay()] });
    const service = createStaysService({ repository, audit: vi.fn<AuditLogger>() });

    const result = await service.list({
      status: 'CHECKED_IN',
      roomId: 12,
      keyword: '张',
      page: 1,
      pageSize: 20,
      orderBy: [{ checkInAt: 'desc' }],
    });
    expect(repository.list).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'CHECKED_IN', roomId: 12, keyword: '张' }),
    );
    expect(result.pagination.total).toBe(1);
    expect(result.items[0]?.expectedCheckOutDate).toBe('2026-10-17');
  });

  it('在住详情：currentCharges 按预计晚数计算，杂费为 0，order 为 null', async () => {
    const repository = createRepositoryMock();
    repository.findById.mockResolvedValue(makeStay());
    repository.findOrderSummaryByStayId.mockResolvedValue(null);
    const service = createStaysService({ repository, audit: vi.fn<AuditLogger>() });

    const detail = await service.getById(501);
    expect(detail.actualCheckOutAt).toBeNull();
    expect(detail.currentCharges).toEqual({
      roomFee: 864, // 3 晚 × 288
      miscTotal: 0,
      total: 864,
      nights: 3,
    });
    expect(detail.order).toBeNull();
  });

  it('在住详情：凌晨入住（UTC 前一日）按酒店本地日历日计晚数（审查 P-1）', async () => {
    const repository = createRepositoryMock();
    repository.findById.mockResolvedValue(
      makeStay({
        pricePerNight: 100,
        // 上海 2026-10-15 00:30（UTC 2026-10-14 16:30）→ 酒店日历日 10-15，预计 10-16 离店 = 1 晚
        checkInAt: new Date('2026-10-14T16:30:00.000Z'),
        expectedCheckOutDate: new Date('2026-10-16T00:00:00.000Z'),
      }),
    );
    repository.findOrderSummaryByStayId.mockResolvedValue(null);
    const service = createStaysService({ repository, audit: vi.fn<AuditLogger>() });

    const detail = await service.getById(501);
    expect(detail.currentCharges).toEqual({
      roomFee: 100,
      miscTotal: 0,
      total: 100,
      nights: 1,
    });
  });

  it('已退房详情：含 actualCheckOutAt、订单摘要，杂费由账单反推', async () => {
    const repository = createRepositoryMock();
    repository.findById.mockResolvedValue(
      makeStay({
        status: 'CHECKED_OUT',
        actualCheckOutAt: new Date('2026-10-17T04:30:00.000Z'),
      }),
    );
    repository.findOrderSummaryByStayId.mockResolvedValue(makeOrderSummary());
    const service = createStaysService({ repository, audit: vi.fn<AuditLogger>() });

    const detail = await service.getById(501);
    expect(detail.actualCheckOutAt).toBe('2026-10-17T04:30:00.000Z');
    expect(detail.currentCharges).toEqual({
      roomFee: 864,
      miscTotal: 38,
      total: 902,
      nights: 3,
    });
    expect(detail.order).toMatchObject({ id: 900, totalAmount: 902, paymentMethod: 'WECHAT' });
  });

  it('详情不存在 → 404', async () => {
    const repository = createRepositoryMock();
    repository.findById.mockResolvedValue(null);
    const service = createStaysService({ repository, audit: vi.fn<AuditLogger>() });
    await expect(service.getById(999)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

describe('stays.service 退房（S4）', () => {
  it('成功：透传支付方式/杂费/操作员工并返回账单 DTO', async () => {
    const repository = createRepositoryMock();
    repository.checkout.mockResolvedValue({ outcome: 'checked_out', order: makeOrder() });
    const audit = vi.fn<AuditLogger>();
    const service = createStaysService({ repository, audit });

    const order = await service.checkout(
      501,
      {
        paymentMethod: 'WECHAT',
        miscItems: [{ name: '迷你吧消费', amount: 38 }],
        note: '客人对房费无异议',
      },
      { actorId: 7, requestId: 'req-checkout' },
    );

    expect(repository.checkout).toHaveBeenCalledWith(501, {
      paymentMethod: 'WECHAT',
      miscItems: [{ name: '迷你吧消费', amount: 38 }],
      note: '客人对房费无异议',
      createdBy: 7,
      now: expect.any(Date),
      hotelToday: hotelToday(),
    });
    expect(order).toMatchObject({
      id: 900,
      stayId: 501,
      status: 'PAID',
      totalAmount: 902,
      depositApplied: 200,
      paidAmount: 702,
      paymentMethod: 'WECHAT',
    });
    expect(order.items).toHaveLength(3);
    // security-design §9：退房结算写审计日志
    expect(audit.mock.calls[0]?.[0] as AuditEvent | undefined).toMatchObject({
      action: 'stay.checkout',
      outcome: 'SUCCESS',
      actorId: 7,
      target: 'stay:501',
      requestId: 'req-checkout',
    });
  });

  it('重复退房/并发冲突 → 409 STAY_STATUS_INVALID；不存在 → 404', async () => {
    const repository = createRepositoryMock();
    const service = createStaysService({ repository, audit: vi.fn<AuditLogger>() });
    const context = { actorId: 1, requestId: 'req-2' };

    repository.checkout.mockResolvedValueOnce({ outcome: 'invalid_status', status: 'CHECKED_OUT' });
    await expect(service.checkout(501, { paymentMethod: 'CASH' }, context)).rejects.toMatchObject({
      code: 'STAY_STATUS_INVALID',
      status: 409,
      message: '该入住记录已退房，不可重复结算',
    });

    repository.checkout.mockResolvedValueOnce({ outcome: 'conflict' });
    await expect(service.checkout(501, { paymentMethod: 'CASH' }, context)).rejects.toMatchObject({
      code: 'STAY_STATUS_INVALID',
    });

    repository.checkout.mockResolvedValueOnce({ outcome: 'not_found' });
    await expect(service.checkout(999, { paymentMethod: 'CASH' }, context)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });
});

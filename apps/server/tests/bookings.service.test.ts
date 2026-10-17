import { describe, expect, it, vi } from 'vitest';

import type {
  BookingRecord,
  BookingsRepository,
} from '../src/modules/bookings/bookings.repository.js';
import { createBookingsService } from '../src/modules/bookings/bookings.service.js';
import { hotelToday } from '../src/utils/hotel-date.js';

function createRepositoryMock() {
  return {
    create: vi.fn<BookingsRepository['create']>(),
    list: vi.fn<BookingsRepository['list']>(),
    findById: vi.fn<BookingsRepository['findById']>(),
    cancel: vi.fn<BookingsRepository['cancel']>(),
    markNoShow: vi.fn<BookingsRepository['markNoShow']>(),
  };
}

function makeBooking(overrides: Partial<BookingRecord> = {}): BookingRecord {
  return {
    id: 301,
    guestId: 9,
    guestName: '张三',
    guestPhone: '13800138000',
    roomTypeId: 1,
    roomTypeName: '标准大床房',
    checkInDate: new Date('2026-11-01T00:00:00.000Z'),
    checkOutDate: new Date('2026-11-03T00:00:00.000Z'),
    roomCount: 1,
    pricePerNight: 288,
    totalPrice: 576,
    status: 'CONFIRMED',
    note: '高楼层',
    createdBy: 1,
    cancelledAt: null,
    cancelReason: null,
    stayId: null,
    createdAt: new Date('2026-10-14T06:10:00.000Z'),
    updatedAt: new Date('2026-10-14T06:10:00.000Z'),
    ...overrides,
  };
}

/** 相对“酒店今日”的日期，确保测试不受运行时刻/时区影响 */
function dayOffset(offset: number): string {
  const today = new Date(`${hotelToday()}T00:00:00.000Z`);
  return new Date(today.getTime() + offset * 86_400_000).toISOString().slice(0, 10);
}

describe('bookings.service 创建（B1）', () => {
  it('成功：价格快照与总价由服务端计算（nights × price × roomCount），映射 DTO', async () => {
    const repository = createRepositoryMock();
    repository.create.mockResolvedValue({ outcome: 'created', booking: makeBooking() });
    const service = createBookingsService({ repository });

    const dto = await service.create(
      {
        guestId: 9,
        roomTypeId: 1,
        checkInDate: '2026-11-01',
        checkOutDate: '2026-11-03',
        pricePerNight: 288,
        note: '高楼层',
      },
      1,
    );

    expect(repository.create).toHaveBeenCalledWith({
      guestId: 9,
      roomTypeId: 1,
      checkInDate: new Date('2026-11-01T00:00:00.000Z'),
      checkOutDate: new Date('2026-11-03T00:00:00.000Z'),
      pricePerNight: 288,
      note: '高楼层',
      createdBy: 1,
      roomCount: 1,
      nights: 2,
    });
    expect(dto).toMatchObject({
      id: 301,
      checkInDate: '2026-11-01',
      checkOutDate: '2026-11-03',
      pricePerNight: 288,
      totalPrice: 576,
      status: 'CONFIRMED',
      guestName: '张三',
      roomTypeName: '标准大床房',
    });
  });

  it('缺省价格：pricePerNight 不传时由仓储取房型基准价（A-12）', async () => {
    const repository = createRepositoryMock();
    repository.create.mockResolvedValue({
      outcome: 'created',
      booking: makeBooking({ pricePerNight: 299.5, totalPrice: 299.5 }),
    });
    const service = createBookingsService({ repository });

    const dto = await service.create(
      { guestId: 9, roomTypeId: 1, checkInDate: dayOffset(1), checkOutDate: dayOffset(2) },
      1,
    );
    expect(repository.create).toHaveBeenCalledWith(
      expect.objectContaining({ pricePerNight: undefined, nights: 1 }),
    );
    expect(dto.pricePerNight).toBe(299.5);
  });

  it('入住日早于酒店今日 → 422（服务端基于上海时区判断，不依赖服务器本地时区）', async () => {
    const repository = createRepositoryMock();
    const service = createBookingsService({ repository });

    await expect(
      service.create(
        { guestId: 9, roomTypeId: 1, checkInDate: dayOffset(-1), checkOutDate: dayOffset(1) },
        1,
      ),
    ).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
      status: 422,
      details: [{ field: 'checkInDate', message: '入住日期不能早于今日（酒店本地日）' }],
    });
    expect(repository.create).not.toHaveBeenCalled();
  });

  it('入住日 = 酒店今日（边界）允许创建', async () => {
    const repository = createRepositoryMock();
    repository.create.mockResolvedValue({
      outcome: 'created',
      booking: makeBooking({
        checkInDate: new Date(`${dayOffset(0)}T00:00:00.000Z`),
        checkOutDate: new Date(`${dayOffset(1)}T00:00:00.000Z`),
      }),
    });
    const service = createBookingsService({ repository });

    await expect(
      service.create(
        { guestId: 9, roomTypeId: 1, checkInDate: dayOffset(0), checkOutDate: dayOffset(1) },
        1,
      ),
    ).resolves.toMatchObject({ status: 'CONFIRMED' });
  });

  it('售罄 → 409 ROOM_TYPE_SOLD_OUT（含剩余可售 details）', async () => {
    const repository = createRepositoryMock();
    repository.create.mockResolvedValue({ outcome: 'sold_out', remaining: 0 });
    const service = createBookingsService({ repository });

    await expect(
      service.create(
        { guestId: 9, roomTypeId: 1, checkInDate: '2026-11-01', checkOutDate: '2026-11-03' },
        1,
      ),
    ).rejects.toMatchObject({
      code: 'ROOM_TYPE_SOLD_OUT',
      status: 409,
      details: [{ field: 'checkOutDate', message: '剩余可售: 0' }],
    });
  });

  it('归档房型 → 409；房型/客人不存在 → 404', async () => {
    const repository = createRepositoryMock();
    const service = createBookingsService({ repository });
    const input = {
      guestId: 9,
      roomTypeId: 1,
      checkInDate: '2026-11-01',
      checkOutDate: '2026-11-02',
    };

    repository.create.mockResolvedValueOnce({ outcome: 'room_type_archived' });
    await expect(service.create(input, 1)).rejects.toMatchObject({
      code: 'ROOM_TYPE_ARCHIVED',
      status: 409,
    });

    repository.create.mockResolvedValueOnce({ outcome: 'room_type_not_found' });
    await expect(service.create(input, 1)).rejects.toMatchObject({ code: 'NOT_FOUND' });

    repository.create.mockResolvedValueOnce({ outcome: 'guest_not_found' });
    await expect(service.create(input, 1)).rejects.toMatchObject({
      code: 'NOT_FOUND',
      message: '客人不存在',
    });
  });
});

describe('bookings.service 列表与详情（B2/B3）', () => {
  it('列表分页与日期格式化；筛选参数透传仓储', async () => {
    const repository = createRepositoryMock();
    repository.list.mockResolvedValue({ total: 3, items: [makeBooking()] });
    const service = createBookingsService({ repository });

    const result = await service.list({
      status: 'CONFIRMED',
      guestId: 9,
      checkInDateFrom: '2026-11-01',
      checkOutDateTo: '2026-11-30',
      keyword: '张',
      page: 1,
      pageSize: 20,
      orderBy: [{ createdAt: 'desc' }],
    });

    expect(repository.list).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'CONFIRMED', guestId: 9, keyword: '张' }),
    );
    expect(result.pagination).toEqual({ page: 1, pageSize: 20, total: 3, totalPages: 1 });
    expect(result.items[0]?.checkInDate).toBe('2026-11-01');
  });

  it('详情：不存在 404；已入住含 stayId；取消信息映射', async () => {
    const repository = createRepositoryMock();
    const service = createBookingsService({ repository });

    repository.findById.mockResolvedValueOnce(null);
    await expect(service.getById(999)).rejects.toMatchObject({ code: 'NOT_FOUND' });

    repository.findById.mockResolvedValueOnce(
      makeBooking({
        status: 'CHECKED_IN',
        stayId: 501,
        cancelledAt: new Date('2026-10-14T07:00:00.000Z'),
        cancelReason: '客人行程变更',
      }),
    );
    const detail = await service.getById(301);
    expect(detail).toMatchObject({
      stayId: 501,
      cancelledAt: '2026-10-14T07:00:00.000Z',
      cancelReason: '客人行程变更',
    });
  });
});

describe('bookings.service 状态流转（B4/B5）', () => {
  it('取消：成功映射 CANCELLED/cancelledAt；非 CONFIRMED → 409 统一文案；不存在 404', async () => {
    const repository = createRepositoryMock();
    const service = createBookingsService({ repository });

    repository.cancel.mockResolvedValueOnce({
      outcome: 'updated',
      booking: makeBooking({
        status: 'CANCELLED',
        cancelledAt: new Date('2026-10-14T08:00:00.000Z'),
        cancelReason: '客人行程变更',
      }),
    });
    const cancelled = await service.cancel(301, { reason: '客人行程变更' });
    expect(cancelled).toMatchObject({
      status: 'CANCELLED',
      cancelledAt: '2026-10-14T08:00:00.000Z',
      cancelReason: '客人行程变更',
    });
    expect(repository.cancel).toHaveBeenCalledWith(301, {
      reason: '客人行程变更',
      now: expect.any(Date),
    });

    repository.cancel.mockResolvedValueOnce({ outcome: 'invalid_status', status: 'CHECKED_IN' });
    await expect(service.cancel(301, {})).rejects.toMatchObject({
      code: 'BOOKING_STATUS_INVALID',
      status: 409,
      message: '仅已确认预订可取消',
    });

    repository.cancel.mockResolvedValueOnce({ outcome: 'not_found' });
    await expect(service.cancel(999, {})).rejects.toMatchObject({ code: 'NOT_FOUND' });

    repository.cancel.mockResolvedValueOnce({ outcome: 'conflict' });
    await expect(service.cancel(301, {})).rejects.toMatchObject({ code: 'BOOKING_STATUS_INVALID' });
  });

  it('标记未到：成功；未到入住日 → 409；非 CONFIRMED → 409', async () => {
    const repository = createRepositoryMock();
    const service = createBookingsService({ repository });

    repository.markNoShow.mockResolvedValueOnce({
      outcome: 'updated',
      booking: makeBooking({ status: 'NO_SHOW' }),
    });
    await expect(service.markNoShow(301)).resolves.toMatchObject({ status: 'NO_SHOW' });

    repository.markNoShow.mockResolvedValueOnce({ outcome: 'not_yet_due' });
    await expect(service.markNoShow(301)).rejects.toMatchObject({
      code: 'BOOKING_STATUS_INVALID',
      message: '未到入住日，暂不可标记未到',
    });

    repository.markNoShow.mockResolvedValueOnce({ outcome: 'invalid_status', status: 'CANCELLED' });
    await expect(service.markNoShow(301)).rejects.toMatchObject({
      message: '仅已确认预订可标记未到',
    });

    repository.markNoShow.mockResolvedValueOnce({ outcome: 'conflict' });
    await expect(service.markNoShow(301)).rejects.toMatchObject({ code: 'BOOKING_STATUS_INVALID' });
  });
});

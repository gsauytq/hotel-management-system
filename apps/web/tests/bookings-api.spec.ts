import {
  AxiosHeaders,
  type AxiosAdapter,
  type AxiosResponse,
  type InternalAxiosRequestConfig,
} from 'axios';
import { afterEach, describe, expect, it } from 'vitest';

import {
  cancelBooking,
  createBooking,
  getBooking,
  listBookings,
  markBookingNoShow,
} from '../src/api/bookings';
import { listGuests } from '../src/api/guests';
import { http } from '../src/api/request';

const originalAdapter = http.defaults.adapter;

function installReply(payload: unknown): InternalAxiosRequestConfig[] {
  const calls: InternalAxiosRequestConfig[] = [];
  const adapter: AxiosAdapter = async (config) => {
    calls.push(config);
    const response: AxiosResponse = {
      data: { data: payload },
      status: 200,
      statusText: 'OK',
      headers: new AxiosHeaders(),
      config,
    };
    return response;
  };
  http.defaults.adapter = adapter;
  return calls;
}

function sentBody(config: InternalAxiosRequestConfig | undefined): unknown {
  if (config?.data === undefined) return undefined;
  if (typeof config.data === 'string') return JSON.parse(config.data) as unknown;
  return config.data;
}

describe('预订 API 调用契约', () => {
  afterEach(() => {
    http.defaults.adapter = originalAdapter;
  });

  it('列表发送契约支持的筛选与分页参数，并省略空值', async () => {
    let calls = installReply({
      items: [],
      pagination: { page: 1, pageSize: 20, total: 0, totalPages: 0 },
    });
    await listBookings({
      page: 1,
      pageSize: 20,
      status: 'CONFIRMED',
      guestId: 9,
      keyword: '张',
      checkInDateFrom: '2026-10-14',
      checkInDateTo: '2026-10-20',
      checkOutDateFrom: '2026-10-15',
      checkOutDateTo: '2026-10-21',
      sort: 'createdAt:desc',
    });
    expect(calls[0]?.method).toBe('get');
    expect(calls[0]?.url).toBe('/bookings');
    expect(calls[0]?.params).toEqual({
      page: 1,
      pageSize: 20,
      status: 'CONFIRMED',
      guestId: 9,
      keyword: '张',
      checkInDateFrom: '2026-10-14',
      checkInDateTo: '2026-10-20',
      checkOutDateFrom: '2026-10-15',
      checkOutDateTo: '2026-10-21',
      sort: 'createdAt:desc',
    });

    calls = installReply({
      items: [],
      pagination: { page: 2, pageSize: 10, total: 0, totalPages: 0 },
    });
    await listBookings({ page: 2, pageSize: 10, keyword: '' });
    expect(calls[0]?.params).toEqual({ page: 2, pageSize: 10 });
  });

  it('详情/创建/取消/未到路径、方法与请求体正确', async () => {
    let calls = installReply({ id: 301 });
    await getBooking(301);
    expect(calls[0]?.method).toBe('get');
    expect(calls[0]?.url).toBe('/bookings/301');

    const createPayload = {
      guestId: 9,
      roomTypeId: 1,
      checkInDate: '2026-10-15',
      checkOutDate: '2026-10-17',
      note: '高楼层',
    };
    calls = installReply({ id: 301 });
    await createBooking(createPayload);
    expect(calls[0]?.method).toBe('post');
    expect(calls[0]?.url).toBe('/bookings');
    expect(sentBody(calls[0])).toEqual(createPayload);

    calls = installReply({ id: 301 });
    await cancelBooking(301, { reason: '客人行程变更' });
    expect(calls[0]?.method).toBe('post');
    expect(calls[0]?.url).toBe('/bookings/301/cancel');
    expect(sentBody(calls[0])).toEqual({ reason: '客人行程变更' });

    calls = installReply({ id: 301 });
    await markBookingNoShow(301);
    expect(calls[0]?.method).toBe('post');
    expect(calls[0]?.url).toBe('/bookings/301/no-show');
  });

  it('客人选择使用 G1 列表契约', async () => {
    const calls = installReply({
      items: [],
      pagination: { page: 1, pageSize: 20, total: 0, totalPages: 0 },
    });
    await listGuests({ page: 1, pageSize: 20, keyword: '张', sort: 'createdAt:desc' });

    expect(calls[0]?.method).toBe('get');
    expect(calls[0]?.url).toBe('/guests');
    expect(calls[0]?.params).toEqual({
      page: 1,
      pageSize: 20,
      keyword: '张',
      sort: 'createdAt:desc',
    });
  });
});

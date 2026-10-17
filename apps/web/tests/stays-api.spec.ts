import {
  AxiosHeaders,
  type AxiosAdapter,
  type AxiosResponse,
  type InternalAxiosRequestConfig,
} from 'axios';
import { afterEach, describe, expect, it } from 'vitest';

import { getOrder } from '../src/api/orders';
import { http } from '../src/api/request';
import { listAvailableRooms } from '../src/api/rooms';
import { checkInBooking, checkoutStay, getStay, listStays } from '../src/api/stays';

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

describe('入住/退房 API 调用契约', () => {
  afterEach(() => {
    http.defaults.adapter = originalAdapter;
  });

  it('S2 列表发送分页/状态/客人/排序参数，并省略空值', async () => {
    let calls = installReply({
      items: [],
      pagination: { page: 1, pageSize: 20, total: 0, totalPages: 0 },
    });
    await listStays({
      page: 1,
      pageSize: 20,
      status: 'CHECKED_IN',
      roomId: 12,
      keyword: '张',
      sort: 'checkInAt:desc',
    });
    expect(calls[0]?.method).toBe('get');
    expect(calls[0]?.url).toBe('/stays');
    expect(calls[0]?.params).toEqual({
      page: 1,
      pageSize: 20,
      status: 'CHECKED_IN',
      roomId: 12,
      keyword: '张',
      sort: 'checkInAt:desc',
    });

    calls = installReply({
      items: [],
      pagination: { page: 1, pageSize: 10, total: 0, totalPages: 0 },
    });
    await listStays({ page: 1, pageSize: 10, keyword: '' });
    expect(calls[0]?.params).toEqual({ page: 1, pageSize: 10 });
  });

  it('S3 详情与 M2 可分配房间路径/参数正确', async () => {
    let calls = installReply({ id: 501 });
    await getStay(501);
    expect(calls[0]?.method).toBe('get');
    expect(calls[0]?.url).toBe('/stays/501');

    calls = installReply({ items: [] });
    await listAvailableRooms({
      roomTypeId: 1,
      checkInDate: '2026-10-17',
      checkOutDate: '2026-10-19',
    });
    expect(calls[0]?.method).toBe('get');
    expect(calls[0]?.url).toBe('/rooms/available');
    expect(calls[0]?.params).toEqual({
      roomTypeId: 1,
      checkInDate: '2026-10-17',
      checkOutDate: '2026-10-19',
    });
  });

  it('B6 入住、S4 退房与 O2 账单路径/请求体正确', async () => {
    let calls = installReply({ id: 501 });
    await checkInBooking(301, { roomId: 12, depositAmount: 200 });
    expect(calls[0]?.method).toBe('post');
    expect(calls[0]?.url).toBe('/bookings/301/check-in');
    expect(sentBody(calls[0])).toEqual({ roomId: 12, depositAmount: 200 });

    const checkoutPayload = {
      paymentMethod: 'WECHAT' as const,
      miscItems: [{ name: '迷你吧消费', amount: 38 }],
      note: '客人无异议',
    };
    calls = installReply({ id: 900 });
    await checkoutStay(501, checkoutPayload);
    expect(calls[0]?.method).toBe('post');
    expect(calls[0]?.url).toBe('/stays/501/checkout');
    expect(sentBody(calls[0])).toEqual(checkoutPayload);

    calls = installReply({ id: 900 });
    await getOrder(900);
    expect(calls[0]?.method).toBe('get');
    expect(calls[0]?.url).toBe('/orders/900');
  });
});

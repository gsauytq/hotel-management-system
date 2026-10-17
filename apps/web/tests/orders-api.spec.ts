import {
  AxiosHeaders,
  type AxiosAdapter,
  type AxiosResponse,
  type InternalAxiosRequestConfig,
} from 'axios';
import { afterEach, describe, expect, it } from 'vitest';

import { getOrder, listOrders, toOrderListParams } from '../src/api/orders';
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

describe('账单 API 调用契约', () => {
  afterEach(() => {
    http.defaults.adapter = originalAdapter;
  });

  it('O1 列表发送后端支持的日期/入住记录/分页/排序参数', async () => {
    const calls = installReply({
      items: [],
      pagination: { page: 2, pageSize: 20, total: 0, totalPages: 0 },
    });
    await listOrders({
      page: 2,
      pageSize: 20,
      stayId: 501,
      createdFrom: '2026-10-01',
      createdTo: '2026-10-31',
      sort: 'createdAt:desc',
    });

    expect(calls[0]?.method).toBe('get');
    expect(calls[0]?.url).toBe('/orders');
    expect(calls[0]?.params).toEqual({
      page: 2,
      pageSize: 20,
      stayId: 501,
      createdFrom: '2026-10-01',
      createdTo: '2026-10-31',
      sort: 'createdAt:desc',
    });
  });

  it('空筛选参数被省略，O2 详情路径正确', async () => {
    let calls = installReply({
      items: [],
      pagination: { page: 1, pageSize: 10, total: 0, totalPages: 0 },
    });
    await listOrders({ page: 1, pageSize: 10 });
    expect(calls[0]?.params).toEqual({ page: 1, pageSize: 10 });

    calls = installReply({ id: 900 });
    await getOrder(900);
    expect(calls[0]?.method).toBe('get');
    expect(calls[0]?.url).toBe('/orders/900');
  });

  it('参数映射不包含契约不支持的 status/customer 字段', () => {
    const params = toOrderListParams({ page: 1, pageSize: 10 });
    expect(Object.keys(params).sort()).toEqual(['page', 'pageSize']);
  });
});

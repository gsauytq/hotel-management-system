import {
  AxiosHeaders,
  type AxiosAdapter,
  type AxiosResponse,
  type InternalAxiosRequestConfig,
} from 'axios';
import { afterEach, describe, expect, it } from 'vitest';

import { createGuest, getGuest, listGuests, updateGuest } from '../src/api/guests';
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

describe('客人 API 调用契约', () => {
  afterEach(() => {
    http.defaults.adapter = originalAdapter;
  });

  it('G1 列表、G3 详情、G2 创建、G4 更新路径与请求体正确', async () => {
    let calls = installReply({
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

    calls = installReply({ id: 9 });
    await getGuest(9);
    expect(calls[0]?.method).toBe('get');
    expect(calls[0]?.url).toBe('/guests/9');

    const createPayload = {
      name: '张三',
      phone: '13800138000',
      idType: 'ID_CARD' as const,
      idNumber: '110101199001011234',
      remark: 'VIP',
    };
    calls = installReply({ id: 9 });
    await createGuest(createPayload);
    expect(calls[0]?.method).toBe('post');
    expect(calls[0]?.url).toBe('/guests');
    expect(sentBody(calls[0])).toEqual(createPayload);

    calls = installReply({ id: 9 });
    await updateGuest(9, { phone: '13900139000', remark: '已更新联系方式' });
    expect(calls[0]?.method).toBe('patch');
    expect(calls[0]?.url).toBe('/guests/9');
    expect(sentBody(calls[0])).toEqual({
      phone: '13900139000',
      remark: '已更新联系方式',
    });
  });
});

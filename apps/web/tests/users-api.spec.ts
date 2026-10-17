import {
  AxiosHeaders,
  type AxiosAdapter,
  type AxiosResponse,
  type InternalAxiosRequestConfig,
} from 'axios';
import { afterEach, describe, expect, it } from 'vitest';

import { http } from '../src/api/request';
import { createUser, getUser, listUsers, resetUserPassword, updateUser } from '../src/api/users';

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

describe('员工 API 调用契约', () => {
  afterEach(() => {
    http.defaults.adapter = originalAdapter;
  });

  it('U1 列表发送分页/角色/状态/关键字/排序参数', async () => {
    const calls = installReply({
      items: [],
      pagination: { page: 1, pageSize: 20, total: 0, totalPages: 0 },
    });
    await listUsers({
      page: 1,
      pageSize: 20,
      role: 'ADMIN',
      status: 'ACTIVE',
      keyword: '王',
      sort: 'createdAt:desc',
    });

    expect(calls[0]?.method).toBe('get');
    expect(calls[0]?.url).toBe('/users');
    expect(calls[0]?.params).toEqual({
      page: 1,
      pageSize: 20,
      role: 'ADMIN',
      status: 'ACTIVE',
      keyword: '王',
      sort: 'createdAt:desc',
    });
  });

  it('U5/U2/U3/U4 路径、方法与请求体正确', async () => {
    let calls = installReply({ id: 2 });
    await getUser(2);
    expect(calls[0]?.method).toBe('get');
    expect(calls[0]?.url).toBe('/users/2');

    const createPayload = {
      username: 'front02',
      password: 'Init#12345',
      displayName: '李雷',
      role: 'RECEPTIONIST' as const,
    };
    calls = installReply({ id: 2 });
    await createUser(createPayload);
    expect(calls[0]?.method).toBe('post');
    expect(calls[0]?.url).toBe('/users');
    expect(sentBody(calls[0])).toEqual(createPayload);

    calls = installReply({ id: 2 });
    await updateUser(2, { displayName: '李雷（值班）', role: 'ADMIN', status: 'DISABLED' });
    expect(calls[0]?.method).toBe('patch');
    expect(calls[0]?.url).toBe('/users/2');
    expect(sentBody(calls[0])).toEqual({
      displayName: '李雷（值班）',
      role: 'ADMIN',
      status: 'DISABLED',
    });

    calls = installReply({ ok: true });
    await resetUserPassword(2, { newPassword: 'New#Pass1234' });
    expect(calls[0]?.method).toBe('patch');
    expect(calls[0]?.url).toBe('/users/2/password');
    expect(sentBody(calls[0])).toEqual({ newPassword: 'New#Pass1234' });
  });
});

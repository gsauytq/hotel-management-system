import type { HealthStatus } from '@hms/shared';
import {
  AxiosError,
  AxiosHeaders,
  type AxiosAdapter,
  type AxiosResponse,
  type InternalAxiosRequestConfig,
} from 'axios';
import { ElMessage } from 'element-plus';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { login } from '../src/api/auth';
import {
  API_BASE_URL,
  REQUEST_TIMEOUT_MS,
  get,
  http,
  post,
  requestRaw,
  setUnauthorizedHandler,
} from '../src/api/request';
import { ApiRequestError, extractFieldErrors } from '../src/utils/errors';

interface MockReply {
  status?: number;
  data?: unknown;
  headers?: Record<string, string>;
}

const originalAdapter = http.defaults.adapter;

function installAdapter(reply: MockReply): InternalAxiosRequestConfig[] {
  const calls: InternalAxiosRequestConfig[] = [];
  const adapter: AxiosAdapter = async (config) => {
    calls.push(config);
    const status = reply.status ?? 200;
    const response: AxiosResponse = {
      data: reply.data,
      status,
      statusText: String(status),
      headers: new AxiosHeaders(reply.headers ?? {}),
      config,
    };
    if (status >= 200 && status < 300) return response;
    throw new AxiosError(
      `Request failed with status code ${status}`,
      status >= 500 ? AxiosError.ERR_BAD_RESPONSE : AxiosError.ERR_BAD_REQUEST,
      config,
      undefined,
      response,
    );
  };
  http.defaults.adapter = adapter;
  return calls;
}

describe('HTTP 客户端基础设施', () => {
  beforeEach(() => {
    setUnauthorizedHandler(null);
  });

  afterEach(() => {
    http.defaults.adapter = originalAdapter;
    setUnauthorizedHandler(null);
    vi.restoreAllMocks();
  });

  it('按环境配置基础路径、超时并携带 Cookie', async () => {
    expect(API_BASE_URL).toBe('/api/v1');
    expect(REQUEST_TIMEOUT_MS).toBe(5_000);
    expect(http.defaults.timeout).toBe(5_000);
    expect(http.defaults.withCredentials).toBe(true);

    const calls = installAdapter({ data: { data: { ok: true } } });
    await get('/ping');
    expect(calls).toHaveLength(1);
    expect(calls[0]?.withCredentials).toBe(true);
    expect(calls[0]?.headers.get('Accept')).toBe('application/json');
  });

  it('解包标准成功信封 { data }', async () => {
    installAdapter({ data: { data: { ok: true } } });
    await expect(post<{ ok: boolean }>('/auth/logout')).resolves.toEqual({ ok: true });
  });

  it('非信封端点原样返回（/api/health）', async () => {
    installAdapter({ data: { status: 'ok' } });
    await expect(
      requestRaw<HealthStatus>({ url: '/api/health', baseURL: '', silent: true }),
    ).resolves.toEqual({ status: 'ok' });
  });

  it('不假设所有业务响应都有信封', async () => {
    installAdapter({ data: { id: 1, name: '裸响应' } });
    await expect(get<{ id: number; name: string }>('/raw')).resolves.toEqual({
      id: 1,
      name: '裸响应',
    });
  });

  it('业务冲突（409）归一化错误并提示后端文案', async () => {
    const toast = vi.spyOn(ElMessage, 'error');
    installAdapter({
      status: 409,
      data: {
        error: { code: 'ROOM_TYPE_SOLD_OUT', message: '所选日期该房型已无可售房间' },
      },
    });

    await expect(get('/room-types')).rejects.toMatchObject({
      status: 409,
      code: 'ROOM_TYPE_SOLD_OUT',
      message: '所选日期该房型已无可售房间',
    });
    expect(toast).toHaveBeenCalledTimes(1);
    expect(toast).toHaveBeenCalledWith('所选日期该房型已无可售房间');
  });

  it('401 会话失效触发全局处理器且不重复弹消息', async () => {
    const handler = vi.fn();
    const toast = vi.spyOn(ElMessage, 'error');
    setUnauthorizedHandler(handler);
    installAdapter({
      status: 401,
      data: { error: { code: 'SESSION_EXPIRED', message: '未登录或会话已过期' } },
    });

    await expect(get('/auth/me')).rejects.toBeInstanceOf(ApiRequestError);
    expect(handler).toHaveBeenCalledTimes(1);
    expect(toast).not.toHaveBeenCalled();
  });

  it('401 登录凭证错误不触发会话失效处理且由登录页内联提示', async () => {
    const handler = vi.fn();
    const toast = vi.spyOn(ElMessage, 'error');
    setUnauthorizedHandler(handler);
    const calls = installAdapter({
      status: 401,
      data: { error: { code: 'INVALID_CREDENTIALS', message: '用户名或密码错误' } },
    });

    await expect(login({ username: 'front01', password: 'wrong' })).rejects.toMatchObject({
      code: 'INVALID_CREDENTIALS',
    });
    expect(calls[0]?.method).toBe('post');
    expect(calls[0]?.url).toBe('/auth/login');
    expect(handler).not.toHaveBeenCalled();
    expect(toast).not.toHaveBeenCalled();
  });

  it('422 保留字段级 details 供表单映射', async () => {
    vi.spyOn(ElMessage, 'error');
    installAdapter({
      status: 422,
      data: {
        error: {
          code: 'VALIDATION_FAILED',
          message: '参数校验失败',
          details: [{ field: 'checkOutDate', message: '离店日期必须晚于入住日期' }],
        },
      },
    });

    let caught: unknown;
    try {
      await post('/bookings', {});
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(ApiRequestError);
    expect(extractFieldErrors(caught)).toEqual({
      checkOutDate: ['离店日期必须晚于入住日期'],
    });
  });

  it('5xx 使用 X-Request-Id 提示报障编号', async () => {
    const toast = vi.spyOn(ElMessage, 'error');
    installAdapter({
      status: 500,
      data: { error: { code: 'INTERNAL_ERROR', message: '服务器内部错误' } },
      headers: { 'x-request-id': 'req-123' },
    });

    await expect(get('/unknown')).rejects.toMatchObject({
      status: 500,
      requestId: 'req-123',
    });
    expect(toast).toHaveBeenCalledWith('服务异常（请求编号：req-123）');
  });

  it('超时映射为网络类错误并提示', async () => {
    const toast = vi.spyOn(ElMessage, 'error');
    http.defaults.adapter = async (config) => {
      throw new AxiosError('timeout of 5000ms exceeded', 'ECONNABORTED', config);
    };

    await expect(get('/slow')).rejects.toMatchObject({
      isNetworkError: true,
      message: '请求超时，请稍后重试',
    });
    expect(toast).toHaveBeenCalledWith('请求超时，请稍后重试');
  });

  it('silent 请求不触发全局错误提示', async () => {
    const toast = vi.spyOn(ElMessage, 'error');
    installAdapter({
      status: 409,
      data: { error: { code: 'GUEST_EXISTS', message: '该证件号已有客人档案' } },
    });

    await expect(post('/guests', {}, { silent: true })).rejects.toBeInstanceOf(ApiRequestError);
    expect(toast).not.toHaveBeenCalled();
  });
});

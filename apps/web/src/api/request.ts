import axios, { isAxiosError, type AxiosRequestConfig } from 'axios';

import type { ApiSuccessEnvelope } from '@hms/shared';

import { notifyApiError, toApiRequestError, type ApiRequestError } from '@/utils/errors';

/**
 * Axios 请求级行为开关（由 request 包装器透传，业务代码无需感知 Axios）。
 * 仅做类型扩展，不改变 Axios 行为。
 */
declare module 'axios' {
  interface AxiosRequestConfig {
    silent?: boolean;
    skipAuthHandler?: boolean;
  }
}

const DEFAULT_API_BASE_URL = '/api/v1';
const DEFAULT_REQUEST_TIMEOUT_MS = 15_000;

function parseTimeout(rawValue: string | undefined, fallback: number): number {
  const value = Number(rawValue);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

/** 当前环境 API 基础路径（开发/测试/生产分别由 .env.* 提供，缺省 /api/v1） */
export const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL ?? DEFAULT_API_BASE_URL).replace(
  /\/+$/,
  '',
);

/** 当前环境请求超时（毫秒） */
export const REQUEST_TIMEOUT_MS = parseTimeout(
  import.meta.env.VITE_REQUEST_TIMEOUT_MS,
  DEFAULT_REQUEST_TIMEOUT_MS,
);

export type UnauthorizedHandler = () => void;

let unauthorizedHandler: UnauthorizedHandler | null = null;

/**
 * 注册全局 401 处理器（由 main.ts 注入，避免请求层直接依赖 Router / Store）。
 * 传 null 可清除（供测试或登出场景使用）。
 */
export function setUnauthorizedHandler(handler: UnauthorizedHandler | null): void {
  unauthorizedHandler = handler;
}

/**
 * 全局唯一 Axios 实例。
 *
 * 认证机制（架构 ADR-002）：服务器端 Session + HttpOnly Cookie。
 * 浏览器自动携带 Cookie，前端不读取、不存储任何令牌，因此不存在 Authorization 注入；
 * withCredentials 是跨域直连场景下发送 Cookie 的必要条件，同源部署时同样安全。
 */
export const http = axios.create({
  baseURL: API_BASE_URL,
  timeout: REQUEST_TIMEOUT_MS,
  withCredentials: true,
  headers: {
    Accept: 'application/json',
  },
});

http.interceptors.request.use((config) => {
  // 防止单个调用方误关 Cookie 携带；令牌注入由浏览器完成（HttpOnly Cookie）。
  config.withCredentials = true;
  return config;
});

http.interceptors.response.use(
  (response) => response,
  (error: unknown) => {
    const normalized = toApiRequestError(error);
    const config = isAxiosError(error) ? error.config : undefined;

    // 仅真正的会话失效才清态跳转；登录失败（INVALID_CREDENTIALS）不触发。
    const isSessionFailure = normalized.status === 401 && normalized.code !== 'INVALID_CREDENTIALS';
    if (isSessionFailure && config?.skipAuthHandler !== true) {
      try {
        unauthorizedHandler?.();
      } catch {
        // 全局处理器异常不得覆盖原始请求错误
      }
    }

    if (config?.silent !== true) {
      notifyApiError(normalized);
    }
    return Promise.reject(normalized);
  },
);

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** 判断是否为标准成功信封 `{ data: ... }`（ADR-009） */
export function isApiSuccessEnvelope(value: unknown): value is ApiSuccessEnvelope<unknown> {
  return isPlainRecord(value) && Object.prototype.hasOwnProperty.call(value, 'data');
}

/**
 * 解包标准成功信封；非信封响应原样返回。
 * 不假设所有端点都使用同一包装（例如 /api/health 为裸响应）。
 */
export function unwrapApiData<T>(payload: unknown): T {
  return (isApiSuccessEnvelope(payload) ? payload.data : payload) as T;
}

/** 发送请求并解包统一成功信封（适用于 /api/v1 业务接口） */
export async function request<T>(config: AxiosRequestConfig): Promise<T> {
  const response = await http.request<unknown>(config);
  return unwrapApiData<T>(response.data);
}

/** 发送请求并原样返回响应体（适用于 /api/health 等非信封端点） */
export async function requestRaw<T>(config: AxiosRequestConfig): Promise<T> {
  const response = await http.request<T>(config);
  return response.data;
}

export function get<T>(
  url: string,
  params?: Record<string, unknown>,
  config: AxiosRequestConfig = {},
): Promise<T> {
  return request<T>({ ...config, method: 'GET', url, params });
}

export function post<T>(url: string, body?: unknown, config: AxiosRequestConfig = {}): Promise<T> {
  return request<T>({ ...config, method: 'POST', url, data: body });
}

export function patch<T>(url: string, body?: unknown, config: AxiosRequestConfig = {}): Promise<T> {
  return request<T>({ ...config, method: 'PATCH', url, data: body });
}

export function put<T>(url: string, body?: unknown, config: AxiosRequestConfig = {}): Promise<T> {
  return request<T>({ ...config, method: 'PUT', url, data: body });
}

export function del<T>(url: string, config: AxiosRequestConfig = {}): Promise<T> {
  return request<T>({ ...config, method: 'DELETE', url });
}

export type { ApiRequestError };

import type { ApiErrorEnvelope, ErrorDetail } from '@hms/shared';
import { isAxiosError } from 'axios';
import { ElMessage } from 'element-plus';

import type { ApiFieldErrors, NormalizedApiErrorInit } from '@/types/api';

/**
 * 前端统一的 API 错误模型。
 * HTTP 细节（AxiosError / 响应体 / 请求头）只允许在 request.ts 与本文档中处理；
 * 业务代码通过 instanceof / isApiRequestError 判断并读取稳定字段。
 */
export class ApiRequestError extends Error {
  readonly status: number | undefined;
  readonly code: string | undefined;
  readonly details: ErrorDetail[];
  readonly requestId: string | undefined;
  readonly isNetworkError: boolean;
  readonly isCanceled: boolean;

  constructor(init: NormalizedApiErrorInit) {
    super(init.message);
    this.name = 'ApiRequestError';
    this.status = init.status;
    this.code = init.code;
    this.details = init.details ?? [];
    this.requestId = init.requestId;
    this.isNetworkError = init.isNetworkError ?? false;
    this.isCanceled = init.isCanceled ?? false;
  }
}

export function isApiRequestError(value: unknown): value is ApiRequestError {
  return value instanceof ApiRequestError;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** 后端失败信封：{ error: { code, message, details?, requestId? } }（ADR-009） */
export function isApiErrorEnvelope(value: unknown): value is ApiErrorEnvelope {
  if (!isRecord(value) || !isRecord(value.error)) return false;
  return typeof value.error.code === 'string' && typeof value.error.message === 'string';
}

function parseDetails(value: unknown): ErrorDetail[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!isRecord(item)) return [];
    if (typeof item.field !== 'string' || typeof item.message !== 'string') return [];
    return [{ field: item.field, message: item.message }];
  });
}

function readRequestIdFromHeaders(headers: unknown): string | undefined {
  if (!isRecord(headers)) return undefined;

  const get = headers.get;
  if (typeof get === 'function') {
    const value: unknown = (get as (name: string) => unknown).call(headers, 'x-request-id');
    if (typeof value === 'string' && value.length > 0) return value;
  }

  for (const key of ['x-request-id', 'X-Request-Id']) {
    const value = headers[key];
    if (typeof value === 'string' && value.length > 0) return value;
  }
  return undefined;
}

function defaultMessageForStatus(status: number): string {
  switch (status) {
    case 400:
      return '请求参数有误';
    case 401:
      return '登录状态已失效，请重新登录';
    case 403:
      return '无权限执行该操作';
    case 404:
      return '资源不存在';
    case 409:
      return '数据冲突，请刷新后重试';
    case 422:
      return '参数校验失败';
    case 423:
      return '账号已锁定，请稍后重试';
    case 429:
      return '请求过于频繁，请稍后重试';
    default:
      return status >= 500 ? '服务异常，请稍后重试' : '请求失败，请稍后重试';
  }
}

/**
 * 将任意异常归一化为 ApiRequestError。
 * 支持两种响应形态：
 * - 标准信封 `{ data }` / `{ error }`（ADR-009）；
 * - 非信封响应（如 GET /api/health 裸返回 `{ status }`），不假设所有端点使用同一包装。
 */
export function toApiRequestError(error: unknown): ApiRequestError {
  if (error instanceof ApiRequestError) return error;

  if (isAxiosError(error)) {
    if (error.code === 'ERR_CANCELED') {
      return new ApiRequestError({ message: '请求已取消', isNetworkError: true, isCanceled: true });
    }

    const response = error.response;
    if (response === undefined) {
      const isTimeout = error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT';
      return new ApiRequestError({
        message: isTimeout ? '请求超时，请稍后重试' : '网络异常，请稍后重试',
        isNetworkError: true,
      });
    }

    const envelope = isApiErrorEnvelope(response.data) ? response.data : undefined;
    const status = response.status;
    return new ApiRequestError({
      status,
      code: envelope?.error.code,
      message: envelope?.error.message ?? defaultMessageForStatus(status),
      details: parseDetails(envelope?.error.details),
      requestId: envelope?.error.requestId ?? readRequestIdFromHeaders(response.headers),
    });
  }

  if (error instanceof Error) {
    return new ApiRequestError({ message: error.message });
  }
  return new ApiRequestError({ message: '请求失败，请稍后重试' });
}

/**
 * 全局唯一错误提示出口（架构 §2.8）。
 * - 404 由页面决定空态/NotFound，不弹消息；
 * - 401 会话失效由全局跳转处理，不弹消息（登录凭证错误除外）；
 * - 5xx 只展示 requestId，不翻译服务端细节；
 * - 其余展示后端稳定文案。
 */
export function notifyApiError(error: ApiRequestError): void {
  if (error.isCanceled) return;
  if (error.status === 404) return;
  if (error.status === 401 && error.code !== 'INVALID_CREDENTIALS') return;

  if (error.status !== undefined && error.status >= 500) {
    ElMessage.error(
      error.requestId !== undefined
        ? `服务异常（请求编号：${error.requestId}）`
        : '服务异常，请稍后重试',
    );
    return;
  }

  ElMessage.error(error.message);
}

/** 统一的用户可读错误文案（含字段详情与 requestId；不泄露内部堆栈） */
export function formatApiError(error: unknown, fallback = '操作失败，请稍后重试。'): string {
  const normalized = toApiRequestError(error);
  const detail = normalized.details[0]?.message;
  if (detail !== undefined) return `${normalized.message}：${detail}`;
  if (normalized.requestId !== undefined) {
    return `${normalized.message}（请求编号：${normalized.requestId}）`;
  }
  if (normalized.isNetworkError) return normalized.message;
  if (normalized.status === undefined) return fallback;
  return normalized.message;
}

/** 提取 422 字段级错误，供 ElForm 逐字段展示（架构 §2.4） */
export function extractFieldErrors(error: unknown): ApiFieldErrors {
  const normalized = toApiRequestError(error);
  const result: ApiFieldErrors = {};
  for (const detail of normalized.details) {
    const messages = result[detail.field] ?? [];
    messages.push(detail.message);
    result[detail.field] = messages;
  }
  return result;
}

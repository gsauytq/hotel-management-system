import type { ErrorDetail } from '@hms/shared';
import type { AxiosRequestConfig } from 'axios';

/**
 * 请求级行为开关。
 * - silent：不触发全局 ElMessage 错误提示，由调用方自行呈现（读操作/后台轮询等）。
 * - skipAuthHandler：401 时不触发全局会话失效处理（仅用于登录等认证入口）。
 */
export interface ApiRequestOptions {
  silent?: boolean;
  skipAuthHandler?: boolean;
}

/** 统一请求配置：Axios 配置 + 前端行为开关 */
export type ApiRequestConfig = AxiosRequestConfig & ApiRequestOptions;

/** 表单字段错误（422 details 归一化结果，可直接映射到 ElFormItem.prop） */
export type ApiFieldErrors = Record<string, string[]>;

/** HTTP 层错误归一化所需字段 */
export interface NormalizedApiErrorInit {
  status?: number;
  code?: string;
  message: string;
  details?: ErrorDetail[];
  requestId?: string;
  isNetworkError?: boolean;
  isCanceled?: boolean;
}

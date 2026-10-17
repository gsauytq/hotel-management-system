import type { HealthStatus } from '@hms/shared';

import { API_BASE_URL, requestRaw } from './request';

/**
 * 健康检查是契约中唯一的非信封端点（裸 `{ status }`），固定使用 requestRaw，
 * 与业务接口的 `{ data }` 解包区分，避免前端假设统一响应包装。
 * /api/health 位于版本前缀之外，因此从 API_BASE_URL 推导（兼容绝对地址）。
 */
const HEALTH_URL = `${API_BASE_URL.replace(/\/v1$/, '')}/health`;

export function fetchHealth(): Promise<HealthStatus> {
  // 读操作失败由页面进入异常态并提供重试，不弹全局消息（架构 §2.4）
  return requestRaw<HealthStatus>({ url: HEALTH_URL, baseURL: '', silent: true });
}

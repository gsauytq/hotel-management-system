import type { CurrentUser, LoginRequest, OkResult, SessionUser } from '@hms/shared';

import { get, post } from './request';

/**
 * A1 登录：凭证错误（401 INVALID_CREDENTIALS）不触发全局会话失效跳转；
 * 失败由登录页内联展示（silent），避免全局弹窗与表单提示重复。
 */
export function login(payload: LoginRequest): Promise<SessionUser> {
  return post<SessionUser>('/auth/login', payload, {
    skipAuthHandler: true,
    silent: true,
  });
}

/**
 * A2 登出：失败时调用方仍应清理本地状态（架构 §2.7）。
 * 登出流程自行处理跳转，不触发全局 401 会话失效处理器。
 */
export function logout(): Promise<OkResult> {
  return post<OkResult>('/auth/logout', undefined, { skipAuthHandler: true });
}

/**
 * A3 当前用户：应用启动时重建会话。
 * 启动探测的 401 属预期游客态，交由 authStore 处理，不触发全局跳转/提示。
 */
export function fetchCurrentUser(): Promise<CurrentUser> {
  return get<CurrentUser>('/auth/me', undefined, { silent: true, skipAuthHandler: true });
}

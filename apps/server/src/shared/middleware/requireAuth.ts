import type { Request, RequestHandler } from 'express';

import { ApiError } from '../http/ApiError.js';

/** 首登未改密期间仍允许访问的端点（A-20 B） */
const PASSWORD_CHANGE_ALLOWED_PATHS = new Set([
  '/api/v1/auth/me',
  '/api/v1/auth/logout',
  '/api/v1/auth/change-password',
]);

/** 未改密用户访问业务端点 → 403 PASSWORD_CHANGE_REQUIRED（后端强制） */
export function passwordChangeRequired(req: Request): boolean {
  if (req.user?.mustChangePassword !== true) return false;
  const path = req.originalUrl.split('?')[0] ?? req.originalUrl;
  return !PASSWORD_CHANGE_ALLOWED_PATHS.has(path);
}

/**
 * 认证守卫（鉴权管道第 2 步）：无有效会话 → 401 SESSION_EXPIRED；
 * 首登未改密 → 403 PASSWORD_CHANGE_REQUIRED（仅放行 me/logout/change-password）。
 * 所有受保护路由必须显式声明本中间件或 requireRole（默认拒绝）。
 */
export const requireAuth: RequestHandler = (req, _res, next) => {
  if (req.user === undefined) {
    next(ApiError.unauthorized());
    return;
  }
  if (passwordChangeRequired(req)) {
    next(ApiError.fromCode('PASSWORD_CHANGE_REQUIRED', '请先修改初始密码'));
    return;
  }
  next();
};

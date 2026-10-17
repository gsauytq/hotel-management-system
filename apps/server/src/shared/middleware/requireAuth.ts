import type { RequestHandler } from 'express';

import { ApiError } from '../http/ApiError.js';

/**
 * 认证守卫（鉴权管道第 2 步）：无有效会话 → 401 SESSION_EXPIRED。
 * 所有受保护路由必须显式声明本中间件或 requireRole（默认拒绝）。
 */
export const requireAuth: RequestHandler = (req, _res, next) => {
  if (req.user === undefined) {
    next(ApiError.unauthorized());
    return;
  }
  next();
};

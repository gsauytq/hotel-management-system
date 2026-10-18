import type { RequestHandler } from 'express';

import type { Role } from '@hms/shared';

import { ApiError } from '../http/ApiError.js';
import { passwordChangeRequired } from './requireAuth.js';

/**
 * 角色授权守卫（鉴权管道第 3 步）：已认证但角色不符 → 403 FORBIDDEN。
 * 未认证 → 401（先于权限判断）；首登未改密 → 403 PASSWORD_CHANGE_REQUIRED。
 * 路由必须显式声明允许的角色（默认拒绝）。
 */
export function requireRole(...allowedRoles: readonly Role[]): RequestHandler {
  return (req, _res, next) => {
    if (req.user === undefined) {
      next(ApiError.unauthorized());
      return;
    }
    if (passwordChangeRequired(req)) {
      next(ApiError.fromCode('PASSWORD_CHANGE_REQUIRED', '请先修改初始密码'));
      return;
    }
    if (!allowedRoles.includes(req.user.role)) {
      next(ApiError.forbidden());
      return;
    }
    next();
  };
}

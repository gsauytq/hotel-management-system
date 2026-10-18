import { Router, type RequestHandler } from 'express';

import { changePasswordSchema, loginRequestSchema } from '@hms/shared';

import type { AppConfig } from '../../config/env.js';
import { requireAuth } from '../../shared/middleware/requireAuth.js';
import { validate } from '../../shared/middleware/validate.js';
import {
  clearSessionCookieOptions,
  sessionCookieOptions,
  SESSION_COOKIE_NAME,
} from './auth.cookies.js';
import { createAuthController } from './auth.controller.js';
import type { AuthService } from './auth.service.js';

export interface AuthRouterDependencies {
  config: Pick<AppConfig, 'nodeEnv' | 'sessionTtlHours'>;
  authService: AuthService;
  /** 会话解析中间件（共享实例，供 /auth/me、/auth/logout 与其他受保护路由复用） */
  sessionMiddleware: RequestHandler;
  /** 登录限流（security-design §3：每 IP 每分钟 10 次） */
  loginRateLimiter: RequestHandler;
}

export function createAuthRouter(deps: AuthRouterDependencies): Router {
  const controller = createAuthController({
    authService: deps.authService,
    sessionCookie: {
      name: SESSION_COOKIE_NAME,
      options: sessionCookieOptions(deps.config),
      clearOptions: clearSessionCookieOptions(deps.config),
    },
  });

  const router = Router();

  // A1 登录（公开；限流 → 校验 → 控制器）
  router.post(
    '/login',
    deps.loginRateLimiter,
    validate({ body: loginRequestSchema }),
    controller.login,
  );
  // A2 登出（认证）
  router.post('/logout', deps.sessionMiddleware, requireAuth, controller.logout);
  // A3 当前用户（认证）
  router.get('/me', deps.sessionMiddleware, requireAuth, controller.me);
  // A4 自助改密（认证；首登强制改密期间仍允许）
  router.post(
    '/change-password',
    deps.sessionMiddleware,
    requireAuth,
    validate({ body: changePasswordSchema }),
    controller.changePassword,
  );

  return router;
}

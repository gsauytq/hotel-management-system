import type { RequestHandler } from 'express';
import type { Logger } from 'pino';

import type { SessionResolution } from '../http/auth.js';
import { readCookie } from '../http/cookies.js';

export interface SessionMiddlewareDependencies {
  cookieName: string;
  resolveSession: (sessionId: string) => Promise<SessionResolution>;
  logger: Logger;
}

/**
 * 会话解析中间件（architecture §1.7 鉴权管道第 1 步）：
 * 解析 Cookie → 实时查库校验（未过期且 user.status=ACTIVE）→ 注入 req.user / req.sessionId。
 * 匿名请求直接放行，由 requireAuth 统一拒绝；无效/过期/停用会话在服务端可区分（日志 reason）。
 */
export function createSessionMiddleware(deps: SessionMiddlewareDependencies): RequestHandler {
  return async (req, _res, next) => {
    const sessionId = readCookie(req.headers.cookie, deps.cookieName);
    if (sessionId === undefined || sessionId.length === 0) {
      next();
      return;
    }

    const resolution = await deps.resolveSession(sessionId);
    switch (resolution.status) {
      case 'active':
        req.user = resolution.user;
        req.sessionId = resolution.sessionId;
        next();
        return;
      case 'disabled':
        deps.logger.warn(
          { requestId: req.requestId, reason: 'disabled' },
          'session rejected: user disabled',
        );
        next();
        return;
      case 'missing':
      case 'expired':
        deps.logger.debug(
          { requestId: req.requestId, reason: resolution.status },
          'session rejected',
        );
        next();
        return;
    }
  };
}

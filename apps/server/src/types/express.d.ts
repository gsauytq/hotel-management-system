import type { CurrentUser } from '@hms/shared';

declare module 'express-serve-static-core' {
  interface Request {
    requestId: string;
    /** 由会话中间件注入；受保护路由中由 requireAuth/requireRole 保证存在 */
    user?: CurrentUser;
    /** 当前请求对应的会话 id（登出用）；仅在会话有效时存在 */
    sessionId?: string;
  }
}

export {};

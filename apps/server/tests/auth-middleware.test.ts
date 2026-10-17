import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';

import type { CurrentUser } from '@hms/shared';

import {
  clearSessionCookieOptions,
  sessionCookieOptions,
} from '../src/modules/auth/auth.cookies.js';
import type { SessionResolution } from '../src/shared/http/auth.js';
import { createErrorHandler } from '../src/shared/middleware/errorHandler.js';
import { requestId } from '../src/shared/middleware/requestId.js';
import { requireAuth } from '../src/shared/middleware/requireAuth.js';
import { requireRole } from '../src/shared/middleware/requireRole.js';
import { createSessionMiddleware } from '../src/shared/middleware/session.js';
import { createLogger } from '../src/utils/logger.js';

const logger = createLogger({ nodeEnv: 'test', logLevel: 'silent' });

const activeUser: CurrentUser = {
  id: 1,
  username: 'front01',
  displayName: '王小雅',
  role: 'RECEPTIONIST',
  status: 'ACTIVE',
};

function buildApp(resolveSession: (sessionId: string) => Promise<SessionResolution>) {
  const session = createSessionMiddleware({
    cookieName: 'hms_sid',
    resolveSession,
    logger,
  });
  const app = express();
  app.use(requestId());
  app.get('/protected', session, requireAuth, (req, res) => {
    res.json({ data: { user: req.user, sessionId: req.sessionId } });
  });
  app.get('/admin-only', session, requireRole('ADMIN'), (_req, res) => {
    res.json({ data: { ok: true } });
  });
  app.use(createErrorHandler(logger));
  return app;
}

describe('会话中间件 + requireAuth（未登录/无效/过期/停用区分）', () => {
  it('无 Cookie（未登录）→ 401 SESSION_EXPIRED', async () => {
    const app = buildApp(async () => ({ status: 'missing' }));
    const res = await request(app).get('/protected');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('SESSION_EXPIRED');
  });

  it('无效会话（missing）→ 401 SESSION_EXPIRED', async () => {
    const resolve = vi.fn(async (): Promise<SessionResolution> => ({ status: 'missing' }));
    const res = await request(buildApp(resolve)).get('/protected').set('Cookie', 'hms_sid=invalid');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('SESSION_EXPIRED');
    expect(resolve).toHaveBeenCalledWith('invalid');
  });

  it('过期会话（expired）→ 401 SESSION_EXPIRED', async () => {
    const app = buildApp(async () => ({ status: 'expired' }));
    const res = await request(app).get('/protected').set('Cookie', 'hms_sid=expired');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('SESSION_EXPIRED');
  });

  it('用户停用（disabled）→ 401 SESSION_EXPIRED', async () => {
    const app = buildApp(async () => ({ status: 'disabled' }));
    const res = await request(app).get('/protected').set('Cookie', 'hms_sid=disabled');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('SESSION_EXPIRED');
  });

  it('有效会话 → 注入 req.user / req.sessionId', async () => {
    const app = buildApp(async () => ({
      status: 'active',
      user: activeUser,
      sessionId: 'a'.repeat(64),
      expiresAt: new Date(Date.now() + 60_000),
    }));
    const res = await request(app).get('/protected').set('Cookie', 'hms_sid=valid');
    expect(res.status).toBe(200);
    expect(res.body.data.user).toEqual(activeUser);
    expect(res.body.data.sessionId).toBe('a'.repeat(64));
  });
});

describe('requireRole（后端唯一权限边界，默认拒绝）', () => {
  it('未认证 → 401（先于权限判断）', async () => {
    const app = buildApp(async () => ({ status: 'missing' }));
    const res = await request(app).get('/admin-only');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('SESSION_EXPIRED');
  });

  it('RECEPTIONIST 直调 ADMIN 路由 → 403 FORBIDDEN（不依赖前端隐藏）', async () => {
    const app = buildApp(async () => ({
      status: 'active',
      user: activeUser,
      sessionId: 'b'.repeat(64),
      expiresAt: new Date(Date.now() + 60_000),
    }));
    const res = await request(app).get('/admin-only').set('Cookie', 'hms_sid=valid');
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('ADMIN → 放行', async () => {
    const app = buildApp(async () => ({
      status: 'active',
      user: { ...activeUser, role: 'ADMIN' },
      sessionId: 'c'.repeat(64),
      expiresAt: new Date(Date.now() + 60_000),
    }));
    const res = await request(app).get('/admin-only').set('Cookie', 'hms_sid=valid');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ data: { ok: true } });
  });
});

describe('会话 Cookie 选项（security-design §3）', () => {
  it('生产环境 Secure=true；开发环境关闭（http 调试）', () => {
    expect(sessionCookieOptions({ nodeEnv: 'production', sessionTtlHours: 8 })).toMatchObject({
      httpOnly: true,
      sameSite: 'strict',
      secure: true,
      path: '/',
      maxAge: 8 * 60 * 60 * 1000,
    });
    expect(sessionCookieOptions({ nodeEnv: 'development', sessionTtlHours: 8 }).secure).toBe(false);
  });

  it('清除 Cookie 使用同作用域且不设置 maxAge', () => {
    const options = clearSessionCookieOptions({ nodeEnv: 'production' });
    expect(options).toMatchObject({ httpOnly: true, sameSite: 'strict', secure: true, path: '/' });
    expect(options).not.toHaveProperty('maxAge');
  });
});

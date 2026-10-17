import 'dotenv/config';

import { randomBytes } from 'node:crypto';
import { Writable } from 'node:stream';

import type { Express, Router } from 'express';
import type { Logger } from 'pino';
import request, { type Response as SupertestResponse } from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createApp } from '../../src/app.js';
import { loadEnv, type AppConfig } from '../../src/config/env.js';
import type { PrismaClient } from '../../src/generated/prisma/client.js';
import { createDatabasePing, createPrismaClient } from '../../src/lib/prisma.js';
import { MAX_SESSIONS_PER_USER } from '../../src/modules/auth/auth.constants.js';
import { SESSION_COOKIE_NAME } from '../../src/modules/auth/auth.cookies.js';
import { createAuthRepository } from '../../src/modules/auth/auth.repository.js';
import { createAuthService, type AuthService } from '../../src/modules/auth/auth.service.js';
import { requireAuth } from '../../src/shared/middleware/requireAuth.js';
import { requireRole } from '../../src/shared/middleware/requireRole.js';
import { createSessionMiddleware } from '../../src/shared/middleware/session.js';
import { createAuditLogger } from '../../src/utils/audit.js';
import { createLogger } from '../../src/utils/logger.js';
import { hashPassword } from '../../src/utils/password.js';
import { createFakeBookingsService } from '../support/fake-bookings.js';
import { createFakeRoomTypesService, createFakeRoomsService } from '../support/fake-rooms.js';
import { createFakeGuestsService } from '../support/fake-guests.js';
import { createFakeOrdersService } from '../support/fake-orders.js';
import { createFakeUsersService } from '../support/fake-users.js';
import { createFakeStaysService } from '../support/fake-stays.js';

/**
 * 集成测试：Supertest + 真实 MySQL（开发计划 T-05「Supertest + 真库」）。
 * 默认不运行（pnpm test 保持无数据库依赖）；执行方式：
 *   HMS_INTEGRATION=1 pnpm --filter @hms/server test
 * 使用 apps/server/.env 中的 DATABASE_URL（开发库），测试数据以 itest_ 前缀创建并在结束后清理。
 */
const runIntegration =
  process.env['HMS_INTEGRATION'] === '1' && Boolean(process.env['DATABASE_URL']);

const integrationSuite = runIntegration ? describe : describe.skip;

integrationSuite('认证与授权集成测试（Supertest + 真实 MySQL）', () => {
  const plainPassword = 'Itest#Pass123';
  const usernamePrefix = `itest_${Date.now().toString(36)}`;

  let config: AppConfig;
  let prisma: PrismaClient;
  let authService: AuthService;

  beforeAll(async () => {
    config = loadEnv(process.env);
    prisma = createPrismaClient(config);
    authService = createAuthService({
      repository: createAuthRepository(prisma),
      audit: createAuditLogger(createLogger({ nodeEnv: 'test', logLevel: 'silent' })),
      sessionTtlHours: config.sessionTtlHours,
    });
  });

  afterAll(async () => {
    // 仅清理本测试创建的用户（会话经 FK CASCADE 级联删除），不触碰其他数据
    await prisma.user.deleteMany({ where: { username: { startsWith: usernamePrefix } } });
    await prisma.$disconnect();
  });

  function silentLogger(): Logger {
    return createLogger({ nodeEnv: 'test', logLevel: 'silent' });
  }

  function buildApp(
    options: {
      logger?: Logger;
      extendApi?: (router: Router) => void;
      authService?: AuthService;
    } = {},
  ): Express {
    return createApp({
      config,
      logger: options.logger ?? silentLogger(),
      checkDatabase: () => createDatabasePing(prisma)(),
      authService: options.authService ?? authService,
      roomTypesService: createFakeRoomTypesService(),
      roomsService: createFakeRoomsService(),
      bookingsService: createFakeBookingsService(),
      staysService: createFakeStaysService(),
      ordersService: createFakeOrdersService(),
      usersService: createFakeUsersService(),
      guestsService: createFakeGuestsService(),
      ...(options.extendApi === undefined ? {} : { extendApi: options.extendApi }),
    });
  }

  async function createTestUser(
    suffix: string,
    options: { role?: 'ADMIN' | 'RECEPTIONIST'; status?: 'ACTIVE' | 'DISABLED' } = {},
  ): Promise<{ id: number; username: string }> {
    const user = await prisma.user.create({
      data: {
        username: `${usernamePrefix}_${suffix}`,
        passwordHash: await hashPassword(plainPassword),
        displayName: '集成测试用户',
        role: options.role ?? 'RECEPTIONIST',
        status: options.status ?? 'ACTIVE',
      },
    });
    return { id: Number(user.id), username: user.username };
  }

  function rawSetCookie(res: SupertestResponse): string {
    const setCookie = res.headers['set-cookie'];
    const raw = Array.isArray(setCookie) ? setCookie[0] : setCookie;
    expect(raw, 'Set-Cookie 应存在').toBeDefined();
    return raw as string;
  }

  function sessionCookieValue(res: SupertestResponse): string {
    const raw = rawSetCookie(res);
    const pair = raw.split(';')[0] ?? '';
    return pair.slice(`${SESSION_COOKIE_NAME}=`.length);
  }

  function login(
    app: Express,
    username: string,
    password: string = plainPassword,
  ): Promise<SupertestResponse> {
    return request(app).post('/api/v1/auth/login').send({ username, password });
  }

  it('A1 登录成功：200 + 会话用户 + HttpOnly/SameSite Cookie + 会话落库', async () => {
    const user = await createTestUser('login');
    const res = await login(buildApp(), user.username);

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({
      id: user.id,
      username: user.username,
      displayName: '集成测试用户',
      role: 'RECEPTIONIST',
    });
    expect(res.body.data).not.toHaveProperty('passwordHash');

    const cookie = rawSetCookie(res);
    expect(cookie).toContain(`${SESSION_COOKIE_NAME}=`);
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Strict');
    expect(cookie).toContain('Path=/');
    expect(cookie).toContain(`Max-Age=${config.sessionTtlHours * 60 * 60}`);

    const sid = sessionCookieValue(res);
    const session = await prisma.session.findUnique({ where: { id: sid } });
    expect(session).not.toBeNull();
    expect(session?.expiresAt.getTime()).toBeGreaterThan(Date.now());

    const dbUser = await prisma.user.findUniqueOrThrow({ where: { id: BigInt(user.id) } });
    expect(dbUser.failedAttempts).toBe(0);
    expect(dbUser.lastLoginAt).not.toBeNull();
  });

  it('A1 密码错误：401 INVALID_CREDENTIALS（统一文案），失败计数 +1', async () => {
    const user = await createTestUser('wrong_password');
    const res = await login(buildApp(), user.username, 'Wrong#Pass456');

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('INVALID_CREDENTIALS');
    expect(res.body.error.message).toBe('用户名或密码错误');
    expect(JSON.stringify(res.body)).not.toContain('Wrong#Pass456');

    const dbUser = await prisma.user.findUniqueOrThrow({ where: { id: BigInt(user.id) } });
    expect(dbUser.failedAttempts).toBe(1);
  });

  it('A1 未知用户：401 统一文案（防账号枚举），不产生失败计数', async () => {
    const res = await login(buildApp(), `${usernamePrefix}_ghost`);
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('INVALID_CREDENTIALS');
    expect(res.body.error.message).toBe('用户名或密码错误');
  });

  it('A1 连续 5 次失败后锁定：第 6 次即使密码正确 → 423 ACCOUNT_LOCKED', async () => {
    const user = await createTestUser('lock');
    const app = buildApp();

    for (let attempt = 1; attempt <= 5; attempt += 1) {
      const res = await login(app, user.username, 'Wrong#Pass789');
      expect(res.status, `attempt ${attempt}`).toBe(401);
    }

    const lockedUser = await prisma.user.findUniqueOrThrow({ where: { id: BigInt(user.id) } });
    expect(lockedUser.failedAttempts).toBeGreaterThanOrEqual(5);
    expect(lockedUser.lockedUntil).not.toBeNull();
    expect(lockedUser.lockedUntil?.getTime()).toBeGreaterThan(Date.now());

    const blocked = await login(app, user.username);
    expect(blocked.status).toBe(423);
    expect(blocked.body.error.code).toBe('ACCOUNT_LOCKED');
  });

  it('A4 锁定过期后并发失败仍重新锁定（审查 A-4：计数判定原子化）', async () => {
    const user = await createTestUser('lock_race');
    // 构造“锁定刚过期”状态：failedAttempts=4，lockedUntil 已过期
    await prisma.user.update({
      where: { id: BigInt(user.id) },
      data: { failedAttempts: 4, lockedUntil: new Date(Date.now() - 60 * 60 * 1000) },
    });

    const app = buildApp();
    const results = await Promise.all(
      Array.from({ length: 5 }, () => login(app, user.username, 'Wrong#Race789')),
    );
    for (const res of results) {
      expect([401, 423], JSON.stringify(res.body)).toContain(res.status);
    }

    // 修复前：并发复位写使计数塌缩为 1，账户不会被重新锁定
    const lockedUser = await prisma.user.findUniqueOrThrow({ where: { id: BigInt(user.id) } });
    expect(lockedUser.failedAttempts).toBeGreaterThanOrEqual(5);
    expect(lockedUser.lockedUntil).not.toBeNull();
    expect(lockedUser.lockedUntil?.getTime()).toBeGreaterThan(Date.now());

    const blocked = await login(app, user.username);
    expect(blocked.status).toBe(423);
    expect(blocked.body.error.code).toBe('ACCOUNT_LOCKED');
  });

  it('停用账号登录：统一 401（不泄露账号状态）', async () => {
    const user = await createTestUser('disabled_login', { status: 'DISABLED' });
    const res = await login(buildApp(), user.username);
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('INVALID_CREDENTIALS');
  });

  it('A3 会话校验：无效 sid → 401；过期会话 → 401 且过期行被清理', async () => {
    const app = buildApp();

    const invalid = await request(app)
      .get('/api/v1/auth/me')
      .set('Cookie', `${SESSION_COOKIE_NAME}=${'0'.repeat(64)}`);
    expect(invalid.status).toBe(401);
    expect(invalid.body.error.code).toBe('SESSION_EXPIRED');

    const user = await createTestUser('expired_session');
    const expiredSid = randomBytes(32).toString('hex');
    await prisma.session.create({
      data: {
        id: expiredSid,
        userId: BigInt(user.id),
        expiresAt: new Date(Date.now() - 60_000),
      },
    });

    const expired = await request(app)
      .get('/api/v1/auth/me')
      .set('Cookie', `${SESSION_COOKIE_NAME}=${expiredSid}`);
    expect(expired.status).toBe(401);
    expect(expired.body.error.code).toBe('SESSION_EXPIRED');

    const gone = await prisma.session.findUnique({ where: { id: expiredSid } });
    expect(gone).toBeNull();
  });

  it('A3 me：有效会话返回当前用户（含 status）', async () => {
    const user = await createTestUser('me');
    const app = buildApp();
    const loginRes = await login(app, user.username);
    const cookie = `${SESSION_COOKIE_NAME}=${sessionCookieValue(loginRes)}`;

    const me = await request(app).get('/api/v1/auth/me').set('Cookie', cookie);
    expect(me.status).toBe(200);
    expect(me.body.data).toEqual({
      id: user.id,
      username: user.username,
      displayName: '集成测试用户',
      role: 'RECEPTIONIST',
      status: 'ACTIVE',
    });
    expect(JSON.stringify(me.body)).not.toContain('passwordHash');
  });

  it('停用用户的既有会话立即失效（每请求实时查库，禁用即时踢出）', async () => {
    const user = await createTestUser('disabled_session');
    const app = buildApp();
    const loginRes = await login(app, user.username);
    const cookie = `${SESSION_COOKIE_NAME}=${sessionCookieValue(loginRes)}`;

    await prisma.user.update({
      where: { id: BigInt(user.id) },
      data: { status: 'DISABLED' },
    });

    const me = await request(app).get('/api/v1/auth/me').set('Cookie', cookie);
    expect(me.status).toBe(401);
    expect(me.body.error.code).toBe('SESSION_EXPIRED');
  });

  it('A2 登出：删除会话 + 清除 Cookie；旧 Cookie 再访问 → 401', async () => {
    const user = await createTestUser('logout');
    const app = buildApp();
    const loginRes = await login(app, user.username);
    const sid = sessionCookieValue(loginRes);
    const cookie = `${SESSION_COOKIE_NAME}=${sid}`;

    const logout = await request(app).post('/api/v1/auth/logout').set('Cookie', cookie);
    expect(logout.status).toBe(200);
    expect(logout.body).toEqual({ data: { ok: true } });
    expect(rawSetCookie(logout)).toContain(`${SESSION_COOKIE_NAME}=`);

    expect(await prisma.session.findUnique({ where: { id: sid } })).toBeNull();

    const after = await request(app).get('/api/v1/auth/me').set('Cookie', cookie);
    expect(after.status).toBe(401);
  });

  it('越权：RECEPTIONIST 直调 ADMIN 路由 → 403；ADMIN → 200；未登录 → 401', async () => {
    const sessionMiddleware = createSessionMiddleware({
      cookieName: SESSION_COOKIE_NAME,
      resolveSession: (sid) => authService.resolveSession(sid),
      logger: silentLogger(),
    });
    const app = buildApp({
      extendApi: (router) => {
        router.get(
          '/__itest__/admin-only',
          sessionMiddleware,
          requireAuth,
          requireRole('ADMIN'),
          (_req, res) => {
            res.json({ data: { ok: true } });
          },
        );
      },
    });

    const anonymous = await request(app).get('/api/v1/__itest__/admin-only');
    expect(anonymous.status).toBe(401);

    const receptionist = await createTestUser('role_receptionist', { role: 'RECEPTIONIST' });
    const receptionistLogin = await login(app, receptionist.username);
    const receptionistCookie = `${SESSION_COOKIE_NAME}=${sessionCookieValue(receptionistLogin)}`;
    const forbidden = await request(app)
      .get('/api/v1/__itest__/admin-only')
      .set('Cookie', receptionistCookie);
    expect(forbidden.status).toBe(403);
    expect(forbidden.body.error.code).toBe('FORBIDDEN');

    const admin = await createTestUser('role_admin', { role: 'ADMIN' });
    const adminLogin = await login(app, admin.username);
    const adminCookie = `${SESSION_COOKIE_NAME}=${sessionCookieValue(adminLogin)}`;
    const allowed = await request(app)
      .get('/api/v1/__itest__/admin-only')
      .set('Cookie', adminCookie);
    expect(allowed.status).toBe(200);
    expect(allowed.body).toEqual({ data: { ok: true } });
  });

  it('单用户会话数上限：超出淘汰最旧（最多保留 10 条）', async () => {
    const user = await createTestUser('session_limit');
    const repository = createAuthRepository(prisma);

    for (let index = 0; index < MAX_SESSIONS_PER_USER + 2; index += 1) {
      await repository.completeLogin({
        userId: user.id,
        sessionId: randomBytes(32).toString('hex'),
        sessionExpiresAt: new Date(Date.now() + 60 * 60 * 1000),
        lastLoginAt: new Date(),
        maxSessionsPerUser: MAX_SESSIONS_PER_USER,
      });
    }

    const sessions = await prisma.session.findMany({ where: { userId: BigInt(user.id) } });
    expect(sessions).toHaveLength(MAX_SESSIONS_PER_USER);
  });

  it('过期会话清理：只删除过期行，保留有效行', async () => {
    const user = await createTestUser('cleanup');
    const repository = createAuthRepository(prisma);
    const activeSid = randomBytes(32).toString('hex');
    const expiredSid = randomBytes(32).toString('hex');
    await prisma.session.createMany({
      data: [
        {
          id: activeSid,
          userId: BigInt(user.id),
          expiresAt: new Date(Date.now() + 60 * 60 * 1000),
        },
        {
          id: expiredSid,
          userId: BigInt(user.id),
          expiresAt: new Date(Date.now() - 60 * 1000),
        },
      ],
    });

    const deleted = await repository.deleteExpiredSessions(new Date());
    expect(deleted).toBeGreaterThanOrEqual(1);
    expect(await prisma.session.findUnique({ where: { id: expiredSid } })).toBeNull();
    expect(await prisma.session.findUnique({ where: { id: activeSid } })).not.toBeNull();
  });

  it('敏感信息不进入日志：明文密码、bcrypt 哈希、会话 id 均不出现', async () => {
    const user = await createTestUser('logs');
    const chunks: string[] = [];
    const destination = new Writable({
      write(chunk, _encoding, callback) {
        chunks.push(String(chunk));
        callback();
      },
    });
    const captureLogger = createLogger({ nodeEnv: 'test', logLevel: 'info' }, destination);
    // 审计日志通过 authService 的 audit logger 输出：为捕获审计事件，用同一 logger 重新构建服务
    const captureAuthService = createAuthService({
      repository: createAuthRepository(prisma),
      audit: createAuditLogger(captureLogger),
      sessionTtlHours: config.sessionTtlHours,
    });
    const app = buildApp({ logger: captureLogger, authService: captureAuthService });

    const ok = await login(app, user.username);
    expect(ok.status).toBe(200);
    const sid = sessionCookieValue(ok);

    const bad = await login(app, user.username, 'Wrong#Logs999');
    expect(bad.status).toBe(401);

    await new Promise((resolve) => setImmediate(resolve));

    const text = chunks.join('');
    const dbUser = await prisma.user.findUniqueOrThrow({ where: { id: BigInt(user.id) } });
    expect(text).toContain('auth.login'); // 审计事件存在
    expect(text).not.toContain(plainPassword);
    expect(text).not.toContain('Wrong#Logs999');
    expect(text).not.toContain(dbUser.passwordHash);
    expect(text).not.toContain(sid);
    expect(text).not.toContain(`${SESSION_COOKIE_NAME}=${sid}`);
  });
});

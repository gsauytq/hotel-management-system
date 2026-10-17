import 'dotenv/config';

import type { Express } from 'express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createApp } from '../../src/app.js';
import { loadEnv, type AppConfig } from '../../src/config/env.js';
import type { PrismaClient } from '../../src/generated/prisma/client.js';
import { createDatabasePing, createPrismaClient } from '../../src/lib/prisma.js';
import { SESSION_COOKIE_NAME } from '../../src/modules/auth/auth.cookies.js';
import { createAuthRepository } from '../../src/modules/auth/auth.repository.js';
import { createAuthService, type AuthService } from '../../src/modules/auth/auth.service.js';
import { createAuditLogger } from '../../src/utils/audit.js';
import { createLogger } from '../../src/utils/logger.js';
import { hashPassword } from '../../src/utils/password.js';
import { createFakeBookingsService } from '../support/fake-bookings.js';
import { createFakeGuestsService } from '../support/fake-guests.js';
import { createFakeOrdersService } from '../support/fake-orders.js';
import { createFakeRoomTypesService, createFakeRoomsService } from '../support/fake-rooms.js';
import { createFakeStaysService } from '../support/fake-stays.js';
import { createFakeUsersService } from '../support/fake-users.js';

/**
 * TC-AUTH-009 / TC-SEC-009（NFR-SEC-002；security-design §2）：
 * 会话固定防护——客户端预置的 sid 不得被服务端沿用；登录必须换发新 sid，
 * 伪造 sid 既不存在于数据库，也不能访问受保护端点。
 *
 * 默认不运行；执行：HMS_INTEGRATION=1 vitest run。
 */
const runIntegration =
  process.env['HMS_INTEGRATION'] === '1' && Boolean(process.env['DATABASE_URL']);

const suite = runIntegration ? describe : describe.skip;

suite('TC-SEC-009 会话固定防护（Supertest + 真实 MySQL）', () => {
  const password = 'Itest#Pass123';
  const runId = Date.now().toString(36);
  const usernamePrefix = `itest_sf_${runId}`;
  const forgedSid = 'f'.repeat(64);

  let config: AppConfig;
  let prisma: PrismaClient;
  let app: Express;
  let username: string;

  beforeAll(async () => {
    config = loadEnv(process.env);
    prisma = createPrismaClient(config);
    const silent = createLogger({ nodeEnv: 'test', logLevel: 'silent' });
    const authService: AuthService = createAuthService({
      repository: createAuthRepository(prisma),
      audit: createAuditLogger(silent),
      sessionTtlHours: config.sessionTtlHours,
    });

    app = createApp({
      config,
      logger: silent,
      checkDatabase: () => createDatabasePing(prisma)(),
      authService,
      roomTypesService: createFakeRoomTypesService(),
      roomsService: createFakeRoomsService(),
      bookingsService: createFakeBookingsService(),
      staysService: createFakeStaysService(),
      ordersService: createFakeOrdersService(),
      usersService: createFakeUsersService(),
      guestsService: createFakeGuestsService(),
    });

    const user = await prisma.user.create({
      data: {
        username: `${usernamePrefix}_u`,
        passwordHash: await hashPassword(password),
        displayName: '会话固定测试用户',
        role: 'RECEPTIONIST',
      },
    });
    username = user.username;
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { username: { startsWith: usernamePrefix } } });
    await prisma.$disconnect();
  });

  it('带伪造 sid 登录 → 换发新 sid；伪造 sid 仍 401，新 sid 可用', async () => {
    expect(await prisma.session.count({ where: { id: forgedSid } })).toBe(0);

    const login = await request(app)
      .post('/api/v1/auth/login')
      .set('Cookie', `${SESSION_COOKIE_NAME}=${forgedSid}`)
      .send({ username, password });

    expect(login.status, JSON.stringify(login.body)).toBe(200);
    const raw = login.headers['set-cookie']?.[0] ?? '';
    expect(raw).not.toBe('');
    const newSid = (raw.split(';')[0] ?? '').slice(`${SESSION_COOKIE_NAME}=`.length);

    expect(newSid).toMatch(/^[0-9a-f]{64}$/);
    expect(newSid, '登录必须换发新 sid，不得沿用客户端提供的 sid').not.toBe(forgedSid);

    // 伪造 sid 从未落库
    expect(await prisma.session.count({ where: { id: forgedSid } })).toBe(0);
    const forgedMe = await request(app)
      .get('/api/v1/auth/me')
      .set('Cookie', `${SESSION_COOKIE_NAME}=${forgedSid}`);
    expect(forgedMe.status).toBe(401);
    expect(forgedMe.body.error.code).toBe('SESSION_EXPIRED');

    // 新 sid 已落库并绑定当前用户，可正常访问
    const session = await prisma.session.findUnique({ where: { id: newSid } });
    expect(session).not.toBeNull();
    const newMe = await request(app)
      .get('/api/v1/auth/me')
      .set('Cookie', `${SESSION_COOKIE_NAME}=${newSid}`);
    expect(newMe.status, JSON.stringify(newMe.body)).toBe(200);
    expect(newMe.body.data.username).toBe(username);
  });
});

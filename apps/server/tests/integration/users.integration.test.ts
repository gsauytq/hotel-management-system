import 'dotenv/config';

import type { Express } from 'express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createApp } from '../../src/app.js';
import { loadEnv, type AppConfig } from '../../src/config/env.js';
import type { PrismaClient } from '../../src/generated/prisma/client.js';
import { createDatabasePing, createPrismaClient } from '../../src/lib/prisma.js';
import { createAuthRepository } from '../../src/modules/auth/auth.repository.js';
import { createAuthService, type AuthService } from '../../src/modules/auth/auth.service.js';
import { createUsersRepository } from '../../src/modules/users/users.repository.js';
import { createUsersService } from '../../src/modules/users/users.service.js';
import { createAuditLogger } from '../../src/utils/audit.js';
import { createLogger } from '../../src/utils/logger.js';
import { hashPassword } from '../../src/utils/password.js';
import { createFakeBookingsService } from '../support/fake-bookings.js';
import { createFakeGuestsService } from '../support/fake-guests.js';
import { createFakeOrdersService } from '../support/fake-orders.js';
import { createFakeRoomTypesService, createFakeRoomsService } from '../support/fake-rooms.js';
import { createFakeStaysService } from '../support/fake-stays.js';

/**
 * 集成测试：Supertest + 真实 MySQL（开发计划 T-06）。
 * 默认不运行；执行方式：HMS_INTEGRATION=1 pnpm --filter @hms/server test
 */
const runIntegration =
  process.env['HMS_INTEGRATION'] === '1' && Boolean(process.env['DATABASE_URL']);

const suite = runIntegration ? describe : describe.skip;

suite('员工管理集成测试（Supertest + 真实 MySQL）', () => {
  const adminPassword = 'Admin#Pass123';
  const runId = Date.now().toString(36);
  const usernamePrefix = `itest_us_${runId}`;

  let config: AppConfig;
  let prisma: PrismaClient;
  let app: Express;
  let adminUserId: number;
  let adminCookie: string;
  let receptionistCookie: string;

  beforeAll(async () => {
    config = loadEnv(process.env);
    prisma = createPrismaClient(config);
    const silent = createLogger({ nodeEnv: 'test', logLevel: 'silent' });
    const authService: AuthService = createAuthService({
      repository: createAuthRepository(prisma),
      audit: createAuditLogger(silent),
      sessionTtlHours: config.sessionTtlHours,
    });

    const admin = await prisma.user.create({
      data: {
        username: `${usernamePrefix}_admin`,
        passwordHash: await hashPassword(adminPassword),
        displayName: '测试管理员',
        role: 'ADMIN',
      },
    });
    adminUserId = Number(admin.id);

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
      usersService: createUsersService({
        repository: createUsersRepository(prisma),
        audit: createAuditLogger(silent),
      }),
      guestsService: createFakeGuestsService(),
    });

    adminCookie = await loginCookie(`${usernamePrefix}_admin`, adminPassword);

    // 通过 U2 创建前台账号（同时覆盖创建接口），随后登录
    const receptionist = await request(app)
      .post('/api/v1/users')
      .set('Cookie', adminCookie)
      .send({
        username: `${usernamePrefix}_rec`,
        password: 'Front#Pass123',
        displayName: '测试前台',
        role: 'RECEPTIONIST',
      });
    expect(receptionist.status, JSON.stringify(receptionist.body)).toBe(200);
    receptionistCookie = await loginCookie(`${usernamePrefix}_rec`, 'Front#Pass123');
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { username: { startsWith: usernamePrefix } } });
    await prisma.$disconnect();
  });

  async function loginCookie(username: string, password: string): Promise<string> {
    const res = await request(app).post('/api/v1/auth/login').send({ username, password });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const raw = res.headers['set-cookie']?.[0] ?? '';
    return raw.split(';')[0] ?? '';
  }

  function createUser(body: Record<string, unknown>) {
    return request(app).post('/api/v1/users').set('Cookie', adminCookie).send(body);
  }

  describe('权限（U1–U4 全部仅 ADMIN，默认拒绝）', () => {
    it('未登录 → 401；RECEPTIONIST → 403', async () => {
      const endpoints = [
        request(app).get('/api/v1/users'),
        request(app).post('/api/v1/users').send({}),
        request(app).patch(`/api/v1/users/${adminUserId}`).send({}),
        request(app).patch(`/api/v1/users/${adminUserId}/password`).send({}),
        request(app).get(`/api/v1/users/${adminUserId}`),
      ];
      for (const pending of endpoints) {
        const res = await pending;
        expect(res.status).toBe(401);
        expect(res.body.error.code).toBe('SESSION_EXPIRED');
      }

      const forbidden = [
        request(app).get('/api/v1/users').set('Cookie', receptionistCookie),
        request(app).post('/api/v1/users').set('Cookie', receptionistCookie).send({}),
        request(app)
          .patch(`/api/v1/users/${adminUserId}`)
          .set('Cookie', receptionistCookie)
          .send({ role: 'ADMIN' }),
        request(app)
          .patch(`/api/v1/users/${adminUserId}/password`)
          .set('Cookie', receptionistCookie)
          .send({ newPassword: 'Hack#Pass123' }),
      ];
      for (const pending of forbidden) {
        const res = await pending;
        expect(res.status).toBe(403);
        expect(res.body.error.code).toBe('FORBIDDEN');
      }
    });
  });

  describe('U2 创建与 U1 列表', () => {
    it('创建成功返回 DTO（无 passwordHash）；重复用户名 409；弱密码/含用户名密码/未知字段 422', async () => {
      const username = `${usernamePrefix}_new`;
      const created = await createUser({
        username,
        password: 'Init#12345',
        displayName: '李雷',
        role: 'RECEPTIONIST',
      });
      expect(created.status, JSON.stringify(created.body)).toBe(200);
      expect(created.body.data).toMatchObject({
        username,
        displayName: '李雷',
        role: 'RECEPTIONIST',
        status: 'ACTIVE',
        lastLoginAt: null,
      });
      expect(JSON.stringify(created.body)).not.toContain('passwordHash');
      expect(JSON.stringify(created.body)).not.toContain('$2b$');

      const duplicate = await createUser({
        username,
        password: 'Init#12345',
        displayName: '重复',
        role: 'RECEPTIONIST',
      });
      expect(duplicate.status).toBe(409);
      expect(duplicate.body.error.code).toBe('DUPLICATE_USERNAME');

      const weak = await createUser({
        username: `${usernamePrefix}_weak`,
        password: 'short1',
        displayName: '弱密码',
        role: 'RECEPTIONIST',
      });
      expect(weak.status).toBe(422);

      const containsUsername = await createUser({
        username: `${usernamePrefix}_self`,
        password: `${usernamePrefix}_self#123`,
        displayName: '含用户名',
        role: 'RECEPTIONIST',
      });
      expect(containsUsername.status).toBe(422);
      expect(containsUsername.body.error.details[0].field).toBe('password');

      const unknownField = await createUser({
        username: `${usernamePrefix}_uf`,
        password: 'Init#12345',
        displayName: '未知',
        role: 'RECEPTIONIST',
        status: 'DISABLED',
      });
      expect(unknownField.status).toBe(422);
    });

    it('列表：role/status/keyword 过滤、分页、排序白名单；响应不含密码哈希', async () => {
      const list = await request(app)
        .get(`/api/v1/users?keyword=${usernamePrefix}_new&page=1&pageSize=10`)
        .set('Cookie', adminCookie);
      expect(list.status).toBe(200);
      expect(list.body.data.pagination.total).toBe(1);
      expect(list.body.data.items[0]).toMatchObject({
        username: `${usernamePrefix}_new`,
        displayName: '李雷',
        role: 'RECEPTIONIST',
        status: 'ACTIVE',
      });
      expect(JSON.stringify(list.body)).not.toContain('$2b$');

      const byRole = await request(app)
        .get('/api/v1/users?role=ADMIN&pageSize=100')
        .set('Cookie', adminCookie);
      expect(
        (byRole.body.data.items as Array<{ role: string }>).every((item) => item.role === 'ADMIN'),
      ).toBe(true);

      const byStatus = await request(app)
        .get('/api/v1/users?status=DISABLED')
        .set('Cookie', adminCookie);
      expect(byStatus.status).toBe(200);

      const sorted = await request(app)
        .get('/api/v1/users?sort=username:asc')
        .set('Cookie', adminCookie);
      expect(sorted.status).toBe(200);

      for (const query of ['sort=password:asc', 'sort=username:up', 'page=0', 'pageSize=101']) {
        const res = await request(app).get(`/api/v1/users?${query}`).set('Cookie', adminCookie);
        expect(res.status, query).toBe(422);
      }
    });

    it('详情端点（★ 契约增量）：存在 200 / 不存在 404 / 非法 id 422', async () => {
      const list = await request(app)
        .get(`/api/v1/users?keyword=${usernamePrefix}_admin`)
        .set('Cookie', adminCookie);
      const adminRow = (list.body.data.items as Array<{ id: number }>)[0];
      expect(adminRow).toBeDefined();

      const detail = await request(app)
        .get(`/api/v1/users/${adminRow?.id}`)
        .set('Cookie', adminCookie);
      expect(detail.status).toBe(200);
      expect(detail.body.data.username).toBe(`${usernamePrefix}_admin`);

      const missing = await request(app).get('/api/v1/users/999999').set('Cookie', adminCookie);
      expect(missing.status).toBe(404);

      const invalid = await request(app).get('/api/v1/users/abc').set('Cookie', adminCookie);
      expect(invalid.status).toBe(422);
    });
  });

  describe('U3 修改/启停', () => {
    it('修改姓名/角色生效；ADMIN 不可停用自己；不存在 404', async () => {
      const created = await createUser({
        username: `${usernamePrefix}_upd`,
        password: 'Init#12345',
        displayName: '待更新',
        role: 'RECEPTIONIST',
      });
      const id = Number(created.body.data.id as number);

      const updated = await request(app)
        .patch(`/api/v1/users/${id}`)
        .set('Cookie', adminCookie)
        .send({ displayName: '已更新', role: 'ADMIN' });
      expect(updated.status).toBe(200);
      expect(updated.body.data).toMatchObject({ displayName: '已更新', role: 'ADMIN' });

      const selfDisable = await request(app)
        .patch(`/api/v1/users/${adminUserId}`)
        .set('Cookie', adminCookie)
        .send({ status: 'DISABLED' });
      expect(selfDisable.status).toBe(403);
      expect(selfDisable.body.error).toMatchObject({
        code: 'FORBIDDEN',
        message: '不能停用当前登录账号',
      });

      const missing = await request(app)
        .patch('/api/v1/users/999999')
        .set('Cookie', adminCookie)
        .send({ displayName: 'x' });
      expect(missing.status).toBe(404);
    });

    it('停用员工后其会话立即失效（TC-SEC-003）', async () => {
      const username = `${usernamePrefix}_dis`;
      const created = await createUser({
        username,
        password: 'Init#12345',
        displayName: '待停用',
        role: 'RECEPTIONIST',
      });
      const id = Number(created.body.data.id as number);
      const targetCookie = await loginCookie(username, 'Init#12345');

      const disabled = await request(app)
        .patch(`/api/v1/users/${id}`)
        .set('Cookie', adminCookie)
        .send({ status: 'DISABLED' });
      expect(disabled.status).toBe(200);
      expect(disabled.body.data.status).toBe('DISABLED');

      const me = await request(app).get('/api/v1/auth/me').set('Cookie', targetCookie);
      expect(me.status).toBe(401);
      expect(me.body.error.code).toBe('SESSION_EXPIRED');

      // 停用账号重新登录 → 统一 401（不泄露状态）
      const relogin = await request(app)
        .post('/api/v1/auth/login')
        .send({ username, password: 'Init#12345' });
      expect(relogin.status).toBe(401);
    });
  });

  describe('U4 重置密码', () => {
    it('重置后旧密码失效、旧会话全部失效、新密码可登录并恢复会话', async () => {
      const username = `${usernamePrefix}_pwd`;
      const created = await createUser({
        username,
        password: 'Init#12345',
        displayName: '待重置',
        role: 'RECEPTIONIST',
      });
      const id = Number(created.body.data.id as number);
      const oldCookie = await loginCookie(username, 'Init#12345');

      const reset = await request(app)
        .patch(`/api/v1/users/${id}/password`)
        .set('Cookie', adminCookie)
        .send({ newPassword: 'New#Pass1234' });
      expect(reset.status).toBe(200);
      expect(reset.body).toEqual({ data: { ok: true } });

      const oldSession = await request(app).get('/api/v1/auth/me').set('Cookie', oldCookie);
      expect(oldSession.status).toBe(401);

      const oldPassword = await request(app)
        .post('/api/v1/auth/login')
        .send({ username, password: 'Init#12345' });
      expect(oldPassword.status).toBe(401);

      const newCookie = await loginCookie(username, 'New#Pass1234');
      const me = await request(app).get('/api/v1/auth/me').set('Cookie', newCookie);
      expect(me.status).toBe(200);
      expect(me.body.data.username).toBe(username);

      const weakReset = await request(app)
        .patch(`/api/v1/users/${id}/password`)
        .set('Cookie', adminCookie)
        .send({ newPassword: 'weak' });
      expect(weakReset.status).toBe(422);

      const missing = await request(app)
        .patch('/api/v1/users/999999/password')
        .set('Cookie', adminCookie)
        .send({ newPassword: 'New#Pass1234' });
      expect(missing.status).toBe(404);
    });
  });
});

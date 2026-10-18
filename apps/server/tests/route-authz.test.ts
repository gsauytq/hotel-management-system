import type { Express } from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';

import type { CurrentUser, Role } from '@hms/shared';

import { createApp } from '../src/app.js';
import { loadEnv } from '../src/config/env.js';
import { createLogger } from '../src/utils/logger.js';
import { createFakeAuthService } from './support/fake-auth.js';
import { createFakeBookingsService } from './support/fake-bookings.js';
import { createFakeGuestsService } from './support/fake-guests.js';
import { createFakeOrdersService } from './support/fake-orders.js';
import { createFakeRoomTypesService, createFakeRoomsService } from './support/fake-rooms.js';
import { createFakeStaysService } from './support/fake-stays.js';
import { createFakeUsersService } from './support/fake-users.js';

const TEST_KEY_BASE64 = Buffer.alloc(32, 7).toString('base64');
const SESSION_COOKIE = `hms_sid=${'a'.repeat(64)}`;

type Method = 'get' | 'post' | 'patch';
interface Endpoint {
  method: Method;
  path: string;
}

/** 登录角色可用（部分端点内部还有资源级规则） */
const loginOnlyEndpoints: Endpoint[] = [
  { method: 'get', path: '/api/v1/auth/me' },
  { method: 'post', path: '/api/v1/auth/logout' },
  { method: 'get', path: '/api/v1/room-types' },
  { method: 'get', path: '/api/v1/room-types/1' },
  { method: 'get', path: '/api/v1/rooms' },
  { method: 'get', path: '/api/v1/rooms/available' },
  { method: 'get', path: '/api/v1/rooms/1' },
  { method: 'patch', path: '/api/v1/rooms/1/status' },
  { method: 'get', path: '/api/v1/bookings' },
  { method: 'post', path: '/api/v1/bookings' },
  { method: 'get', path: '/api/v1/bookings/1' },
  { method: 'post', path: '/api/v1/bookings/1/cancel' },
  { method: 'post', path: '/api/v1/bookings/1/no-show' },
  { method: 'post', path: '/api/v1/bookings/1/check-in' },
  { method: 'get', path: '/api/v1/stays' },
  { method: 'post', path: '/api/v1/stays' },
  { method: 'get', path: '/api/v1/stays/1' },
  { method: 'post', path: '/api/v1/stays/1/checkout' },
  { method: 'get', path: '/api/v1/orders' },
  { method: 'get', path: '/api/v1/orders/1' },
  { method: 'get', path: '/api/v1/guests' },
  { method: 'post', path: '/api/v1/guests' },
  { method: 'get', path: '/api/v1/guests/1' },
  { method: 'patch', path: '/api/v1/guests/1' },
];

/** 仅 ADMIN（architecture §1.7 权限矩阵） */
const adminOnlyEndpoints: Endpoint[] = [
  { method: 'get', path: '/api/v1/users' },
  { method: 'get', path: '/api/v1/users/1' },
  { method: 'post', path: '/api/v1/users' },
  { method: 'patch', path: '/api/v1/users/1' },
  { method: 'patch', path: '/api/v1/users/1/password' },
  { method: 'post', path: '/api/v1/room-types' },
  { method: 'patch', path: '/api/v1/room-types/1' },
  { method: 'post', path: '/api/v1/room-types/1/archive' },
  { method: 'post', path: '/api/v1/rooms' },
  { method: 'patch', path: '/api/v1/rooms/1' },
];

function activeUser(role: Role): CurrentUser {
  return {
    id: role === 'ADMIN' ? 1 : 2,
    username: role === 'ADMIN' ? 'admin01' : 'front01',
    displayName: role === 'ADMIN' ? '管理员' : '前台',
    role,
    status: 'ACTIVE',
    mustChangePassword: false,
  };
}

function buildApp(sessionRole?: Role): Express {
  const config = loadEnv({
    NODE_ENV: 'test',
    LOG_LEVEL: 'silent',
    DATABASE_URL: 'mysql://hms_app:test-only@127.0.0.1:3306/hotel',
    GUEST_ID_HMAC_KEY: TEST_KEY_BASE64,
    GUEST_ID_CIPHER_KEY: TEST_KEY_BASE64,
  } as NodeJS.ProcessEnv);
  const logger = createLogger(config);
  const user = sessionRole === undefined ? undefined : activeUser(sessionRole);

  return createApp({
    config,
    logger,
    checkDatabase: async () => undefined,
    authService: createFakeAuthService({
      resolveSession: async () =>
        user === undefined
          ? { status: 'missing' }
          : {
              status: 'active',
              user,
              sessionId: 'a'.repeat(64),
              expiresAt: new Date(Date.now() + 60_000),
            },
    }),
    roomTypesService: createFakeRoomTypesService(),
    roomsService: createFakeRoomsService(),
    bookingsService: createFakeBookingsService(),
    staysService: createFakeStaysService(),
    ordersService: createFakeOrdersService(),
    usersService: createFakeUsersService(),
    guestsService: createFakeGuestsService(),
  });
}

function send(app: Express, endpoint: Endpoint, cookie?: string) {
  const agent = request(app)[endpoint.method](endpoint.path);
  if (cookie !== undefined) {
    agent.set('Cookie', cookie);
  }
  return endpoint.method === 'get' ? agent : agent.send({});
}

describe('路由权限矩阵（全量业务端点）', () => {
  it('公开端点：健康检查无需认证；登录接口无需会话', async () => {
    const app = buildApp();
    const health = await request(app).get('/api/health');
    expect(health.status).toBe(200);
    expect(health.body).toEqual({ status: 'ok' });

    const login = await request(app).post('/api/v1/auth/login').send({});
    // 登录接口公开：空体应为 422 而非 401
    expect(login.status).toBe(422);
  });

  it('未登录访问全部受保护端点 → 401 SESSION_EXPIRED（默认拒绝）', async () => {
    const app = buildApp();
    for (const endpoint of [...loginOnlyEndpoints, ...adminOnlyEndpoints]) {
      const res = await send(app, endpoint);
      expect(res.status, `${endpoint.method} ${endpoint.path}`).toBe(401);
      expect(res.body.error.code, `${endpoint.method} ${endpoint.path}`).toBe('SESSION_EXPIRED');
    }
  });

  it('RECEPTIONIST：业务端点可达（非 401/403），管理端点 403 FORBIDDEN', async () => {
    const app = buildApp('RECEPTIONIST');
    for (const endpoint of loginOnlyEndpoints) {
      const res = await send(app, endpoint, SESSION_COOKIE);
      expect([401, 403], `${endpoint.method} ${endpoint.path} -> ${res.status}`).not.toContain(
        res.status,
      );
    }
    for (const endpoint of adminOnlyEndpoints) {
      const res = await send(app, endpoint, SESSION_COOKIE);
      expect(res.status, `${endpoint.method} ${endpoint.path}`).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    }
  });

  it('ADMIN：管理端点可达（非 401/403）', async () => {
    const app = buildApp('ADMIN');
    for (const endpoint of adminOnlyEndpoints) {
      const res = await send(app, endpoint, SESSION_COOKIE);
      expect([401, 403], `${endpoint.method} ${endpoint.path} -> ${res.status}`).not.toContain(
        res.status,
      );
    }
  });
});

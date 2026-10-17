import type { Express } from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { createApp } from '../src/app.js';
import { loadEnv } from '../src/config/env.js';
import { ApiError } from '../src/shared/http/ApiError.js';
import { validate } from '../src/shared/middleware/validate.js';
import { createLogger } from '../src/utils/logger.js';
import { createFakeAuthService } from './support/fake-auth.js';
import { createFakeBookingsService } from './support/fake-bookings.js';
import { createFakeGuestsService } from './support/fake-guests.js';
import { createFakeOrdersService } from './support/fake-orders.js';
import { createFakeRoomTypesService, createFakeRoomsService } from './support/fake-rooms.js';
import { createFakeStaysService } from './support/fake-stays.js';
import { createFakeUsersService } from './support/fake-users.js';

const TEST_KEY_BASE64 = Buffer.alloc(32, 7).toString('base64');

/** 测试用数据库探测：始终连通（生产环境由真实 SELECT 1 实现，不得如此伪装） */
const databaseReachable = async (): Promise<void> => undefined;

interface TestAppOptions {
  checkDatabase: () => Promise<void>;
}

function buildTestApp({ checkDatabase }: TestAppOptions): Express {
  const config = loadEnv({
    NODE_ENV: 'test',
    LOG_LEVEL: 'silent',
    DATABASE_URL: 'mysql://hms_app:test-only@127.0.0.1:3306/hotel',
    GUEST_ID_HMAC_KEY: TEST_KEY_BASE64,
    GUEST_ID_CIPHER_KEY: TEST_KEY_BASE64,
  } as NodeJS.ProcessEnv);
  const logger = createLogger(config);

  return createApp({
    config,
    logger,
    checkDatabase,
    authService: createFakeAuthService(),
    roomTypesService: createFakeRoomTypesService(),
    roomsService: createFakeRoomsService(),
    bookingsService: createFakeBookingsService(),
    staysService: createFakeStaysService(),
    ordersService: createFakeOrdersService(),
    usersService: createFakeUsersService(),
    guestsService: createFakeGuestsService(),
    extendApi: (router) => {
      router.get(
        '/__test__/echo',
        validate({ query: z.object({ n: z.coerce.number().int() }) }),
        (req, res) => {
          res.json({ data: { n: req.query['n'] } });
        },
      );
      router.get('/__test__/conflict', (_req, _res, next) => {
        next(ApiError.conflict('ROOM_TYPE_SOLD_OUT', '所选日期该房型已无可售房间'));
      });
      router.get('/__test__/unauthorized', (_req, _res, next) => {
        next(ApiError.unauthorized());
      });
      router.get('/__test__/forbidden', (_req, _res, next) => {
        next(ApiError.forbidden());
      });
      router.get('/__test__/crash', () => {
        throw new Error('unexpected failure');
      });
      router.get('/__test__/async-crash', async () => {
        throw new Error('async unexpected failure');
      });
    },
  });
}

describe('GET /api/health（运行 + 数据库连通性）', () => {
  it('数据库探测通过 → 200 {status:"ok"} 且携带 X-Request-Id', async () => {
    const checkDatabase = vi.fn(databaseReachable);
    const res = await request(buildTestApp({ checkDatabase })).get('/api/health');

    expect(checkDatabase).toHaveBeenCalledTimes(1);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
    expect(res.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('数据库探测失败 → 503 {status:"error"}，不泄露内部错误细节', async () => {
    const checkDatabase = vi.fn(async () => {
      throw new Error('Access denied for user hms_app@mysql');
    });
    const res = await request(buildTestApp({ checkDatabase })).get('/api/health');

    expect(checkDatabase).toHaveBeenCalledTimes(1);
    expect(res.status).toBe(503);
    expect(res.body).toEqual({ status: 'error' });
    expect(JSON.stringify(res.body)).not.toContain('Access denied');
  });
});

describe('认证路由接线（T-05）', () => {
  it('未登录访问 /api/v1/auth/me → 401 SESSION_EXPIRED', async () => {
    const res = await request(buildTestApp({ checkDatabase: databaseReachable })).get(
      '/api/v1/auth/me',
    );
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('SESSION_EXPIRED');
  });

  it('未登录登出 → 401 SESSION_EXPIRED', async () => {
    const res = await request(buildTestApp({ checkDatabase: databaseReachable })).post(
      '/api/v1/auth/logout',
    );
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('SESSION_EXPIRED');
  });

  it('登录参数非法 → 422 VALIDATION_FAILED 且 details 指向 username', async () => {
    const res = await request(buildTestApp({ checkDatabase: databaseReachable }))
      .post('/api/v1/auth/login')
      .send({ username: 'ab', password: 'x' });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('VALIDATION_FAILED');
    expect(res.body.error.details[0].field).toBe('username');
  });

  it('登录限流：第 11 次请求 → 429 RATE_LIMITED + Retry-After', async () => {
    const app = buildTestApp({ checkDatabase: databaseReachable });
    for (let attempt = 1; attempt <= 10; attempt += 1) {
      const res = await request(app)
        .post('/api/v1/auth/login')
        .send({ username: 'front01', password: 'x' });
      expect(res.status, `attempt ${attempt}`).toBe(401);
    }
    const blocked = await request(app)
      .post('/api/v1/auth/login')
      .send({ username: 'front01', password: 'x' });
    expect(blocked.status).toBe(429);
    expect(blocked.body.error.code).toBe('RATE_LIMITED');
    expect(blocked.headers['retry-after']).toBeDefined();
  });
});

describe('房型/客房路由接线（T-07）', () => {
  it('未登录访问房型列表 → 401 SESSION_EXPIRED', async () => {
    const res = await request(buildTestApp({ checkDatabase: databaseReachable })).get(
      '/api/v1/room-types',
    );
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('SESSION_EXPIRED');
  });

  it('未登录访问客房列表 → 401 SESSION_EXPIRED', async () => {
    const res = await request(buildTestApp({ checkDatabase: databaseReachable })).get(
      '/api/v1/rooms',
    );
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('SESSION_EXPIRED');
  });

  it('未登录访问可分配房间列表 → 401 SESSION_EXPIRED', async () => {
    const res = await request(buildTestApp({ checkDatabase: databaseReachable })).get(
      '/api/v1/rooms/available',
    );
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('SESSION_EXPIRED');
  });

  it('未登录访问预订列表/创建 → 401 SESSION_EXPIRED', async () => {
    const list = await request(buildTestApp({ checkDatabase: databaseReachable })).get(
      '/api/v1/bookings',
    );
    expect(list.status).toBe(401);
    expect(list.body.error.code).toBe('SESSION_EXPIRED');

    const create = await request(buildTestApp({ checkDatabase: databaseReachable }))
      .post('/api/v1/bookings')
      .send({ guestId: 1, roomTypeId: 1, checkInDate: '2026-11-01', checkOutDate: '2026-11-02' });
    expect(create.status).toBe(401);
  });

  it('未登录访问入住/退房端点 → 401 SESSION_EXPIRED', async () => {
    const requests = [
      request(buildTestApp({ checkDatabase: databaseReachable })).get('/api/v1/stays'),
      request(buildTestApp({ checkDatabase: databaseReachable }))
        .post('/api/v1/stays')
        .send({}),
      request(buildTestApp({ checkDatabase: databaseReachable })).get('/api/v1/stays/1'),
      request(buildTestApp({ checkDatabase: databaseReachable }))
        .post('/api/v1/stays/1/checkout')
        .send({}),
      request(buildTestApp({ checkDatabase: databaseReachable }))
        .post('/api/v1/bookings/1/check-in')
        .send({}),
    ];
    for (const pending of requests) {
      const res = await pending;
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('SESSION_EXPIRED');
    }
  });
});

describe('未知业务路由', () => {
  it('未挂载的 /api/v1 路由返回 404 NOT_FOUND 统一错误信封', async () => {
    const res = await request(buildTestApp({ checkDatabase: databaseReachable })).get(
      '/api/v1/not-implemented',
    );
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
    expect(res.headers['x-request-id']).toBeDefined();
  });
});

describe('CSRF Origin 校验（security-design §8 防线 2）', () => {
  it('伪造跨源 Origin 的非 GET 请求 → 403 FORBIDDEN', async () => {
    const res = await request(buildTestApp({ checkDatabase: databaseReachable }))
      .post('/api/v1/anything')
      .set('Origin', 'https://evil.example')
      .send({});
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('同源 Origin（与 Host 一致）放行', async () => {
    const res = await request(buildTestApp({ checkDatabase: databaseReachable }))
      .post('/api/v1/anything')
      .set('Host', 'hms.example')
      .set('Origin', 'http://hms.example')
      .send({});
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });
});

describe('统一错误处理（参数/认证/权限/业务/未知）', () => {
  it('畸形 JSON 请求体 → 400 INVALID_BODY', async () => {
    const res = await request(buildTestApp({ checkDatabase: databaseReachable }))
      .post('/api/v1/anything')
      .set('Content-Type', 'application/json')
      .send('{"broken":');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_BODY');
  });

  it('请求体超过 100kb 限制 → 400 INVALID_BODY（而非 500）', async () => {
    const res = await request(buildTestApp({ checkDatabase: databaseReachable }))
      .post('/api/v1/anything')
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({ payload: 'x'.repeat(200 * 1024) }));
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_BODY');
    expect(res.body.error.message).toContain('100kb');
  });

  it('未认证 → 401 SESSION_EXPIRED 统一信封', async () => {
    const res = await request(buildTestApp({ checkDatabase: databaseReachable })).get(
      '/api/v1/__test__/unauthorized',
    );
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('SESSION_EXPIRED');
  });

  it('无权限 → 403 FORBIDDEN 统一信封', async () => {
    const res = await request(buildTestApp({ checkDatabase: databaseReachable })).get(
      '/api/v1/__test__/forbidden',
    );
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('query 校验失败 → 422 VALIDATION_FAILED 且 details 指向字段', async () => {
    const res = await request(buildTestApp({ checkDatabase: databaseReachable })).get(
      '/api/v1/__test__/echo?n=abc',
    );
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('VALIDATION_FAILED');
    expect(res.body.error.details[0].field).toBe('n');
  });

  it('query 校验通过 → 200 且已完成类型转换', async () => {
    const res = await request(buildTestApp({ checkDatabase: databaseReachable })).get(
      '/api/v1/__test__/echo?n=42',
    );
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ data: { n: 42 } });
  });

  it('服务层 ApiError 业务冲突 → 409 + 业务错误码', async () => {
    const res = await request(buildTestApp({ checkDatabase: databaseReachable })).get(
      '/api/v1/__test__/conflict',
    );
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('ROOM_TYPE_SOLD_OUT');
  });

  it('同步未捕获异常 → 500 INTERNAL_ERROR + requestId（不回显堆栈）', async () => {
    const res = await request(buildTestApp({ checkDatabase: databaseReachable })).get(
      '/api/v1/__test__/crash',
    );
    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe('INTERNAL_ERROR');
    expect(res.body.error.requestId).toBe(res.headers['x-request-id']);
    expect(JSON.stringify(res.body)).not.toContain('unexpected failure');
  });

  it('异步未捕获异常（Express 5 自动转发）→ 500 INTERNAL_ERROR', async () => {
    const res = await request(buildTestApp({ checkDatabase: databaseReachable })).get(
      '/api/v1/__test__/async-crash',
    );
    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe('INTERNAL_ERROR');
    expect(res.body.error.requestId).toBe(res.headers['x-request-id']);
    expect(JSON.stringify(res.body)).not.toContain('async unexpected failure');
  });
});

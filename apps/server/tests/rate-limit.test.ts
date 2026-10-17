import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { createErrorHandler } from '../src/shared/middleware/errorHandler.js';
import { createRateLimiter } from '../src/shared/middleware/rateLimit.js';
import { createLogger } from '../src/utils/logger.js';

const logger = createLogger({ nodeEnv: 'test', logLevel: 'silent' });

function buildApp(options: { key?: (req: express.Request) => string } = {}) {
  let currentTime = 0;
  const limiter = createRateLimiter({
    max: 2,
    windowMs: 1000,
    message: '尝试次数过多，请稍后再试',
    now: () => currentTime,
    ...options,
  });
  const app = express();
  app.get('/limited', limiter, (_req, res) => {
    res.json({ data: { ok: true } });
  });
  app.use(createErrorHandler(logger));
  return {
    app,
    advance: (ms: number): void => {
      currentTime += ms;
    },
  };
}

describe('滑动窗口限流（security-design §3）', () => {
  it('窗口内超限 → 429 RATE_LIMITED + Retry-After', async () => {
    const { app } = buildApp();

    expect((await request(app).get('/limited')).status).toBe(200);
    expect((await request(app).get('/limited')).status).toBe(200);

    const blocked = await request(app).get('/limited');
    expect(blocked.status).toBe(429);
    expect(blocked.body.error.code).toBe('RATE_LIMITED');
    expect(blocked.headers['retry-after']).toBe('1');
  });

  it('窗口滑过后恢复可用', async () => {
    const { app, advance } = buildApp();
    await request(app).get('/limited');
    await request(app).get('/limited');
    expect((await request(app).get('/limited')).status).toBe(429);

    advance(1001);
    expect((await request(app).get('/limited')).status).toBe(200);
  });

  it('按 key 隔离（不同 IP/键互不影响）', async () => {
    const { app } = buildApp({ key: (req) => String(req.headers['x-client']) });
    await request(app).get('/limited').set('x-client', 'a');
    await request(app).get('/limited').set('x-client', 'a');
    expect((await request(app).get('/limited').set('x-client', 'a')).status).toBe(429);
    expect((await request(app).get('/limited').set('x-client', 'b')).status).toBe(200);
  });
});

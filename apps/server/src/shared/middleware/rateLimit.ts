import type { Request, RequestHandler } from 'express';

import { ApiError } from '../http/ApiError.js';

export interface RateLimitOptions {
  /** 窗口内允许的最大请求数 */
  max: number;
  /** 滑动窗口长度（毫秒） */
  windowMs: number;
  /** 429 错误消息 */
  message?: string;
  /** 限流键（默认取 req.ip） */
  key?: (req: Request) => string;
  /** 时间源（测试注入用，默认 Date.now） */
  now?: () => number;
}

const MAX_TRACKED_KEYS = 10_000;

/**
 * 内存滑动窗口限流（security-design §3：登录每 IP 每分钟 10 次，单实例足够）。
 * 超限返回 429 RATE_LIMITED + Retry-After（秒）。
 */
export function createRateLimiter(options: RateLimitOptions): RequestHandler {
  const hits = new Map<string, number[]>();
  const now = options.now ?? (() => Date.now());

  return (req, res, next) => {
    const current = now();
    const key = options.key?.(req) ?? req.ip ?? req.socket.remoteAddress ?? 'unknown';
    const windowStart = current - options.windowMs;
    const timestamps = (hits.get(key) ?? []).filter((timestamp) => timestamp > windowStart);

    if (timestamps.length >= options.max) {
      const oldest = timestamps[0] ?? current;
      const retryAfterSeconds = Math.max(
        1,
        Math.ceil((oldest + options.windowMs - current) / 1000),
      );
      res.setHeader('Retry-After', String(retryAfterSeconds));
      hits.set(key, timestamps);
      next(ApiError.fromCode('RATE_LIMITED', options.message ?? '请求过于频繁，请稍后再试'));
      return;
    }

    timestamps.push(current);
    hits.set(key, timestamps);

    // 防御性清理：键过多时移除窗口内已无请求的键，避免内存无限增长
    if (hits.size > MAX_TRACKED_KEYS) {
      for (const [trackedKey, trackedTimestamps] of hits) {
        if (trackedTimestamps.every((timestamp) => timestamp <= windowStart)) {
          hits.delete(trackedKey);
        }
      }
    }

    next();
  };
}

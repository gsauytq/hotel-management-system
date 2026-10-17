import type { RequestHandler } from 'express';

import type { AppConfig } from '../../config/env.js';
import { ApiError } from '../http/ApiError.js';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

function hostOf(value: string): string | null {
  try {
    return new URL(value).host;
  } catch {
    return null;
  }
}

export function csrfProtection(config: Pick<AppConfig, 'corsOrigin'>): RequestHandler {
  const allowedOrigins = (config.corsOrigin ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0);

  return (req, _res, next) => {
    if (SAFE_METHODS.has(req.method)) return next();

    const origin = req.headers.origin;
    if (origin !== undefined) {
      if (allowedOrigins.includes(origin)) return next();
      if (hostOf(origin) === req.headers.host) return next();
      return next(ApiError.forbidden('跨站请求被拒绝'));
    }

    const referer = req.headers.referer;
    if (referer !== undefined) {
      if (hostOf(referer) === req.headers.host) return next();
      return next(ApiError.forbidden('跨站请求被拒绝'));
    }

    // 无 Origin/Referer 的非浏览器客户端（curl、集成测试、健康检查）放行；
    // 浏览器跨站请求必带 Origin，已在上方拒绝（security-design §8 防线 2）。
    return next();
  };
}

import type { CookieOptions } from 'express';

import type { AppConfig } from '../../config/env.js';

/** 会话 Cookie 名称（security-design §3） */
export const SESSION_COOKIE_NAME = 'hms_sid';

type CookieConfig = Pick<AppConfig, 'nodeEnv' | 'sessionTtlHours'>;
type ClearCookieConfig = Pick<AppConfig, 'nodeEnv'>;

/** 会话 Cookie：HttpOnly; SameSite=Strict; Secure(生产); Path=/; Max-Age=TTL */
export function sessionCookieOptions(config: CookieConfig): CookieOptions {
  return {
    httpOnly: true,
    sameSite: 'strict',
    secure: config.nodeEnv === 'production',
    path: '/',
    maxAge: config.sessionTtlHours * 60 * 60 * 1000,
  };
}

/** 清除会话 Cookie（登出）：同名同作用域，Max-Age=0 */
export function clearSessionCookieOptions(config: ClearCookieConfig): CookieOptions {
  return {
    httpOnly: true,
    sameSite: 'strict',
    secure: config.nodeEnv === 'production',
    path: '/',
  };
}

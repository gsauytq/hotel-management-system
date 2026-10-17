import pino, { type DestinationStream, type Logger } from 'pino';

import type { AppConfig, LogLevel } from '../config/env.js';

/**
 * 敏感字段过滤（security-design §9）：
 * - 凭证/Cookie/令牌：请求与响应中的 Cookie、Authorization、Set-Cookie、token、session id
 * - 密码与证件：password / newPassword / passwordHash / idNumber（含嵌套字段）
 */
export const LOG_REDACT_PATHS = [
  'req.headers.cookie',
  'req.headers.authorization',
  'res.headers.set-cookie',
  'cookie',
  'token',
  'accessToken',
  'refreshToken',
  'sessionId',
  'sid',
  '*.cookie',
  '*.token',
  '*.accessToken',
  '*.refreshToken',
  '*.sessionId',
  '*.sid',
  'password',
  'newPassword',
  'idNumber',
  'passwordHash',
  '*.password',
  '*.newPassword',
  '*.idNumber',
  '*.passwordHash',
];

export interface LoggerOptions {
  nodeEnv: AppConfig['nodeEnv'];
  logLevel: LogLevel;
}

export function createLogger(options: LoggerOptions, destination?: DestinationStream): Logger {
  return pino(
    {
      level: options.logLevel,
      redact: { paths: LOG_REDACT_PATHS, censor: '[REDACTED]' },
      ...(options.nodeEnv === 'development'
        ? {
            transport: {
              target: 'pino-pretty',
              options: { translateTime: 'SYS:standard', singleLine: true },
            },
          }
        : {}),
    },
    destination,
  );
}

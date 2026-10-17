import { z } from 'zod';

const parseableUrl = z.string().refine(
  (value) => {
    try {
      void new URL(value);
      return true;
    } catch {
      return false;
    }
  },
  { message: '必须是合法的连接 URL（如 mysql://user:pass@host:3306/db）' },
);

const base64Key = (expectedBytes: number) =>
  z.string().refine(
    (value) => {
      try {
        return Buffer.from(value, 'base64').length === expectedBytes;
      } catch {
        return false;
      }
    },
    { message: `必须是 base64 编码的 ${expectedBytes} 字节密钥` },
  );

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  DATABASE_URL: parseableUrl,
  MIGRATION_DATABASE_URL: parseableUrl.optional(),
  SESSION_TTL_HOURS: z.coerce.number().int().min(1).max(720).default(8),
  GUEST_ID_HMAC_KEY: base64Key(32),
  GUEST_ID_CIPHER_KEY: base64Key(32),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  CORS_ORIGIN: z.string().min(1).optional(),
});

export type NodeEnv = 'development' | 'test' | 'production';
export type LogLevel = 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace' | 'silent';

export interface AppConfig {
  nodeEnv: NodeEnv;
  port: number;
  databaseUrl: string;
  migrationDatabaseUrl: string | undefined;
  sessionTtlHours: number;
  guestIdHmacKey: string;
  guestIdCipherKey: string;
  logLevel: LogLevel;
  corsOrigin: string | undefined;
}

export function loadEnv(source: NodeJS.ProcessEnv = process.env): AppConfig {
  const result = envSchema.safeParse(source);
  if (!result.success) {
    const problems = result.error.issues.map((issue) => {
      const key = issue.path.join('.') || '(root)';
      return `  - ${key}: ${issue.message}`;
    });
    throw new Error(
      `环境变量校验失败，拒绝启动（ADR-007 fail-fast）；请参照 apps/server/.env.example 配置：\n${problems.join('\n')}`,
    );
  }

  const env = result.data;
  return {
    nodeEnv: env.NODE_ENV,
    port: env.PORT,
    databaseUrl: env.DATABASE_URL,
    migrationDatabaseUrl: env.MIGRATION_DATABASE_URL,
    sessionTtlHours: env.SESSION_TTL_HOURS,
    guestIdHmacKey: env.GUEST_ID_HMAC_KEY,
    guestIdCipherKey: env.GUEST_ID_CIPHER_KEY,
    logLevel: env.LOG_LEVEL,
    corsOrigin: env.CORS_ORIGIN,
  };
}

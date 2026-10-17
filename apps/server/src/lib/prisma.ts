import { PrismaMariaDb } from '@prisma/adapter-mariadb';

import { PrismaClient } from '../generated/prisma/client.js';
import type { AppConfig } from '../config/env.js';

/** 数据库健康探测默认超时：数据库不可达时健康接口必须及时失败而不是挂起 */
export const DATABASE_HEALTH_TIMEOUT_MS = 2_000;

export function createPrismaClient(config: AppConfig): PrismaClient {
  const url = new URL(config.databaseUrl);
  const adapter = new PrismaMariaDb({
    host: url.hostname,
    port: url.port === '' ? 3306 : Number(url.port),
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    database: url.pathname.replace(/^\//, ''),
    connectionLimit: 10,
    connectTimeout: 10_000,
    acquireTimeout: 30_000,
    // MySQL 8.4 默认 caching_sha2_password：compose 内网未启用 TLS 时，
    // 需允许向服务器请求 RSA 公钥完成首次完整认证（数据库仅 compose 内网可达，
    // security-design §6；TLS 由部署前置 LB 终结）。缺少此项会导致首次连接池超时。
    allowPublicKeyRetrieval: true,
  });
  return new PrismaClient({ adapter });
}

export type DatabasePing = () => Promise<void>;

/**
 * 创建真实的数据库连通性探测函数：执行参数化 `SELECT 1`
 * （Prisma tagged template，security-design §6 禁止字符串拼接 SQL），
 * 查询失败或超时即视为不可用。
 *
 * 注意：健康检查不允许使用空实现或固定成功结果伪装（本任务硬性约束），
 * 生产环境必须由本函数（或等价真实查询）提供 `checkDatabase`。
 */
export function createDatabasePing(
  prisma: PrismaClient,
  timeoutMs: number = DATABASE_HEALTH_TIMEOUT_MS,
): DatabasePing {
  return async () => {
    let timer: NodeJS.Timeout | undefined;
    try {
      await Promise.race([
        prisma.$queryRaw`SELECT 1`.then(() => undefined),
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(
            () => reject(new Error(`数据库健康检查超时（${timeoutMs}ms）`)),
            timeoutMs,
          );
        }),
      ]);
    } finally {
      if (timer !== undefined) {
        clearTimeout(timer);
      }
    }
  };
}

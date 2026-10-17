import 'dotenv/config';

import type { Server } from 'node:http';
import type { Logger } from 'pino';

import { createApp } from './app.js';
import { loadEnv } from './config/env.js';
import { createDatabasePing, createPrismaClient } from './lib/prisma.js';
import { SESSION_CLEANUP_INTERVAL_MS } from './modules/auth/auth.constants.js';
import { createAuthRepository } from './modules/auth/auth.repository.js';
import { createAuthService } from './modules/auth/auth.service.js';
import { createBookingsRepository } from './modules/bookings/bookings.repository.js';
import { createBookingsService } from './modules/bookings/bookings.service.js';
import { createGuestsRepository } from './modules/guests/guests.repository.js';
import { createGuestsService } from './modules/guests/guests.service.js';
import { createOrdersRepository } from './modules/orders/orders.repository.js';
import { createOrdersService } from './modules/orders/orders.service.js';
import { createRoomTypesRepository } from './modules/room-types/room-types.repository.js';
import { createRoomTypesService } from './modules/room-types/room-types.service.js';
import { createRoomsRepository } from './modules/rooms/rooms.repository.js';
import { createRoomsService } from './modules/rooms/rooms.service.js';
import { createStaysRepository } from './modules/stays/stays.repository.js';
import { createStaysService } from './modules/stays/stays.service.js';
import { createUsersRepository } from './modules/users/users.repository.js';
import { createUsersService } from './modules/users/users.service.js';
import { createAuditLogger } from './utils/audit.js';
import { createGuestCrypto } from './utils/crypto.js';
import { createLogger } from './utils/logger.js';

interface ShutdownDependencies {
  logger: Logger;
  server: Server;
  disconnectDatabase: () => Promise<void>;
}

async function bootstrap(): Promise<void> {
  const config = loadEnv();
  const logger = createLogger(config);

  // 数据库生命周期：启动即执行真实连通性探测（SELECT 1），失败即拒绝启动（fail fast）；
  // 注意：Prisma 7 驱动适配器的 $connect() 为延迟连接池，不做真实探测，不能用于启动校验。
  const prisma = createPrismaClient(config);
  const checkDatabase = createDatabasePing(prisma);
  try {
    await checkDatabase();
    logger.info('database connection established');
  } catch (error) {
    logger.fatal({ err: error }, '数据库连接失败，拒绝启动（fail fast）');
    await prisma.$disconnect().catch(() => undefined);
    process.exitCode = 1;
    return;
  }

  const authService = createAuthService({
    repository: createAuthRepository(prisma),
    audit: createAuditLogger(logger),
    sessionTtlHours: config.sessionTtlHours,
  });

  const roomTypesService = createRoomTypesService({
    repository: createRoomTypesRepository(prisma),
  });
  const roomsService = createRoomsService({
    repository: createRoomsRepository(prisma),
    roomTypesService,
  });
  const bookingsService = createBookingsService({
    repository: createBookingsRepository(prisma),
  });
  const staysService = createStaysService({
    repository: createStaysRepository(prisma),
    audit: createAuditLogger(logger),
  });
  const ordersService = createOrdersService({
    repository: createOrdersRepository(prisma),
  });
  const usersService = createUsersService({
    repository: createUsersRepository(prisma),
    audit: createAuditLogger(logger),
  });
  const guestsService = createGuestsService({
    repository: createGuestsRepository(prisma),
    crypto: createGuestCrypto({
      hmacKeyBase64: config.guestIdHmacKey,
      cipherKeyBase64: config.guestIdCipherKey,
    }),
  });

  const app = createApp({
    config,
    logger,
    checkDatabase,
    authService,
    roomTypesService,
    roomsService,
    bookingsService,
    staysService,
    ordersService,
    usersService,
    guestsService,
  });

  // 过期会话清理（security-design §2：每小时清理过期行；unref 不阻塞进程退出）
  const sessionCleanupTimer = setInterval(() => {
    void authService
      .cleanupExpiredSessions()
      .then((count) => {
        if (count > 0) {
          logger.info({ count }, 'expired sessions cleaned');
        }
      })
      .catch((error: unknown) => {
        logger.error({ err: error }, 'session cleanup failed');
      });
  }, SESSION_CLEANUP_INTERVAL_MS);
  sessionCleanupTimer.unref();

  const server = app.listen(config.port, () => {
    logger.info({ port: config.port, nodeEnv: config.nodeEnv }, 'HMS API listening');
  });
  server.on('error', (error) => {
    logger.fatal({ err: error }, 'HTTP server error');
    process.exit(1);
  });

  registerShutdownHandlers({
    logger,
    server,
    disconnectDatabase: () => prisma.$disconnect(),
  });
}

function registerShutdownHandlers({
  logger,
  server,
  disconnectDatabase,
}: ShutdownDependencies): void {
  let shuttingDown = false;

  const shutdown = (signal: NodeJS.Signals): void => {
    if (shuttingDown) {
      logger.warn({ signal }, 'shutdown already in progress, ignoring signal');
      return;
    }
    shuttingDown = true;
    logger.info({ signal }, 'shutting down');

    const forceExit = setTimeout(() => {
      logger.error('graceful shutdown timed out (10s), forcing exit');
      process.exit(1);
    }, 10_000);
    forceExit.unref();

    server.close(() => {
      void disconnectDatabase()
        .catch((error: unknown) => {
          logger.error({ err: error }, 'database disconnect failed');
        })
        .finally(() => {
          clearTimeout(forceExit);
          logger.info('shutdown complete');
          process.exit(0);
        });
    });
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('uncaughtException', (error) => {
    logger.fatal({ err: error }, 'uncaught exception, exiting');
    process.exit(1);
  });
  process.on('unhandledRejection', (reason) => {
    logger.fatal({ err: reason }, 'unhandled rejection, exiting');
    process.exit(1);
  });
}

bootstrap().catch((error: unknown) => {
  // 启动早期失败（logger 可能尚未创建）：直接输出到 stderr，确保错误可见
  console.error('HMS API 启动失败:', error instanceof Error ? error.message : error);
  process.exitCode = 1;
});

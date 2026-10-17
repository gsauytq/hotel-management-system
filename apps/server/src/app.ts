import express, { type Express, type Router } from 'express';
import type { Logger } from 'pino';

import type { AppConfig } from './config/env.js';
import { LOGIN_RATE_LIMIT_MAX, LOGIN_RATE_LIMIT_WINDOW_MS } from './modules/auth/auth.constants.js';
import { SESSION_COOKIE_NAME } from './modules/auth/auth.cookies.js';
import { createAuthRouter } from './modules/auth/auth.routes.js';
import type { AuthService } from './modules/auth/auth.service.js';
import { createBookingsRouter } from './modules/bookings/bookings.routes.js';
import type { BookingsService } from './modules/bookings/bookings.service.js';
import { createGuestsRouter } from './modules/guests/guests.routes.js';
import type { GuestsService } from './modules/guests/guests.service.js';
import { createHealthRouter } from './modules/health/health.routes.js';
import { createOrdersRouter } from './modules/orders/orders.routes.js';
import type { OrdersService } from './modules/orders/orders.service.js';
import { createRoomTypesRouter } from './modules/room-types/room-types.routes.js';
import type { RoomTypesService } from './modules/room-types/room-types.service.js';
import { createRoomsRouter } from './modules/rooms/rooms.routes.js';
import type { RoomsService } from './modules/rooms/rooms.service.js';
import { createBookingCheckInRouter, createStaysRouter } from './modules/stays/stays.routes.js';
import type { StaysService } from './modules/stays/stays.service.js';
import { createUsersRouter } from './modules/users/users.routes.js';
import type { UsersService } from './modules/users/users.service.js';
import { JSON_BODY_LIMIT } from './shared/http/limits.js';
import { csrfProtection } from './shared/middleware/csrf.js';
import { createErrorHandler } from './shared/middleware/errorHandler.js';
import { notFoundHandler } from './shared/middleware/notFound.js';
import { createRateLimiter } from './shared/middleware/rateLimit.js';
import { requestId } from './shared/middleware/requestId.js';
import { createRequestLogger } from './shared/middleware/requestLogger.js';
import { createSessionMiddleware } from './shared/middleware/session.js';

export interface AppDependencies {
  config: AppConfig;
  logger: Logger;
  /** 数据库连通性探测；生产环境必须由真实 SELECT 1 实现（见 lib/prisma.ts） */
  checkDatabase: () => Promise<void>;
  authService: AuthService;
  roomTypesService: RoomTypesService;
  roomsService: RoomsService;
  bookingsService: BookingsService;
  staysService: StaysService;
  ordersService: OrdersService;
  usersService: UsersService;
  guestsService: GuestsService;
  extendApi?: (router: Router) => void;
}

export function createApp({
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
  extendApi,
}: AppDependencies): Express {
  const app = express();
  app.disable('x-powered-by');
  // 生产拓扑为 Nginx 前置反代（ADR-010），信任一跳代理以取得真实客户端 IP（登录限流用）
  app.set('trust proxy', 1);

  app.use(requestId());
  app.use(createRequestLogger(logger));
  app.use(express.json({ limit: JSON_BODY_LIMIT }));
  app.use(csrfProtection(config));

  app.use('/api/health', createHealthRouter({ logger, checkDatabase }));

  const sessionMiddleware = createSessionMiddleware({
    cookieName: SESSION_COOKIE_NAME,
    resolveSession: (sessionId) => authService.resolveSession(sessionId),
    logger,
  });

  const apiV1 = express.Router();
  apiV1.use(
    '/auth',
    createAuthRouter({
      config,
      authService,
      sessionMiddleware,
      loginRateLimiter: createRateLimiter({
        max: LOGIN_RATE_LIMIT_MAX,
        windowMs: LOGIN_RATE_LIMIT_WINDOW_MS,
        message: '尝试次数过多，请稍后再试',
      }),
    }),
  );
  apiV1.use('/room-types', createRoomTypesRouter({ roomTypesService, sessionMiddleware }));
  apiV1.use('/rooms', createRoomsRouter({ roomsService, sessionMiddleware }));
  apiV1.use('/bookings', createBookingsRouter({ bookingsService, sessionMiddleware }));
  apiV1.use('/bookings', createBookingCheckInRouter({ staysService, sessionMiddleware }));
  apiV1.use('/stays', createStaysRouter({ staysService, sessionMiddleware }));
  apiV1.use('/orders', createOrdersRouter({ ordersService, sessionMiddleware }));
  apiV1.use('/users', createUsersRouter({ usersService, sessionMiddleware }));
  apiV1.use('/guests', createGuestsRouter({ guestsService, sessionMiddleware }));
  // 全部业务域已挂载（auth/users/room-types/rooms/guests/bookings/stays/orders）
  extendApi?.(apiV1);
  app.use('/api/v1', apiV1);

  app.use(notFoundHandler);
  app.use(createErrorHandler(logger));

  return app;
}

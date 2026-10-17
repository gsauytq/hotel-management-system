import { Router, type RequestHandler } from 'express';
import { z } from 'zod';

import {
  BOOKING_STATUSES,
  cancelBookingSchema,
  createBookingSchema,
  dateOnlySchema,
} from '@hms/shared';

import { paginationQueryShape, sortQuerySchema } from '../../shared/http/pagination.js';
import { requireAuth } from '../../shared/middleware/requireAuth.js';
import { validate } from '../../shared/middleware/validate.js';
import { createBookingsController } from './bookings.controller.js';
import type { BookingsService } from './bookings.service.js';

export interface BookingsRouterDependencies {
  bookingsService: BookingsService;
  sessionMiddleware: RequestHandler;
}

const idParamsSchema = z.object({
  id: z.coerce.number().int('资源 id 必须为整数').min(1, '资源 id 无效'),
});

const listBookingsQuerySchema = z.object({
  ...paginationQueryShape(),
  status: z.enum(BOOKING_STATUSES).optional(),
  guestId: z.coerce.number().int('客人 id 必须为整数').min(1, '客人 id 无效').optional(),
  checkInDateFrom: dateOnlySchema.optional(),
  checkInDateTo: dateOnlySchema.optional(),
  // ★ 增量参数（契约补充，需评审追认）：按退房日期范围筛选
  checkOutDateFrom: dateOnlySchema.optional(),
  checkOutDateTo: dateOnlySchema.optional(),
  keyword: z.string().trim().min(1, '关键字不能为空').max(50, '关键字过长').optional(),
  sort: sortQuerySchema(['createdAt', 'checkInDate', 'status']),
});

export function createBookingsRouter(deps: BookingsRouterDependencies): Router {
  const controller = createBookingsController({ service: deps.bookingsService });
  const router = Router();
  const authenticated = [deps.sessionMiddleware, requireAuth] as const;

  // B2 列表（分页/筛选/排序白名单）
  router.get('/', ...authenticated, validate({ query: listBookingsQuerySchema }), controller.list);
  // B1 创建（登录角色均可；事务内房型行锁 + 重叠计数防超售）
  router.post('/', ...authenticated, validate({ body: createBookingSchema }), controller.create);
  // B3 详情（已入住含 stayId）
  router.get('/:id', ...authenticated, validate({ params: idParamsSchema }), controller.detail);
  // B4 取消（仅 CONFIRMED → CANCELLED，原地保留历史）
  router.post(
    '/:id/cancel',
    ...authenticated,
    validate({ params: idParamsSchema, body: cancelBookingSchema }),
    controller.cancel,
  );
  // B5 标记未到（仅 CONFIRMED 且入住日 ≤ 今日）
  router.post(
    '/:id/no-show',
    ...authenticated,
    validate({ params: idParamsSchema }),
    controller.noShow,
  );

  return router;
}

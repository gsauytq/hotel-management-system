import { Router, type RequestHandler } from 'express';
import { z } from 'zod';

import {
  STAY_STATUSES,
  checkInBookingSchema,
  checkoutStaySchema,
  createStaySchema,
} from '@hms/shared';

import { paginationQueryShape, sortQuerySchema } from '../../shared/http/pagination.js';
import { requireAuth } from '../../shared/middleware/requireAuth.js';
import { validate } from '../../shared/middleware/validate.js';
import { createStaysController } from './stays.controller.js';
import type { StaysService } from './stays.service.js';

export interface StaysRouterDependencies {
  staysService: StaysService;
  sessionMiddleware: RequestHandler;
}

const idParamsSchema = z.object({
  id: z.coerce.number().int('资源 id 必须为整数').min(1, '资源 id 无效'),
});

const listStaysQuerySchema = z.object({
  ...paginationQueryShape(),
  status: z.enum(STAY_STATUSES).optional(),
  roomId: z.coerce.number().int('房间 id 必须为整数').min(1, '房间 id 无效').optional(),
  keyword: z.string().trim().min(1, '关键字不能为空').max(50, '关键字过长').optional(),
  sort: sortQuerySchema(['checkInAt', 'expectedCheckOutDate', 'status']),
});

/** S1–S4：入住与退房（挂载于 /api/v1/stays） */
export function createStaysRouter(deps: StaysRouterDependencies): Router {
  const controller = createStaysController({ service: deps.staysService });
  const router = Router();
  const authenticated = [deps.sessionMiddleware, requireAuth] as const;

  // S2 列表
  router.get('/', ...authenticated, validate({ query: listStaysQuerySchema }), controller.list);
  // S1 无预订入住（walk-in）
  router.post('/', ...authenticated, validate({ body: createStaySchema }), controller.walkIn);
  // S3 详情（含实时费用与订单摘要）
  router.get('/:id', ...authenticated, validate({ params: idParamsSchema }), controller.detail);
  // S4 退房结算（事务：账单 + 房态 + 释放占用）
  router.post(
    '/:id/checkout',
    ...authenticated,
    validate({ params: idParamsSchema, body: checkoutStaySchema }),
    controller.checkout,
  );

  return router;
}

/** B6：预订办理入住（挂载于 /api/v1/bookings，路由路径属于预订域） */
export function createBookingCheckInRouter(deps: StaysRouterDependencies): Router {
  const controller = createStaysController({ service: deps.staysService });
  const router = Router();

  router.post(
    '/:id/check-in',
    deps.sessionMiddleware,
    requireAuth,
    validate({ params: idParamsSchema, body: checkInBookingSchema }),
    controller.checkInBooking,
  );

  return router;
}

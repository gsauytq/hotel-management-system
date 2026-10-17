import { Router, type RequestHandler } from 'express';
import { z } from 'zod';

import { ORDER_SORT_FIELDS, dateOnlySchema } from '@hms/shared';

import { paginationQueryShape, sortQuerySchema } from '../../shared/http/pagination.js';
import { requireAuth } from '../../shared/middleware/requireAuth.js';
import { validate } from '../../shared/middleware/validate.js';
import { createOrdersController } from './orders.controller.js';
import type { OrdersService } from './orders.service.js';

export interface OrdersRouterDependencies {
  ordersService: OrdersService;
  sessionMiddleware: RequestHandler;
}

const idParamsSchema = z.object({
  id: z.coerce.number().int('资源 id 必须为整数').min(1, '资源 id 无效'),
});

const listOrdersQuerySchema = z.object({
  ...paginationQueryShape(),
  stayId: z.coerce.number().int('入住记录 id 必须为整数').min(1, '入住记录 id 无效').optional(),
  createdFrom: dateOnlySchema.optional(),
  createdTo: dateOnlySchema.optional(),
  sort: sortQuerySchema(ORDER_SORT_FIELDS),
});

/** O1/O2：账单查询（只读；订单由 S4 退房事务生成，本模块不提供创建入口） */
export function createOrdersRouter(deps: OrdersRouterDependencies): Router {
  const controller = createOrdersController({ service: deps.ordersService });
  const router = Router();
  const authenticated = [deps.sessionMiddleware, requireAuth] as const;

  router.get('/', ...authenticated, validate({ query: listOrdersQuerySchema }), controller.list);
  router.get('/:id', ...authenticated, validate({ params: idParamsSchema }), controller.detail);

  return router;
}

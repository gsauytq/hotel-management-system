import { Router, type RequestHandler } from 'express';
import { z } from 'zod';

import { ROOM_TYPE_STATUSES, createRoomTypeSchema, updateRoomTypeSchema } from '@hms/shared';

import { requireAuth } from '../../shared/middleware/requireAuth.js';
import { requireRole } from '../../shared/middleware/requireRole.js';
import { validate } from '../../shared/middleware/validate.js';
import { createRoomTypesController } from './room-types.controller.js';
import type { RoomTypesService } from './room-types.service.js';

export interface RoomTypesRouterDependencies {
  roomTypesService: RoomTypesService;
  sessionMiddleware: RequestHandler;
}

const idParamsSchema = z.object({
  id: z.coerce.number().int('资源 id 必须为整数').min(1, '资源 id 无效'),
});

const listQuerySchema = z.object({
  status: z.enum(ROOM_TYPE_STATUSES).optional(),
});

export function createRoomTypesRouter(deps: RoomTypesRouterDependencies): Router {
  const controller = createRoomTypesController({ service: deps.roomTypesService });
  const router = Router();
  const authenticated = [deps.sessionMiddleware, requireAuth] as const;
  const adminOnly = [deps.sessionMiddleware, requireAuth, requireRole('ADMIN')] as const;

  // R1 房型列表（登录可见；契约约定不设分页与排序参数）
  router.get('/', ...authenticated, validate({ query: listQuerySchema }), controller.list);
  // 详情（增量端点：契约补充，需评审追认）
  router.get('/:id', ...authenticated, validate({ params: idParamsSchema }), controller.detail);
  // R2 创建（仅 ADMIN）
  router.post('/', ...adminOnly, validate({ body: createRoomTypeSchema }), controller.create);
  // R3 修改（仅 ADMIN；code 不可修改，api-contract R3）
  router.patch(
    '/:id',
    ...adminOnly,
    validate({ params: idParamsSchema, body: updateRoomTypeSchema }),
    controller.update,
  );
  // R4 归档（仅 ADMIN；存在 CONFIRMED 预订或 CHECKED_IN 在住时 409）
  router.post(
    '/:id/archive',
    ...adminOnly,
    validate({ params: idParamsSchema }),
    controller.archive,
  );

  return router;
}

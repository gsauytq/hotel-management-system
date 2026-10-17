import { Router, type RequestHandler } from 'express';
import { z } from 'zod';

import {
  ROOM_STATUSES,
  availableRoomsQuerySchema,
  createRoomSchema,
  updateRoomSchema,
  updateRoomStatusSchema,
} from '@hms/shared';

import { paginationQueryShape, sortQuerySchema } from '../../shared/http/pagination.js';
import { requireAuth } from '../../shared/middleware/requireAuth.js';
import { requireRole } from '../../shared/middleware/requireRole.js';
import { validate } from '../../shared/middleware/validate.js';
import { createRoomsController } from './rooms.controller.js';
import type { RoomsService } from './rooms.service.js';

export interface RoomsRouterDependencies {
  roomsService: RoomsService;
  sessionMiddleware: RequestHandler;
}

const idParamsSchema = z.object({
  id: z.coerce.number().int('资源 id 必须为整数').min(1, '资源 id 无效'),
});

const listRoomsQuerySchema = z.object({
  ...paginationQueryShape(),
  status: z.enum(ROOM_STATUSES).optional(),
  roomTypeId: z.coerce.number().int('房型 id 必须为整数').min(1, '房型 id 无效').optional(),
  // 增量参数（契约补充，需评审追认）：按房号前缀筛选
  roomNumber: z.string().trim().min(1, '房号不能为空').max(20, '房号不得超过 20 个字符').optional(),
  sort: sortQuerySchema(['roomNumber', 'status', 'createdAt']),
});

export function createRoomsRouter(deps: RoomsRouterDependencies): Router {
  const controller = createRoomsController({ service: deps.roomsService });
  const router = Router();
  const authenticated = [deps.sessionMiddleware, requireAuth] as const;
  const adminOnly = [deps.sessionMiddleware, requireAuth, requireRole('ADMIN')] as const;

  // M1 客房列表/房态看板（登录可见；分页 + 排序白名单）
  router.get('/', ...authenticated, validate({ query: listRoomsQuerySchema }), controller.list);
  // M2 可分配房间（登录可见；注意必须先于 /:id 注册）
  router.get(
    '/available',
    ...authenticated,
    validate({ query: availableRoomsQuerySchema }),
    controller.listAvailable,
  );
  // 详情（增量端点：契约补充，需评审追认）
  router.get('/:id', ...authenticated, validate({ params: idParamsSchema }), controller.detail);
  // M3 创建（仅 ADMIN）
  router.post('/', ...adminOnly, validate({ body: createRoomSchema }), controller.create);
  // M4 修改（仅 ADMIN；OCCUPIED 仅可改 note）
  router.patch(
    '/:id',
    ...adminOnly,
    validate({ params: idParamsSchema, body: updateRoomSchema }),
    controller.update,
  );
  // M5 房态变更（登录可见；进入/退出维修、停用由服务层校验 ADMIN）
  router.patch(
    '/:id/status',
    ...authenticated,
    validate({ params: idParamsSchema, body: updateRoomStatusSchema }),
    controller.updateStatus,
  );

  return router;
}

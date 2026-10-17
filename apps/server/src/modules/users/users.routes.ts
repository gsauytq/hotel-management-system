import { Router, type RequestHandler } from 'express';
import { z } from 'zod';

import {
  ROLES,
  USER_SORT_FIELDS,
  USER_STATUSES,
  createUserSchema,
  resetPasswordSchema,
  updateUserSchema,
} from '@hms/shared';

import { paginationQueryShape, sortQuerySchema } from '../../shared/http/pagination.js';
import { requireRole } from '../../shared/middleware/requireRole.js';
import { validate } from '../../shared/middleware/validate.js';
import { createUsersController } from './users.controller.js';
import type { UsersService } from './users.service.js';

export interface UsersRouterDependencies {
  usersService: UsersService;
  sessionMiddleware: RequestHandler;
}

const idParamsSchema = z.object({
  id: z.coerce.number().int('资源 id 必须为整数').min(1, '资源 id 无效'),
});

const listUsersQuerySchema = z.object({
  ...paginationQueryShape(),
  role: z.enum(ROLES).optional(),
  status: z.enum(USER_STATUSES).optional(),
  keyword: z.string().trim().min(1, '关键字不能为空').max(50, '关键字过长').optional(),
  sort: sortQuerySchema(USER_SORT_FIELDS),
});

/** 员工管理（U1–U4，全部仅 ADMIN；默认拒绝） */
export function createUsersRouter(deps: UsersRouterDependencies): Router {
  const controller = createUsersController({ service: deps.usersService });
  const router = Router();
  const adminOnly = [deps.sessionMiddleware, requireRole('ADMIN')] as const;

  // U1 列表
  router.get('/', ...adminOnly, validate({ query: listUsersQuerySchema }), controller.list);
  // 详情（★ 实施期契约增量，需评审追认）
  router.get('/:id', ...adminOnly, validate({ params: idParamsSchema }), controller.detail);
  // U2 创建
  router.post('/', ...adminOnly, validate({ body: createUserSchema }), controller.create);
  // U3 修改/启停（不可停用自己）
  router.patch(
    '/:id',
    ...adminOnly,
    validate({ params: idParamsSchema, body: updateUserSchema }),
    controller.update,
  );
  // U4 重置密码（重置后全部会话失效）
  router.patch(
    '/:id/password',
    ...adminOnly,
    validate({ params: idParamsSchema, body: resetPasswordSchema }),
    controller.resetPassword,
  );

  return router;
}

import { Router, type RequestHandler } from 'express';
import { z } from 'zod';

import { GUEST_SORT_FIELDS, createGuestSchema, updateGuestSchema } from '@hms/shared';

import { paginationQueryShape, sortQuerySchema } from '../../shared/http/pagination.js';
import { requireAuth } from '../../shared/middleware/requireAuth.js';
import { validate } from '../../shared/middleware/validate.js';
import { createGuestsController } from './guests.controller.js';
import type { GuestsService } from './guests.service.js';

export interface GuestsRouterDependencies {
  guestsService: GuestsService;
  sessionMiddleware: RequestHandler;
}

const idParamsSchema = z.object({
  id: z.coerce.number().int('资源 id 必须为整数').min(1, '资源 id 无效'),
});

const listGuestsQuerySchema = z.object({
  ...paginationQueryShape(),
  keyword: z.string().trim().min(1, '关键字不能为空').max(50, '关键字过长').optional(),
  // G1 的 phone 为前缀过滤（示例 phone=138），不是完整手机号
  phone: z.string().trim().min(1, '手机号前缀不能为空').max(20, '手机号前缀过长').optional(),
  sort: sortQuerySchema(GUEST_SORT_FIELDS),
});

/** 客人档案（G1–G4，登录角色均可） */
export function createGuestsRouter(deps: GuestsRouterDependencies): Router {
  const controller = createGuestsController({ service: deps.guestsService });
  const router = Router();
  const authenticated = [deps.sessionMiddleware, requireAuth] as const;

  // G1 列表（证件号恒掩码）
  router.get('/', ...authenticated, validate({ query: listGuestsQuerySchema }), controller.list);
  // G2 创建（证件查重 + 加密存储）
  router.post('/', ...authenticated, validate({ body: createGuestSchema }), controller.create);
  // G3 详情（含最近 10 条预订摘要）
  router.get('/:id', ...authenticated, validate({ params: idParamsSchema }), controller.detail);
  // G4 更新（证件号不可改 → 409）
  router.patch(
    '/:id',
    ...authenticated,
    validate({ params: idParamsSchema, body: updateGuestSchema }),
    controller.update,
  );

  return router;
}

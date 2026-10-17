import type { Request, Response } from 'express';

import {
  USER_SORT_FIELDS,
  type ApiSuccessEnvelope,
  type CreateUserRequest,
  type OkResult,
  type Paginated,
  type ResetPasswordRequest,
  type Role,
  type UpdateUserRequest,
  type UserListItemDto,
  type UserStatus,
} from '@hms/shared';

import { ApiError } from '../../shared/http/ApiError.js';
import { parseSortRules, toPrismaOrderBy } from '../../shared/http/pagination.js';
import type { UsersService } from './users.service.js';

export interface UsersControllerDependencies {
  service: UsersService;
}

export interface UsersController {
  list: (req: Request, res: Response) => Promise<void>;
  detail: (req: Request, res: Response) => Promise<void>;
  create: (req: Request, res: Response) => Promise<void>;
  update: (req: Request, res: Response) => Promise<void>;
  resetPassword: (req: Request, res: Response) => Promise<void>;
}

export function createUsersController(deps: UsersControllerDependencies): UsersController {
  function context(req: Request) {
    const { user } = req;
    // requireRole('ADMIN') 已保证
    if (user === undefined) {
      throw ApiError.unauthorized();
    }
    return { actorId: user.id, requestId: req.requestId, ip: req.ip };
  }

  return {
    async list(req, res) {
      const query = req.query as unknown as {
        role?: Role;
        status?: UserStatus;
        keyword?: string;
        page: number;
        pageSize: number;
        sort?: string;
      };
      const orderBy = toPrismaOrderBy(
        parseSortRules(query.sort, USER_SORT_FIELDS, [{ field: 'createdAt', direction: 'desc' }]),
      );
      const result = await deps.service.list({
        role: query.role,
        status: query.status,
        keyword: query.keyword,
        page: query.page,
        pageSize: query.pageSize,
        orderBy,
      });
      const payload: ApiSuccessEnvelope<Paginated<UserListItemDto>> = { data: result };
      res.status(200).json(payload);
    },

    async detail(req, res) {
      const item = await deps.service.getById(Number(req.params['id']));
      const payload: ApiSuccessEnvelope<UserListItemDto> = { data: item };
      res.status(200).json(payload);
    },

    async create(req, res) {
      const input = req.body as CreateUserRequest;
      const item = await deps.service.create(input, context(req));
      const payload: ApiSuccessEnvelope<UserListItemDto> = { data: item };
      res.status(200).json(payload);
    },

    async update(req, res) {
      const input = req.body as UpdateUserRequest;
      const item = await deps.service.update(Number(req.params['id']), input, context(req));
      const payload: ApiSuccessEnvelope<UserListItemDto> = { data: item };
      res.status(200).json(payload);
    },

    async resetPassword(req, res) {
      const input = req.body as ResetPasswordRequest;
      await deps.service.resetPassword(Number(req.params['id']), input, context(req));
      const payload: ApiSuccessEnvelope<OkResult> = { data: { ok: true } };
      res.status(200).json(payload);
    },
  };
}

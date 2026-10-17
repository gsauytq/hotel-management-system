import type { Request, Response } from 'express';

import {
  GUEST_SORT_FIELDS,
  type ApiSuccessEnvelope,
  type CreateGuestRequest,
  type GuestDetailDto,
  type GuestDto,
  type Paginated,
  type UpdateGuestRequest,
} from '@hms/shared';

import { parseSortRules, toPrismaOrderBy } from '../../shared/http/pagination.js';
import type { GuestsService } from './guests.service.js';

export interface GuestsControllerDependencies {
  service: GuestsService;
}

export interface GuestsController {
  list: (req: Request, res: Response) => Promise<void>;
  detail: (req: Request, res: Response) => Promise<void>;
  create: (req: Request, res: Response) => Promise<void>;
  update: (req: Request, res: Response) => Promise<void>;
}

export function createGuestsController(deps: GuestsControllerDependencies): GuestsController {
  return {
    async list(req, res) {
      const query = req.query as unknown as {
        keyword?: string;
        phone?: string;
        page: number;
        pageSize: number;
        sort?: string;
      };
      const orderBy = toPrismaOrderBy(
        parseSortRules(query.sort, GUEST_SORT_FIELDS, [{ field: 'createdAt', direction: 'desc' }]),
      );
      const result = await deps.service.list({
        keyword: query.keyword,
        phone: query.phone,
        page: query.page,
        pageSize: query.pageSize,
        orderBy,
      });
      const payload: ApiSuccessEnvelope<Paginated<GuestDto>> = { data: result };
      res.status(200).json(payload);
    },

    async detail(req, res) {
      const item = await deps.service.getById(Number(req.params['id']));
      const payload: ApiSuccessEnvelope<GuestDetailDto> = { data: item };
      res.status(200).json(payload);
    },

    async create(req, res) {
      const input = req.body as CreateGuestRequest;
      const item = await deps.service.create(input);
      const payload: ApiSuccessEnvelope<GuestDto> = { data: item };
      res.status(200).json(payload);
    },

    async update(req, res) {
      const input = req.body as UpdateGuestRequest;
      const item = await deps.service.update(Number(req.params['id']), input);
      const payload: ApiSuccessEnvelope<GuestDto> = { data: item };
      res.status(200).json(payload);
    },
  };
}

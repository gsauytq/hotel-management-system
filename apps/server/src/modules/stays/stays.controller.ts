import type { Request, Response } from 'express';

import {
  STAY_SORT_FIELDS,
  type ApiSuccessEnvelope,
  type CheckInBookingRequest,
  type CheckoutStayRequest,
  type CreateStayRequest,
  type OrderDto,
  type Paginated,
  type StayDetailDto,
  type StayDto,
  type StayStatus,
} from '@hms/shared';

import { ApiError } from '../../shared/http/ApiError.js';
import { parseSortRules, toPrismaOrderBy } from '../../shared/http/pagination.js';
import type { StaysService } from './stays.service.js';

export interface StaysControllerDependencies {
  service: StaysService;
}

export interface StaysController {
  list: (req: Request, res: Response) => Promise<void>;
  walkIn: (req: Request, res: Response) => Promise<void>;
  detail: (req: Request, res: Response) => Promise<void>;
  checkout: (req: Request, res: Response) => Promise<void>;
  checkInBooking: (req: Request, res: Response) => Promise<void>;
}

export function createStaysController(deps: StaysControllerDependencies): StaysController {
  function actorId(req: Request): number {
    const { user } = req;
    // requireAuth 已保证
    if (user === undefined) {
      throw ApiError.unauthorized();
    }
    return user.id;
  }

  return {
    async list(req, res) {
      const query = req.query as unknown as {
        status?: StayStatus;
        roomId?: number;
        keyword?: string;
        page: number;
        pageSize: number;
        sort?: string;
      };
      const orderBy = toPrismaOrderBy(
        parseSortRules(query.sort, STAY_SORT_FIELDS, [{ field: 'checkInAt', direction: 'desc' }]),
      );
      const result = await deps.service.list({
        status: query.status,
        roomId: query.roomId,
        keyword: query.keyword,
        page: query.page,
        pageSize: query.pageSize,
        orderBy,
      });
      const payload: ApiSuccessEnvelope<Paginated<StayDto>> = { data: result };
      res.status(200).json(payload);
    },

    async walkIn(req, res) {
      const input = req.body as CreateStayRequest;
      const item = await deps.service.createWalkIn(input, actorId(req));
      const payload: ApiSuccessEnvelope<StayDto> = { data: item };
      res.status(200).json(payload);
    },

    async detail(req, res) {
      const item = await deps.service.getById(Number(req.params['id']));
      const payload: ApiSuccessEnvelope<StayDetailDto> = { data: item };
      res.status(200).json(payload);
    },

    async checkout(req, res) {
      const input = req.body as CheckoutStayRequest;
      const item = await deps.service.checkout(Number(req.params['id']), input, {
        actorId: actorId(req),
        requestId: req.requestId,
        ip: req.ip,
      });
      const payload: ApiSuccessEnvelope<OrderDto> = { data: item };
      res.status(200).json(payload);
    },

    async checkInBooking(req, res) {
      const input = req.body as CheckInBookingRequest;
      const item = await deps.service.checkInBooking(Number(req.params['id']), input, actorId(req));
      const payload: ApiSuccessEnvelope<StayDto> = { data: item };
      res.status(200).json(payload);
    },
  };
}

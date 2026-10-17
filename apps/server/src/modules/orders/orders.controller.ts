import type { Request, Response } from 'express';

import {
  ORDER_SORT_FIELDS,
  type ApiSuccessEnvelope,
  type OrderDto,
  type OrderSummaryDto,
  type Paginated,
} from '@hms/shared';

import { parseSortRules, toPrismaOrderBy } from '../../shared/http/pagination.js';
import type { OrdersService } from './orders.service.js';

export interface OrdersControllerDependencies {
  service: OrdersService;
}

export interface OrdersController {
  list: (req: Request, res: Response) => Promise<void>;
  detail: (req: Request, res: Response) => Promise<void>;
}

export function createOrdersController(deps: OrdersControllerDependencies): OrdersController {
  return {
    async list(req, res) {
      const query = req.query as unknown as {
        stayId?: number;
        createdFrom?: string;
        createdTo?: string;
        page: number;
        pageSize: number;
        sort?: string;
      };
      const orderBy = toPrismaOrderBy(
        parseSortRules(query.sort, ORDER_SORT_FIELDS, [{ field: 'createdAt', direction: 'desc' }]),
      );
      const result = await deps.service.list({
        stayId: query.stayId,
        createdFrom: query.createdFrom,
        createdTo: query.createdTo,
        page: query.page,
        pageSize: query.pageSize,
        orderBy,
      });
      const payload: ApiSuccessEnvelope<Paginated<OrderSummaryDto>> = { data: result };
      res.status(200).json(payload);
    },

    async detail(req, res) {
      const item = await deps.service.getById(Number(req.params['id']));
      const payload: ApiSuccessEnvelope<OrderDto> = { data: item };
      res.status(200).json(payload);
    },
  };
}

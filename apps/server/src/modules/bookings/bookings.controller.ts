import type { Request, Response } from 'express';

import {
  BOOKING_SORT_FIELDS,
  type ApiSuccessEnvelope,
  type BookingDetailDto,
  type BookingDto,
  type BookingStatus,
  type CancelBookingRequest,
  type CreateBookingRequest,
  type Paginated,
} from '@hms/shared';

import { ApiError } from '../../shared/http/ApiError.js';
import { parseSortRules, toPrismaOrderBy } from '../../shared/http/pagination.js';
import type { BookingsService } from './bookings.service.js';

export interface BookingsControllerDependencies {
  service: BookingsService;
}

export interface BookingsController {
  list: (req: Request, res: Response) => Promise<void>;
  detail: (req: Request, res: Response) => Promise<void>;
  create: (req: Request, res: Response) => Promise<void>;
  cancel: (req: Request, res: Response) => Promise<void>;
  noShow: (req: Request, res: Response) => Promise<void>;
}

export function createBookingsController(deps: BookingsControllerDependencies): BookingsController {
  return {
    async list(req, res) {
      const query = req.query as unknown as {
        status?: BookingStatus;
        guestId?: number;
        checkInDateFrom?: string;
        checkInDateTo?: string;
        checkOutDateFrom?: string;
        checkOutDateTo?: string;
        keyword?: string;
        page: number;
        pageSize: number;
        sort?: string;
      };
      const orderBy = toPrismaOrderBy(
        parseSortRules(query.sort, BOOKING_SORT_FIELDS, [
          { field: 'createdAt', direction: 'desc' },
        ]),
      );
      const result = await deps.service.list({
        status: query.status,
        guestId: query.guestId,
        checkInDateFrom: query.checkInDateFrom,
        checkInDateTo: query.checkInDateTo,
        checkOutDateFrom: query.checkOutDateFrom,
        checkOutDateTo: query.checkOutDateTo,
        keyword: query.keyword,
        page: query.page,
        pageSize: query.pageSize,
        orderBy,
      });
      const payload: ApiSuccessEnvelope<Paginated<BookingDto>> = { data: result };
      res.status(200).json(payload);
    },

    async detail(req, res) {
      const item = await deps.service.getById(Number(req.params['id']));
      const payload: ApiSuccessEnvelope<BookingDetailDto> = { data: item };
      res.status(200).json(payload);
    },

    async create(req, res) {
      const { user } = req;
      // requireAuth 已保证
      if (user === undefined) {
        throw ApiError.unauthorized();
      }
      const input = req.body as CreateBookingRequest;
      const item = await deps.service.create(input, user.id);
      const payload: ApiSuccessEnvelope<BookingDto> = { data: item };
      res.status(200).json(payload);
    },

    async cancel(req, res) {
      const input = req.body as CancelBookingRequest;
      const item = await deps.service.cancel(Number(req.params['id']), input);
      const payload: ApiSuccessEnvelope<BookingDetailDto> = { data: item };
      res.status(200).json(payload);
    },

    async noShow(req, res) {
      const item = await deps.service.markNoShow(Number(req.params['id']));
      const payload: ApiSuccessEnvelope<BookingDetailDto> = { data: item };
      res.status(200).json(payload);
    },
  };
}

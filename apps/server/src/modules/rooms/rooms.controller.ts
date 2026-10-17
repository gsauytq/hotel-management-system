import type { Request, Response } from 'express';

import {
  ROOM_SORT_FIELDS,
  type ApiSuccessEnvelope,
  type AvailableRoomDto,
  type AvailableRoomsQuery,
  type CreateRoomRequest,
  type Paginated,
  type RoomDto,
  type RoomStatus,
  type UpdateRoomRequest,
  type UpdateRoomStatusRequest,
} from '@hms/shared';

import { ApiError } from '../../shared/http/ApiError.js';
import { parseSortRules, toPrismaOrderBy } from '../../shared/http/pagination.js';
import type { RoomsService } from './rooms.service.js';

export interface RoomsControllerDependencies {
  service: RoomsService;
}

export interface RoomsController {
  list: (req: Request, res: Response) => Promise<void>;
  detail: (req: Request, res: Response) => Promise<void>;
  listAvailable: (req: Request, res: Response) => Promise<void>;
  create: (req: Request, res: Response) => Promise<void>;
  update: (req: Request, res: Response) => Promise<void>;
  updateStatus: (req: Request, res: Response) => Promise<void>;
}

export function createRoomsController(deps: RoomsControllerDependencies): RoomsController {
  return {
    async list(req, res) {
      const query = req.query as unknown as {
        status?: RoomStatus;
        roomTypeId?: number;
        roomNumber?: string;
        page: number;
        pageSize: number;
        sort?: string;
      };
      const orderBy = toPrismaOrderBy(
        parseSortRules(query.sort, ROOM_SORT_FIELDS, [{ field: 'roomNumber', direction: 'asc' }]),
      );
      const result = await deps.service.list({
        status: query.status,
        roomTypeId: query.roomTypeId,
        roomNumber: query.roomNumber,
        page: query.page,
        pageSize: query.pageSize,
        orderBy,
      });
      const payload: ApiSuccessEnvelope<Paginated<RoomDto>> = { data: result };
      res.status(200).json(payload);
    },

    async detail(req, res) {
      const item = await deps.service.getById(Number(req.params['id']));
      const payload: ApiSuccessEnvelope<RoomDto> = { data: item };
      res.status(200).json(payload);
    },

    async listAvailable(req, res) {
      const query = req.query as unknown as AvailableRoomsQuery;
      const items = await deps.service.listAvailable(query);
      const payload: ApiSuccessEnvelope<{ items: AvailableRoomDto[] }> = { data: { items } };
      res.status(200).json(payload);
    },

    async create(req, res) {
      const input = req.body as CreateRoomRequest;
      const item = await deps.service.create(input);
      const payload: ApiSuccessEnvelope<RoomDto> = { data: item };
      res.status(200).json(payload);
    },

    async update(req, res) {
      const input = req.body as UpdateRoomRequest;
      const item = await deps.service.update(Number(req.params['id']), input);
      const payload: ApiSuccessEnvelope<RoomDto> = { data: item };
      res.status(200).json(payload);
    },

    async updateStatus(req, res) {
      const { user } = req;
      // requireAuth 已保证
      if (user === undefined) {
        throw ApiError.unauthorized();
      }
      const input = req.body as UpdateRoomStatusRequest;
      const item = await deps.service.updateStatus(Number(req.params['id']), input, user.role);
      const payload: ApiSuccessEnvelope<RoomDto> = { data: item };
      res.status(200).json(payload);
    },
  };
}

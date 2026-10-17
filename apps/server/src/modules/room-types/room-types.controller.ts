import type { Request, Response } from 'express';

import type {
  ApiSuccessEnvelope,
  CreateRoomTypeRequest,
  RoomTypeDto,
  RoomTypeStatus,
  UpdateRoomTypeRequest,
} from '@hms/shared';

import type { RoomTypesService } from './room-types.service.js';

export interface RoomTypesControllerDependencies {
  service: RoomTypesService;
}

export interface RoomTypesController {
  list: (req: Request, res: Response) => Promise<void>;
  detail: (req: Request, res: Response) => Promise<void>;
  create: (req: Request, res: Response) => Promise<void>;
  update: (req: Request, res: Response) => Promise<void>;
  archive: (req: Request, res: Response) => Promise<void>;
}

export function createRoomTypesController(
  deps: RoomTypesControllerDependencies,
): RoomTypesController {
  return {
    async list(req, res) {
      const status = req.query['status'] as RoomTypeStatus | undefined;
      const items = await deps.service.list(status === undefined ? {} : { status });
      const payload: ApiSuccessEnvelope<{ items: RoomTypeDto[] }> = { data: { items } };
      res.status(200).json(payload);
    },

    async detail(req, res) {
      const item = await deps.service.getById(Number(req.params['id']));
      const payload: ApiSuccessEnvelope<RoomTypeDto> = { data: item };
      res.status(200).json(payload);
    },

    async create(req, res) {
      const input = req.body as CreateRoomTypeRequest;
      const item = await deps.service.create(input);
      const payload: ApiSuccessEnvelope<RoomTypeDto> = { data: item };
      res.status(200).json(payload);
    },

    async update(req, res) {
      const input = req.body as UpdateRoomTypeRequest;
      const item = await deps.service.update(Number(req.params['id']), input);
      const payload: ApiSuccessEnvelope<RoomTypeDto> = { data: item };
      res.status(200).json(payload);
    },

    async archive(req, res) {
      const item = await deps.service.archive(Number(req.params['id']));
      const payload: ApiSuccessEnvelope<RoomTypeDto> = { data: item };
      res.status(200).json(payload);
    },
  };
}

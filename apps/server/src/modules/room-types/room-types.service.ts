import type {
  CreateRoomTypeRequest,
  RoomTypeDto,
  RoomTypeStatus,
  UpdateRoomTypeRequest,
} from '@hms/shared';

import { ApiError } from '../../shared/http/ApiError.js';
import { isUniqueConstraintError } from '../../shared/http/prisma-errors.js';
import type { RoomTypeRecord, RoomTypesRepository } from './room-types.repository.js';

export interface RoomTypesService {
  list(filter: { status?: RoomTypeStatus }): Promise<RoomTypeDto[]>;
  getById(id: number): Promise<RoomTypeDto>;
  create(input: CreateRoomTypeRequest): Promise<RoomTypeDto>;
  update(id: number, input: UpdateRoomTypeRequest): Promise<RoomTypeDto>;
  archive(id: number): Promise<RoomTypeDto>;
}

export interface RoomTypesServiceDependencies {
  repository: RoomTypesRepository;
}

function toRoomTypeDto(record: RoomTypeRecord): RoomTypeDto {
  return {
    id: record.id,
    code: record.code,
    name: record.name,
    basePrice: record.basePrice,
    capacity: record.capacity,
    description: record.description,
    status: record.status,
    roomCount: record.roomCount,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}

export function createRoomTypesService(deps: RoomTypesServiceDependencies): RoomTypesService {
  const { repository } = deps;

  return {
    async list(filter) {
      const roomTypes = await repository.list(filter);
      return roomTypes.map(toRoomTypeDto);
    },

    async getById(id) {
      const roomType = await repository.findById(id);
      if (roomType === null) {
        throw ApiError.notFound('房型不存在');
      }
      return toRoomTypeDto(roomType);
    },

    async create(input) {
      try {
        const roomType = await repository.create(input);
        return toRoomTypeDto(roomType);
      } catch (error) {
        // 唯一约束（uq_room_types_code）由数据库兜底，翻译为业务错误码（防并发竞态）
        if (isUniqueConstraintError(error)) {
          throw ApiError.conflict('ROOM_TYPE_CODE_EXISTS', '房型代码已存在');
        }
        throw error;
      }
    },

    async update(id, input) {
      const roomType = await repository.update(id, input);
      if (roomType === null) {
        throw ApiError.notFound('房型不存在');
      }
      return toRoomTypeDto(roomType);
    },

    async archive(id) {
      const result = await repository.archive(id);
      switch (result.outcome) {
        case 'archived':
          return toRoomTypeDto(result.roomType);
        case 'not_found':
          throw ApiError.notFound('房型不存在');
        case 'already_archived':
          throw ApiError.conflict('ROOM_TYPE_ARCHIVED', '房型已归档');
        case 'referenced':
          throw ApiError.conflict('ROOM_TYPE_ARCHIVED', '该房型存在未完结预订或在住，不可归档');
      }
    },
  };
}

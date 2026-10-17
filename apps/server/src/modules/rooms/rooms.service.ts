import type {
  AvailableRoomDto,
  AvailableRoomsQuery,
  CreateRoomRequest,
  Paginated,
  Role,
  RoomDto,
  RoomStatus,
  UpdateRoomRequest,
  UpdateRoomStatusRequest,
} from '@hms/shared';
import { ADMIN_ONLY_ROOM_STATUSES, ROOM_STATUS_MANUAL_TRANSITIONS } from '@hms/shared';

import { ApiError } from '../../shared/http/ApiError.js';
import { buildPagination } from '../../shared/http/pagination.js';
import { isUniqueConstraintError } from '../../shared/http/prisma-errors.js';
import { formatDateOnly } from '../../utils/hotel-date.js';
import type { RoomTypesService } from '../room-types/room-types.service.js';
import type { RoomRecord, RoomsRepository } from './rooms.repository.js';

export interface RoomListQuery {
  status?: RoomStatus;
  roomTypeId?: number;
  roomNumber?: string;
  page: number;
  pageSize: number;
  orderBy: Array<Record<string, 'asc' | 'desc'>>;
}

export interface RoomsService {
  list(query: RoomListQuery): Promise<Paginated<RoomDto>>;
  getById(id: number): Promise<RoomDto>;
  create(input: CreateRoomRequest): Promise<RoomDto>;
  update(id: number, input: UpdateRoomRequest): Promise<RoomDto>;
  updateStatus(id: number, input: UpdateRoomStatusRequest, actorRole: Role): Promise<RoomDto>;
  listAvailable(query: AvailableRoomsQuery): Promise<AvailableRoomDto[]>;
}

export interface RoomsServiceDependencies {
  repository: RoomsRepository;
  /** 模块依赖：rooms → room-types 仅经服务层接口（architecture §1.3） */
  roomTypesService: RoomTypesService;
}

function toRoomDto(record: RoomRecord): RoomDto {
  return {
    id: record.id,
    roomNumber: record.roomNumber,
    roomTypeId: record.roomTypeId,
    roomTypeName: record.roomTypeName,
    status: record.status,
    note: record.note,
    currentStay:
      record.currentStay === null
        ? null
        : {
            stayId: record.currentStay.stayId,
            guestName: record.currentStay.guestName,
            checkInAt: record.currentStay.checkInAt.toISOString(),
            expectedCheckOutDate: formatDateOnly(record.currentStay.expectedCheckOutDate),
          },
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}

export function createRoomsService(deps: RoomsServiceDependencies): RoomsService {
  const { repository, roomTypesService } = deps;

  return {
    async list(query) {
      const { items, total } = await repository.list({
        ...(query.status === undefined ? {} : { status: query.status }),
        ...(query.roomTypeId === undefined ? {} : { roomTypeId: query.roomTypeId }),
        ...(query.roomNumber === undefined ? {} : { roomNumberPrefix: query.roomNumber }),
        page: query.page,
        pageSize: query.pageSize,
        orderBy: query.orderBy,
      });
      return {
        items: items.map(toRoomDto),
        pagination: buildPagination(query.page, query.pageSize, total),
      };
    },

    async getById(id) {
      const room = await repository.findById(id);
      if (room === null) {
        throw ApiError.notFound('房间不存在');
      }
      return toRoomDto(room);
    },

    async create(input) {
      try {
        const result = await repository.create(input);
        switch (result.outcome) {
          case 'created':
            return toRoomDto(result.room);
          case 'room_type_not_found':
            throw ApiError.notFound('房型不存在');
          case 'room_type_archived':
            throw ApiError.conflict('ROOM_TYPE_ARCHIVED', '房型已归档，不可新增房间');
        }
      } catch (error) {
        // 房号唯一约束（uq_rooms_room_number）由数据库兜底（防并发竞态）
        if (isUniqueConstraintError(error)) {
          throw ApiError.conflict('ROOM_NUMBER_EXISTS', '房号已存在');
        }
        throw error;
      }
    },

    async update(id, input) {
      if (
        input.roomNumber === undefined &&
        input.roomTypeId === undefined &&
        input.note === undefined
      ) {
        // 空 PATCH：返回当前对象（契约未要求字段至少一个）
        return this.getById(id);
      }
      try {
        const result = await repository.update(id, input);
        switch (result.outcome) {
          case 'updated':
            return toRoomDto(result.room);
          case 'not_found':
            throw ApiError.notFound('房间不存在');
          case 'occupied_restricted':
            throw ApiError.conflict('ROOM_STATUS_INVALID', '在住房间不可修改房型或房号');
          case 'room_type_not_found':
            throw ApiError.notFound('房型不存在');
          case 'room_type_archived':
            throw ApiError.conflict('ROOM_TYPE_ARCHIVED', '房型已归档，不可分配房间');
          case 'room_changed':
            throw ApiError.conflict('ROOM_STATUS_INVALID', '房间信息已变更，请刷新后重试');
        }
      } catch (error) {
        if (isUniqueConstraintError(error)) {
          throw ApiError.conflict('ROOM_NUMBER_EXISTS', '房号已存在');
        }
        throw error;
      }
    },

    async updateStatus(id, input, actorRole) {
      const room = await repository.findById(id);
      if (room === null) {
        throw ApiError.notFound('房间不存在');
      }

      const from = room.status;
      const to = input.status;
      if (!ROOM_STATUS_MANUAL_TRANSITIONS[from].includes(to)) {
        throw ApiError.conflict(
          'ROOM_STATUS_INVALID',
          `房态不允许该迁移（${from} → ${to}）；OCCUPIED 只能经入住/退房事务变更`,
        );
      }

      // 进入/退出维修、停用仅 ADMIN（architecture §1.7 权限矩阵）
      const touchesAdminOnlyStatus =
        ADMIN_ONLY_ROOM_STATUSES.includes(to) || ADMIN_ONLY_ROOM_STATUSES.includes(from);
      if (touchesAdminOnlyStatus && actorRole !== 'ADMIN') {
        throw ApiError.forbidden();
      }

      const result = await repository.updateStatus(id, room.roomTypeId, from, to);
      switch (result.outcome) {
        case 'updated':
          return toRoomDto(result.room);
        case 'not_found':
          throw ApiError.notFound('房间不存在');
        case 'conflict':
          throw ApiError.conflict('ROOM_STATUS_INVALID', '房态已被其他操作修改，请刷新后重试');
      }
    },

    async listAvailable(query) {
      // 无效房型 → 404；归档房型不可分配 → 空列表
      const roomType = await roomTypesService.getById(query.roomTypeId);
      if (roomType.status === 'ARCHIVED') {
        return [];
      }
      return repository.listAvailable({
        roomTypeId: query.roomTypeId,
        checkInDate: new Date(`${query.checkInDate}T00:00:00.000Z`),
        checkOutDate: new Date(`${query.checkOutDate}T00:00:00.000Z`),
      });
    },
  };
}

import type { RoomTypesService } from '../../src/modules/room-types/room-types.service.js';
import type { RoomsService } from '../../src/modules/rooms/rooms.service.js';
import { ApiError } from '../../src/shared/http/ApiError.js';

/** 测试用房型服务替身（默认空列表 / 404；生产由真实仓储实现） */
export function createFakeRoomTypesService(
  overrides: Partial<RoomTypesService> = {},
): RoomTypesService {
  return {
    list: async () => [],
    getById: async () => {
      throw ApiError.notFound('房型不存在');
    },
    create: async () => {
      throw new Error('fake roomTypesService.create 未提供实现');
    },
    update: async () => {
      throw new Error('fake roomTypesService.update 未提供实现');
    },
    archive: async () => {
      throw new Error('fake roomTypesService.archive 未提供实现');
    },
    ...overrides,
  };
}

/** 测试用客房服务替身（默认空分页 / 404） */
export function createFakeRoomsService(overrides: Partial<RoomsService> = {}): RoomsService {
  return {
    list: async () => ({
      items: [],
      pagination: { page: 1, pageSize: 20, total: 0, totalPages: 0 },
    }),
    getById: async () => {
      throw ApiError.notFound('房间不存在');
    },
    create: async () => {
      throw new Error('fake roomsService.create 未提供实现');
    },
    update: async () => {
      throw new Error('fake roomsService.update 未提供实现');
    },
    updateStatus: async () => {
      throw new Error('fake roomsService.updateStatus 未提供实现');
    },
    listAvailable: async () => [],
    ...overrides,
  };
}

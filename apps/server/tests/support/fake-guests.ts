import type { GuestsService } from '../../src/modules/guests/guests.service.js';
import { ApiError } from '../../src/shared/http/ApiError.js';

/** 测试用客人服务替身（默认空分页 / 404；生产由真实仓储实现） */
export function createFakeGuestsService(overrides: Partial<GuestsService> = {}): GuestsService {
  return {
    list: async () => ({
      items: [],
      pagination: { page: 1, pageSize: 20, total: 0, totalPages: 0 },
    }),
    getById: async () => {
      throw ApiError.notFound('客人档案不存在');
    },
    create: async () => {
      throw new Error('fake guestsService.create 未提供实现');
    },
    update: async () => {
      throw new Error('fake guestsService.update 未提供实现');
    },
    ...overrides,
  };
}

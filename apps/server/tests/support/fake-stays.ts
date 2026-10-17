import type { StaysService } from '../../src/modules/stays/stays.service.js';
import { ApiError } from '../../src/shared/http/ApiError.js';

/** 测试用入住服务替身（默认 404；生产由真实仓储实现） */
export function createFakeStaysService(overrides: Partial<StaysService> = {}): StaysService {
  return {
    list: async () => ({
      items: [],
      pagination: { page: 1, pageSize: 20, total: 0, totalPages: 0 },
    }),
    getById: async () => {
      throw ApiError.notFound('入住记录不存在');
    },
    checkInBooking: async () => {
      throw new Error('fake staysService.checkInBooking 未提供实现');
    },
    createWalkIn: async () => {
      throw new Error('fake staysService.createWalkIn 未提供实现');
    },
    checkout: async () => {
      throw new Error('fake staysService.checkout 未提供实现');
    },
    ...overrides,
  };
}

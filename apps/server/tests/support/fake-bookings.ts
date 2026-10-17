import type { BookingsService } from '../../src/modules/bookings/bookings.service.js';
import { ApiError } from '../../src/shared/http/ApiError.js';

/** 测试用预订服务替身（默认空分页 / 404；生产由真实仓储实现） */
export function createFakeBookingsService(
  overrides: Partial<BookingsService> = {},
): BookingsService {
  return {
    list: async () => ({
      items: [],
      pagination: { page: 1, pageSize: 20, total: 0, totalPages: 0 },
    }),
    getById: async () => {
      throw ApiError.notFound('预订不存在');
    },
    create: async () => {
      throw new Error('fake bookingsService.create 未提供实现');
    },
    cancel: async () => {
      throw new Error('fake bookingsService.cancel 未提供实现');
    },
    markNoShow: async () => {
      throw new Error('fake bookingsService.markNoShow 未提供实现');
    },
    ...overrides,
  };
}

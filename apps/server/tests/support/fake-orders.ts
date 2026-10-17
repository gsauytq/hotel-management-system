import type { OrdersService } from '../../src/modules/orders/orders.service.js';
import { ApiError } from '../../src/shared/http/ApiError.js';

/** 测试用订单服务替身（默认空分页 / 404；生产由真实仓储实现） */
export function createFakeOrdersService(overrides: Partial<OrdersService> = {}): OrdersService {
  return {
    list: async () => ({
      items: [],
      pagination: { page: 1, pageSize: 20, total: 0, totalPages: 0 },
    }),
    getById: async () => {
      throw ApiError.notFound('订单不存在');
    },
    ...overrides,
  };
}

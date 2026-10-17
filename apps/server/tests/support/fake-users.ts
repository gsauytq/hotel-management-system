import type { UsersService } from '../../src/modules/users/users.service.js';
import { ApiError } from '../../src/shared/http/ApiError.js';

/** 测试用员工服务替身（默认空分页 / 404；生产由真实仓储实现） */
export function createFakeUsersService(overrides: Partial<UsersService> = {}): UsersService {
  return {
    list: async () => ({
      items: [],
      pagination: { page: 1, pageSize: 20, total: 0, totalPages: 0 },
    }),
    getById: async () => {
      throw ApiError.notFound('员工不存在');
    },
    create: async () => {
      throw new Error('fake usersService.create 未提供实现');
    },
    update: async () => {
      throw new Error('fake usersService.update 未提供实现');
    },
    resetPassword: async () => {
      throw new Error('fake usersService.resetPassword 未提供实现');
    },
    ...overrides,
  };
}

import type { AuthService } from '../../src/modules/auth/auth.service.js';
import { ApiError } from '../../src/shared/http/ApiError.js';

/**
 * 测试用 AuthService 替身：默认全部登录失败（凭证错误）、会话解析为 missing。
 * 仅用于单元/接口测试；生产环境由 createAuthService + 真实仓储提供（见 src/main.ts）。
 */
export function createFakeAuthService(overrides: Partial<AuthService> = {}): AuthService {
  return {
    login: async () => {
      throw ApiError.fromCode('INVALID_CREDENTIALS', '用户名或密码错误');
    },
    logout: async () => undefined,
    changePassword: async () => undefined,
    resolveSession: async () => ({ status: 'missing' }),
    cleanupExpiredSessions: async () => 0,
    ...overrides,
  };
}

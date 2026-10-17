import type { CurrentUser } from '@hms/shared';

/** 请求上下文（审计/日志用；绝不包含密码等敏感值） */
export interface RequestContext {
  requestId: string;
  ip?: string | undefined;
}

/**
 * 会话解析结果（服务端内部区分四种状态，对外统一映射为 401 SESSION_EXPIRED，
 * 见 api-contract §1.4 与 docs/security-design.md §2）：
 * - active：会话有效且用户可用
 * - missing：Cookie 存在但会话不存在（令牌无效）
 * - expired：会话已过期
 * - disabled：用户已被停用（禁用即时踢出）
 */
export type SessionResolution =
  | {
      status: 'active';
      user: CurrentUser;
      sessionId: string;
      expiresAt: Date;
    }
  | { status: 'missing' | 'expired' | 'disabled' };

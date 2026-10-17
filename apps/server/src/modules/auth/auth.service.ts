import { randomBytes } from 'node:crypto';

import type { CurrentUser, LoginRequest, SessionUser } from '@hms/shared';

import { ApiError } from '../../shared/http/ApiError.js';
import type { RequestContext, SessionResolution } from '../../shared/http/auth.js';
import type { AuditLogger } from '../../utils/audit.js';
import { hashPassword, verifyPassword } from '../../utils/password.js';
import {
  LOGIN_LOCK_DURATION_MS,
  LOGIN_MAX_FAILED_ATTEMPTS,
  MAX_SESSIONS_PER_USER,
} from './auth.constants.js';
import type { AuthRepository, UserRecord } from './auth.repository.js';

export interface LoginResult {
  user: SessionUser;
  sessionId: string;
  expiresAt: Date;
}

export interface LogoutContext extends RequestContext {
  actorId: number;
  username: string;
}

export interface AuthService {
  login(input: LoginRequest, context: RequestContext): Promise<LoginResult>;
  logout(sessionId: string, context: LogoutContext): Promise<void>;
  resolveSession(sessionId: string): Promise<SessionResolution>;
  cleanupExpiredSessions(): Promise<number>;
}

export interface AuthServiceDependencies {
  repository: AuthRepository;
  audit: AuditLogger;
  sessionTtlHours: number;
  now?: () => Date;
}

function toSessionUser(user: UserRecord): SessionUser {
  return {
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    role: user.role,
  };
}

function toCurrentUser(user: UserRecord): CurrentUser {
  return { ...toSessionUser(user), status: user.status };
}

/** 统一文案：不区分“用户不存在”与“密码错误”，防枚举（security-design §3） */
function invalidCredentials(): ApiError {
  return ApiError.fromCode('INVALID_CREDENTIALS', '用户名或密码错误');
}

export function createAuthService(deps: AuthServiceDependencies): AuthService {
  const now = deps.now ?? ((): Date => new Date());
  const sessionTtlMs = deps.sessionTtlHours * 60 * 60 * 1000;
  let dummyPasswordHash: string | null = null;

  /** 用户不存在时执行一次等效 bcrypt 比较，防时序探测用户名（security-design §1） */
  async function consumeDummyCompare(password: string): Promise<void> {
    dummyPasswordHash ??= await hashPassword(randomBytes(16).toString('hex'));
    await verifyPassword(password, dummyPasswordHash);
  }

  function auditLogin(
    outcome: 'SUCCESS' | 'FAILURE',
    context: RequestContext,
    fields: { actorId?: number; target: string; reason?: string },
  ): void {
    deps.audit({
      action: 'auth.login',
      outcome,
      requestId: context.requestId,
      ip: context.ip,
      target: fields.target,
      ...(fields.actorId === undefined ? {} : { actorId: fields.actorId }),
      ...(fields.reason === undefined ? {} : { reason: fields.reason }),
    });
  }

  return {
    async login(input, context) {
      const current = now();
      const user = await deps.repository.findUserByUsername(input.username);

      if (user === null) {
        await consumeDummyCompare(input.password);
        auditLogin('FAILURE', context, {
          target: input.username,
          reason: 'invalid_credentials',
        });
        throw invalidCredentials();
      }

      if (user.status !== 'ACTIVE') {
        // 停用账号统一按凭证错误处理，不泄露账号状态（防枚举）。
        // 审查 A-3：仍执行一次等效 bcrypt 比较，避免“存在但停用”（快）与“不存在”（慢）
        // 形成可观测的时序差，导致已停用账号可被枚举。
        await consumeDummyCompare(input.password);
        auditLogin('FAILURE', context, {
          actorId: user.id,
          target: user.username,
          reason: 'user_disabled',
        });
        throw invalidCredentials();
      }

      if (user.lockedUntil !== null && user.lockedUntil.getTime() > current.getTime()) {
        auditLogin('FAILURE', context, {
          actorId: user.id,
          target: user.username,
          reason: 'account_locked',
        });
        throw ApiError.fromCode('ACCOUNT_LOCKED', '失败次数过多，账号已锁定，请 15 分钟后重试');
      }

      const passwordMatches = await verifyPassword(input.password, user.passwordHash);
      if (!passwordMatches) {
        const lockWindowExpired =
          user.lockedUntil !== null && user.lockedUntil.getTime() <= current.getTime();
        const failure = await deps.repository.recordFailedLogin({
          userId: user.id,
          now: current,
          resetFirst: lockWindowExpired,
          lockAfterAttempts: LOGIN_MAX_FAILED_ATTEMPTS,
          lockDurationMs: LOGIN_LOCK_DURATION_MS,
        });
        auditLogin('FAILURE', context, {
          actorId: user.id,
          target: user.username,
          reason: failure.lockedUntil === null ? 'invalid_credentials' : 'account_locked',
        });
        // 触发锁定的这一次失败仍返回 401；锁定期间的后续尝试返回 423
        throw invalidCredentials();
      }

      const sessionId = randomBytes(32).toString('hex');
      const expiresAt = new Date(current.getTime() + sessionTtlMs);
      await deps.repository.completeLogin({
        userId: user.id,
        sessionId,
        sessionExpiresAt: expiresAt,
        lastLoginAt: current,
        maxSessionsPerUser: MAX_SESSIONS_PER_USER,
      });

      auditLogin('SUCCESS', context, { actorId: user.id, target: user.username });
      return { user: toSessionUser(user), sessionId, expiresAt };
    },

    async logout(sessionId, context) {
      await deps.repository.deleteSession(sessionId);
      deps.audit({
        action: 'auth.logout',
        outcome: 'SUCCESS',
        requestId: context.requestId,
        ip: context.ip,
        actorId: context.actorId,
        target: context.username,
      });
    },

    async resolveSession(sessionId) {
      const current = now();
      const found = await deps.repository.findSessionWithUser(sessionId);
      if (found === null) {
        return { status: 'missing' };
      }
      if (found.session.expiresAt.getTime() <= current.getTime()) {
        await deps.repository.deleteSession(sessionId);
        return { status: 'expired' };
      }
      if (found.user.status !== 'ACTIVE') {
        return { status: 'disabled' };
      }
      return {
        status: 'active',
        user: toCurrentUser(found.user),
        sessionId,
        expiresAt: found.session.expiresAt,
      };
    },

    async cleanupExpiredSessions() {
      return deps.repository.deleteExpiredSessions(now());
    },
  };
}

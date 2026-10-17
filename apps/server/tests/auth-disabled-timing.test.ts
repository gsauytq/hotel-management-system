import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AuthRepository, UserRecord } from '../src/modules/auth/auth.repository.js';
import { createAuthService } from '../src/modules/auth/auth.service.js';
import type { RequestContext } from '../src/shared/http/auth.js';
import type { AuditLogger } from '../src/utils/audit.js';
import { verifyPassword } from '../src/utils/password.js';

/**
 * 审查 A-3 回归：停用账号登录分支必须执行一次等效 bcrypt 比较，
 * 避免“存在但已停用”（快）与“不存在”（慢，dummy compare）形成可观测时序差。
 * 通过 spy 断言“发生了 bcrypt 比较”，不做易 flaky 的时延阈值断言。
 */
vi.mock('../src/utils/password.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/utils/password.js')>();
  return {
    ...actual,
    hashPassword: vi.fn(actual.hashPassword),
    verifyPassword: vi.fn(actual.verifyPassword),
  };
});

const context: RequestContext = { requestId: 'req-disabled-timing', ip: '127.0.0.1' };

function disabledUser(): UserRecord {
  return {
    id: 1,
    username: 'disabled01',
    displayName: '已停用员工',
    role: 'RECEPTIONIST',
    status: 'DISABLED',
    // 停用分支不应比较该哈希；比较对象是 dummy hash（由 consumeDummyCompare 生成）
    passwordHash: '$2b$12$disabledbranch.unusedhash.value0000000000000000000000000000',
    failedAttempts: 0,
    lockedUntil: null,
  };
}

function buildService() {
  const repository: AuthRepository = {
    findUserByUsername: vi.fn(async () => disabledUser()),
    recordFailedLogin: vi.fn(async () => ({ failedAttempts: 1, lockedUntil: null })),
    completeLogin: vi.fn(async () => undefined),
    findSessionWithUser: vi.fn(async () => null),
    deleteSession: vi.fn(async () => undefined),
    deleteExpiredSessions: vi.fn(async () => 0),
  };
  const audit = vi.fn<AuditLogger>();
  const service = createAuthService({ repository, audit, sessionTtlHours: 8 });
  return { repository, audit, service };
}

describe('审查 A-3：停用账号登录的时序一致性', () => {
  beforeEach(() => {
    vi.mocked(verifyPassword).mockClear();
  });

  it('停用账号分支执行一次 dummy bcrypt 比较（与“用户不存在”同阶），返回统一 401', async () => {
    const { repository, audit, service } = buildService();

    await expect(
      service.login({ username: 'disabled01', password: 'Any#Pass1234' }, context),
    ).rejects.toMatchObject({ code: 'INVALID_CREDENTIALS', status: 401 });

    const verifySpy = vi.mocked(verifyPassword);
    expect(verifySpy).toHaveBeenCalledTimes(1);
    expect(verifySpy).toHaveBeenCalledWith('Any#Pass1234', expect.any(String));
    expect(repository.recordFailedLogin).not.toHaveBeenCalled();
    expect(repository.completeLogin).not.toHaveBeenCalled();
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: 'FAILURE', reason: 'user_disabled' }),
    );
  });
});

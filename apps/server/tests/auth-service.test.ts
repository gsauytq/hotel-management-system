import { describe, expect, it, vi, type Mock } from 'vitest';

import type { AuthRepository, UserRecord } from '../src/modules/auth/auth.repository.js';
import { createAuthService } from '../src/modules/auth/auth.service.js';
import type { RequestContext } from '../src/shared/http/auth.js';
import type { AuditEvent, AuditLogger } from '../src/utils/audit.js';
import { hashPassword, verifyPassword } from '../src/utils/password.js';

const PASSWORD = 'Correct#12345';
const passwordHash = await hashPassword(PASSWORD);

const context: RequestContext = { requestId: 'req-test-1', ip: '127.0.0.1' };
const fixedNow = new Date('2026-10-14T08:00:00.000Z');

function makeUser(overrides: Partial<UserRecord> = {}): UserRecord {
  return {
    id: 1,
    username: 'front01',
    displayName: '王小雅',
    role: 'RECEPTIONIST',
    status: 'ACTIVE',
    mustChangePassword: false,
    passwordHash,
    failedAttempts: 0,
    lockedUntil: null,
    ...overrides,
  };
}

function createRepositoryMock() {
  return {
    findUserByUsername: vi.fn<AuthRepository['findUserByUsername']>(),
    findUserById: vi.fn<AuthRepository['findUserById']>(),
    updatePasswordAndInvalidateSessions:
      vi.fn<AuthRepository['updatePasswordAndInvalidateSessions']>(),
    recordFailedLogin: vi.fn<AuthRepository['recordFailedLogin']>(),
    completeLogin: vi.fn<AuthRepository['completeLogin']>(),
    findSessionWithUser: vi.fn<AuthRepository['findSessionWithUser']>(),
    deleteSession: vi.fn<AuthRepository['deleteSession']>(),
    deleteExpiredSessions: vi.fn<AuthRepository['deleteExpiredSessions']>(),
  };
}

function buildService(
  options: { repository?: ReturnType<typeof createRepositoryMock>; now?: Date } = {},
) {
  const repository = options.repository ?? createRepositoryMock();
  const audit = vi.fn<AuditLogger>();
  const service = createAuthService({
    repository,
    audit,
    sessionTtlHours: 8,
    now: () => options.now ?? fixedNow,
  });
  return { repository, audit, service };
}

function firstAuditEvent(audit: Mock<AuditLogger>): AuditEvent | undefined {
  return audit.mock.calls[0]?.[0];
}

describe('auth.service 登录（TC-AUTH 语义）', () => {
  it('正确凭证：返回会话用户与 64 位 hex 会话 id，TTL=8h，清零失败并写审计', async () => {
    const { repository, audit, service } = buildService();
    repository.findUserByUsername.mockResolvedValue(makeUser());
    repository.completeLogin.mockResolvedValue(undefined);

    const result = await service.login({ username: 'front01', password: PASSWORD }, context);

    expect(result.user).toEqual({
      id: 1,
      username: 'front01',
      displayName: '王小雅',
      role: 'RECEPTIONIST',
      mustChangePassword: false,
    });
    expect(result.sessionId).toMatch(/^[0-9a-f]{64}$/);
    expect(result.expiresAt.getTime()).toBe(fixedNow.getTime() + 8 * 60 * 60 * 1000);
    expect(repository.completeLogin).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 1, maxSessionsPerUser: 10 }),
    );
    expect(firstAuditEvent(audit)).toMatchObject({ action: 'auth.login', outcome: 'SUCCESS' });
    expect(JSON.stringify(audit.mock.calls)).not.toContain(PASSWORD);
    expect(JSON.stringify(result)).not.toContain(passwordHash);
  });

  it('密码错误：401 INVALID_CREDENTIALS，记录失败尝试，不创建会话', async () => {
    const { repository, audit, service } = buildService();
    repository.findUserByUsername.mockResolvedValue(makeUser());
    repository.recordFailedLogin.mockResolvedValue({ failedAttempts: 1, lockedUntil: null });

    await expect(
      service.login({ username: 'front01', password: 'Wrong#12345' }, context),
    ).rejects.toMatchObject({ code: 'INVALID_CREDENTIALS', status: 401 });

    expect(repository.recordFailedLogin).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 1, resetFirst: false, lockAfterAttempts: 5 }),
    );
    expect(repository.completeLogin).not.toHaveBeenCalled();
    expect(firstAuditEvent(audit)).toMatchObject({
      action: 'auth.login',
      outcome: 'FAILURE',
      reason: 'invalid_credentials',
    });
  });

  it('用户不存在：仍返回统一 401，不记录失败计数（防枚举）', async () => {
    const { repository, audit, service } = buildService();
    repository.findUserByUsername.mockResolvedValue(null);

    await expect(
      service.login({ username: 'nobody01', password: PASSWORD }, context),
    ).rejects.toMatchObject({ code: 'INVALID_CREDENTIALS', status: 401 });

    expect(repository.recordFailedLogin).not.toHaveBeenCalled();
    expect(firstAuditEvent(audit)).toMatchObject({
      reason: 'invalid_credentials',
      target: 'nobody01',
    });
  });

  it('锁定期间即使密码正确也返回 423 ACCOUNT_LOCKED', async () => {
    const { repository, audit, service } = buildService();
    repository.findUserByUsername.mockResolvedValue(
      makeUser({ lockedUntil: new Date(fixedNow.getTime() + 60_000) }),
    );

    await expect(
      service.login({ username: 'front01', password: PASSWORD }, context),
    ).rejects.toMatchObject({ code: 'ACCOUNT_LOCKED', status: 423 });

    expect(repository.completeLogin).not.toHaveBeenCalled();
    expect(firstAuditEvent(audit)).toMatchObject({ outcome: 'FAILURE', reason: 'account_locked' });
  });

  it('锁定已过期后再次失败：从 1 重新计数（resetFirst）', async () => {
    const { repository, service } = buildService();
    repository.findUserByUsername.mockResolvedValue(
      makeUser({ lockedUntil: new Date(fixedNow.getTime() - 60_000), failedAttempts: 5 }),
    );
    repository.recordFailedLogin.mockResolvedValue({ failedAttempts: 1, lockedUntil: null });

    await expect(
      service.login({ username: 'front01', password: 'Wrong#12345' }, context),
    ).rejects.toMatchObject({ code: 'INVALID_CREDENTIALS' });

    expect(repository.recordFailedLogin).toHaveBeenCalledWith(
      expect.objectContaining({ resetFirst: true }),
    );
  });

  it('第 5 次失败触发锁定：本次仍返回 401，审计标记 account_locked', async () => {
    const { repository, audit, service } = buildService();
    repository.findUserByUsername.mockResolvedValue(makeUser({ failedAttempts: 4 }));
    repository.recordFailedLogin.mockResolvedValue({
      failedAttempts: 5,
      lockedUntil: new Date(fixedNow.getTime() + 15 * 60 * 1000),
    });

    await expect(
      service.login({ username: 'front01', password: 'Wrong#12345' }, context),
    ).rejects.toMatchObject({ code: 'INVALID_CREDENTIALS', status: 401 });

    expect(firstAuditEvent(audit)).toMatchObject({ outcome: 'FAILURE', reason: 'account_locked' });
  });

  it('停用账号：统一 401（不泄露账号状态），不创建会话', async () => {
    const { repository, audit, service } = buildService();
    repository.findUserByUsername.mockResolvedValue(makeUser({ status: 'DISABLED' }));

    await expect(
      service.login({ username: 'front01', password: PASSWORD }, context),
    ).rejects.toMatchObject({ code: 'INVALID_CREDENTIALS', status: 401 });

    expect(repository.completeLogin).not.toHaveBeenCalled();
    expect(firstAuditEvent(audit)).toMatchObject({
      outcome: 'FAILURE',
      reason: 'user_disabled',
      actorId: 1,
    });
  });
});

describe('auth.service 自助改密（A-20 B）', () => {
  const changeContext = { ...context, actorId: 1, username: 'front01' };

  it('当前密码正确：更新哈希、清除首登标记并使全部会话失效', async () => {
    const { repository, audit, service } = buildService();
    repository.findUserById.mockResolvedValue(makeUser({ mustChangePassword: true }));
    repository.updatePasswordAndInvalidateSessions.mockResolvedValue(undefined);

    await service.changePassword(
      { currentPassword: PASSWORD, newPassword: 'New#Pass12345' },
      changeContext,
    );

    expect(repository.updatePasswordAndInvalidateSessions).toHaveBeenCalledTimes(1);
    const [params] = repository.updatePasswordAndInvalidateSessions.mock.calls[0]!;
    expect(params.userId).toBe(1);
    await expect(verifyPassword('New#Pass12345', params.passwordHash)).resolves.toBe(true);
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'auth.change_password', outcome: 'SUCCESS' }),
    );
    expect(JSON.stringify(audit.mock.calls)).not.toContain('New#Pass12345');
  });

  it('当前密码错误：422 字段错误、不更新密码、写失败审计', async () => {
    const { repository, audit, service } = buildService();
    repository.findUserById.mockResolvedValue(makeUser({ mustChangePassword: true }));

    await expect(
      service.changePassword(
        { currentPassword: 'Wrong#Pass123', newPassword: 'New#Pass12345' },
        changeContext,
      ),
    ).rejects.toMatchObject({
      status: 422,
      details: [{ field: 'currentPassword', message: '当前密码不正确' }],
    });

    expect(repository.updatePasswordAndInvalidateSessions).not.toHaveBeenCalled();
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'auth.change_password',
        outcome: 'FAILURE',
        reason: 'invalid_current_password',
      }),
    );
  });

  it('新密码包含用户名或与当前密码相同：拒绝更新', async () => {
    const { repository, service } = buildService();
    repository.findUserById.mockResolvedValue(makeUser({ mustChangePassword: true }));

    await expect(
      service.changePassword(
        { currentPassword: PASSWORD, newPassword: 'Front01#Pass123' },
        changeContext,
      ),
    ).rejects.toMatchObject({
      status: 422,
      details: [{ field: 'newPassword', message: '密码不得包含用户名' }],
    });

    await expect(
      service.changePassword({ currentPassword: PASSWORD, newPassword: PASSWORD }, changeContext),
    ).rejects.toMatchObject({
      status: 422,
      details: [{ field: 'newPassword', message: '新密码不能与当前密码相同' }],
    });

    expect(repository.updatePasswordAndInvalidateSessions).not.toHaveBeenCalled();
  });
});

describe('auth.service 会话解析（区分未登录/无效/过期/停用）', () => {
  it('会话不存在 → missing', async () => {
    const { repository, service } = buildService();
    repository.findSessionWithUser.mockResolvedValue(null);
    await expect(service.resolveSession('a'.repeat(64))).resolves.toEqual({ status: 'missing' });
  });

  it('会话过期 → expired 并清理过期行', async () => {
    const { repository, service } = buildService();
    repository.findSessionWithUser.mockResolvedValue({
      session: { id: 'b'.repeat(64), expiresAt: new Date(fixedNow.getTime() - 1) },
      user: makeUser(),
    });
    repository.deleteSession.mockResolvedValue(undefined);

    await expect(service.resolveSession('b'.repeat(64))).resolves.toEqual({ status: 'expired' });
    expect(repository.deleteSession).toHaveBeenCalledWith('b'.repeat(64));
  });

  it('用户被停用 → disabled（每请求实时查库，即时踢出）', async () => {
    const { repository, service } = buildService();
    repository.findSessionWithUser.mockResolvedValue({
      session: { id: 'c'.repeat(64), expiresAt: new Date(fixedNow.getTime() + 60_000) },
      user: makeUser({ status: 'DISABLED' }),
    });

    await expect(service.resolveSession('c'.repeat(64))).resolves.toEqual({ status: 'disabled' });
    expect(repository.deleteSession).not.toHaveBeenCalled();
  });

  it('有效会话 → active，用户含 status', async () => {
    const { repository, service } = buildService();
    repository.findSessionWithUser.mockResolvedValue({
      session: { id: 'd'.repeat(64), expiresAt: new Date(fixedNow.getTime() + 60_000) },
      user: makeUser(),
    });

    const result = await service.resolveSession('d'.repeat(64));
    expect(result).toMatchObject({
      status: 'active',
      sessionId: 'd'.repeat(64),
      user: { id: 1, username: 'front01', role: 'RECEPTIONIST', status: 'ACTIVE' },
    });
  });
});

describe('auth.service 登出与清理', () => {
  it('登出删除会话并写审计', async () => {
    const { repository, audit, service } = buildService();
    repository.deleteSession.mockResolvedValue(undefined);

    await service.logout('e'.repeat(64), {
      requestId: 'req-2',
      actorId: 1,
      username: 'front01',
    });

    expect(repository.deleteSession).toHaveBeenCalledWith('e'.repeat(64));
    expect(firstAuditEvent(audit)).toMatchObject({ action: 'auth.logout', outcome: 'SUCCESS' });
  });

  it('清理过期会话返回删除数量', async () => {
    const { repository, service } = buildService();
    repository.deleteExpiredSessions.mockResolvedValue(3);
    await expect(service.cleanupExpiredSessions()).resolves.toBe(3);
    expect(repository.deleteExpiredSessions).toHaveBeenCalledWith(fixedNow);
  });
});

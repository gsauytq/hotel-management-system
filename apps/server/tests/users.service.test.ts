import { describe, expect, it, vi } from 'vitest';

import type { UserRecord, UsersRepository } from '../src/modules/users/users.repository.js';
import { createUsersService } from '../src/modules/users/users.service.js';
import type { AuditLogger } from '../src/utils/audit.js';
import { verifyPassword } from '../src/utils/password.js';

function createRepositoryMock() {
  return {
    list: vi.fn<UsersRepository['list']>(),
    findById: vi.fn<UsersRepository['findById']>(),
    findByUsername: vi.fn<UsersRepository['findByUsername']>(),
    create: vi.fn<UsersRepository['create']>(),
    update: vi.fn<UsersRepository['update']>(),
    updatePasswordHash: vi.fn<UsersRepository['updatePasswordHash']>(),
  };
}

function makeUser(overrides: Partial<UserRecord> = {}): UserRecord {
  return {
    id: 3,
    username: 'front02',
    displayName: '李雷',
    role: 'RECEPTIONIST',
    status: 'ACTIVE',
    passwordHash: '$2b$12$placeholder',
    lastLoginAt: null,
    createdAt: new Date('2026-10-14T06:00:00.000Z'),
    ...overrides,
  };
}

const context = { actorId: 1, requestId: 'req-users-1', ip: '127.0.0.1' };

function buildService() {
  const repository = createRepositoryMock();
  const audit = vi.fn<AuditLogger>();
  const service = createUsersService({ repository, audit });
  return { repository, audit, service };
}

describe('users.service（U1/U2/U3/U4 业务规则）', () => {
  it('列表映射 DTO（绝不含 passwordHash）并按分页构造', async () => {
    const { repository, service } = buildService();
    repository.list.mockResolvedValue({ total: 1, items: [makeUser()] });

    const result = await service.list({
      role: 'RECEPTIONIST',
      status: 'ACTIVE',
      page: 1,
      pageSize: 20,
      orderBy: [{ createdAt: 'desc' }],
    });
    expect(result.items[0]).toEqual({
      id: 3,
      username: 'front02',
      displayName: '李雷',
      role: 'RECEPTIONIST',
      status: 'ACTIVE',
      lastLoginAt: null,
      createdAt: '2026-10-14T06:00:00.000Z',
    });
    expect(JSON.stringify(result)).not.toContain('passwordHash');
    expect(result.pagination).toEqual({ page: 1, pageSize: 20, total: 1, totalPages: 1 });
  });

  it('创建：密码先 bcrypt 哈希；审计写入；重复用户名 → 409', async () => {
    const { repository, audit, service } = buildService();
    repository.create.mockResolvedValue(makeUser());
    const created = await service.create(
      {
        username: 'front02',
        password: 'Init#12345',
        displayName: '李雷',
        role: 'RECEPTIONIST',
      },
      context,
    );
    expect(created.username).toBe('front02');
    const createArg = repository.create.mock.calls[0]?.[0];
    expect(createArg?.passwordHash).not.toBe('Init#12345');
    expect(await verifyPassword('Init#12345', createArg?.passwordHash ?? '')).toBe(true);
    expect(audit.mock.calls[0]?.[0]).toMatchObject({
      action: 'user.create',
      outcome: 'SUCCESS',
      actorId: 1,
      target: 'front02',
    });

    repository.create.mockRejectedValueOnce(Object.assign(new Error('dup'), { code: 'P2002' }));
    await expect(
      service.create(
        { username: 'front02', password: 'Init#12345', displayName: '李雷', role: 'RECEPTIONIST' },
        context,
      ),
    ).rejects.toMatchObject({ code: 'DUPLICATE_USERNAME', status: 409 });
  });

  it('密码不得包含用户名（security-design §1）', async () => {
    const { repository, service } = buildService();
    await expect(
      service.create(
        {
          username: 'front02',
          password: 'Front02#Pass',
          displayName: '李雷',
          role: 'RECEPTIONIST',
        },
        context,
      ),
    ).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
      status: 422,
      details: [{ field: 'password' }],
    });
    expect(repository.create).not.toHaveBeenCalled();
  });

  it('U3：不可停用自己 → 403；停用他人时会话删除与更新同事务并写审计', async () => {
    const { repository, audit, service } = buildService();

    repository.findById.mockResolvedValueOnce(makeUser({ id: 1 }));
    await expect(
      service.update(1, { status: 'DISABLED' }, { ...context, actorId: 1 }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN', status: 403, message: '不能停用当前登录账号' });
    expect(repository.update).not.toHaveBeenCalled();

    repository.findById.mockResolvedValueOnce(makeUser({ id: 3 }));
    repository.update.mockResolvedValue(makeUser({ id: 3, status: 'DISABLED' }));
    const updated = await service.update(3, { status: 'DISABLED' }, context);
    expect(updated.status).toBe('DISABLED');
    // 会话撤销由仓储在同一事务内完成（审查 P-5：避免已停用但残留会话行的中间态）
    expect(repository.update).toHaveBeenCalledWith(
      3,
      { status: 'DISABLED' },
      { revokeSessions: true },
    );
    expect(audit.mock.calls[0]?.[0]).toMatchObject({ action: 'user.disable', target: 'front02' });
  });

  it('U3：角色变更写审计；未变更角色不写 user.role_change', async () => {
    const { repository, audit, service } = buildService();
    repository.findById.mockResolvedValueOnce(makeUser({ id: 3, role: 'RECEPTIONIST' }));
    repository.update.mockResolvedValue(makeUser({ id: 3, role: 'ADMIN' }));

    await service.update(3, { role: 'ADMIN' }, context);
    expect(repository.update).toHaveBeenCalledWith(3, { role: 'ADMIN' }, { revokeSessions: false });
    expect(audit.mock.calls[0]?.[0]).toMatchObject({
      action: 'user.role_change',
      outcome: 'SUCCESS',
      target: 'front02',
    });

    audit.mockClear();
    repository.findById.mockResolvedValueOnce(makeUser({ id: 3, role: 'ADMIN' }));
    repository.update.mockResolvedValue(makeUser({ id: 3, role: 'ADMIN' }));
    await service.update(3, { role: 'ADMIN' }, context);
    expect(audit).not.toHaveBeenCalled();
  });

  it('U3/U4：不存在 → 404', async () => {
    const { repository, service } = buildService();
    repository.findById.mockResolvedValue(null);
    await expect(service.update(999, { displayName: 'x' }, context)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    await expect(
      service.resetPassword(999, { newPassword: 'Valid#12345' }, context),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('U4：重置密码 → 新密码可用、旧会话全部失效、审计写入；密码含用户名 422', async () => {
    const { repository, audit, service } = buildService();
    repository.findById.mockResolvedValue(makeUser());
    repository.updatePasswordHash.mockResolvedValue(true);

    await service.resetPassword(3, { newPassword: 'New#Pass1234' }, context);
    const newHash = repository.updatePasswordHash.mock.calls[0]?.[1] ?? '';
    expect(await verifyPassword('New#Pass1234', newHash)).toBe(true);
    // 密码更新与会话删除在仓储同一事务内完成（api-contract U4）
    expect(repository.updatePasswordHash).toHaveBeenCalledWith(3, expect.any(String), {
      revokeSessions: true,
    });
    expect(audit.mock.calls[0]?.[0]).toMatchObject({ action: 'user.password_reset' });

    await expect(
      service.resetPassword(3, { newPassword: 'Front02#Pass' }, context),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  });
});

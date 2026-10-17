import type {
  CreateUserRequest,
  Paginated,
  ResetPasswordRequest,
  Role,
  UpdateUserRequest,
  UserListItemDto,
  UserStatus,
} from '@hms/shared';

import { ApiError } from '../../shared/http/ApiError.js';
import type { RequestContext } from '../../shared/http/auth.js';
import { buildPagination } from '../../shared/http/pagination.js';
import { isUniqueConstraintError } from '../../shared/http/prisma-errors.js';
import type { AuditLogger } from '../../utils/audit.js';
import { hashPassword } from '../../utils/password.js';
import type { UserRecord, UsersRepository } from './users.repository.js';

export interface UserListQuery {
  role?: Role;
  status?: UserStatus;
  keyword?: string;
  page: number;
  pageSize: number;
  orderBy: Array<Record<string, 'asc' | 'desc'>>;
}

export interface UserActionContext extends RequestContext {
  actorId: number;
}

export interface UsersService {
  list(query: UserListQuery): Promise<Paginated<UserListItemDto>>;
  getById(id: number): Promise<UserListItemDto>;
  create(input: CreateUserRequest, context: UserActionContext): Promise<UserListItemDto>;
  update(
    id: number,
    input: UpdateUserRequest,
    context: UserActionContext,
  ): Promise<UserListItemDto>;
  resetPassword(id: number, input: ResetPasswordRequest, context: UserActionContext): Promise<void>;
}

export interface UsersServiceDependencies {
  repository: UsersRepository;
  audit: AuditLogger;
}

export function toUserListItemDto(record: UserRecord): UserListItemDto {
  return {
    id: record.id,
    username: record.username,
    displayName: record.displayName,
    role: record.role,
    status: record.status,
    lastLoginAt: record.lastLoginAt === null ? null : record.lastLoginAt.toISOString(),
    createdAt: record.createdAt.toISOString(),
  };
}

/** 密码策略中的"不得包含用户名"（security-design §1，需结合目标用户名） */
function assertPasswordExcludesUsername(password: string, username: string): void {
  if (password.toLowerCase().includes(username.toLowerCase())) {
    throw ApiError.validation('参数校验失败', [
      { field: 'password', message: '密码不得包含用户名' },
    ]);
  }
}

export function createUsersService(deps: UsersServiceDependencies): UsersService {
  const { repository, audit } = deps;

  return {
    async list(query) {
      const { items, total } = await repository.list(query);
      return {
        items: items.map(toUserListItemDto),
        pagination: buildPagination(query.page, query.pageSize, total),
      };
    },

    async getById(id) {
      const user = await repository.findById(id);
      if (user === null) {
        throw ApiError.notFound('员工不存在');
      }
      return toUserListItemDto(user);
    },

    async create(input, context) {
      assertPasswordExcludesUsername(input.password, input.username);
      const passwordHash = await hashPassword(input.password);
      try {
        const user = await repository.create({
          username: input.username,
          passwordHash,
          displayName: input.displayName,
          role: input.role,
        });
        audit({
          action: 'user.create',
          outcome: 'SUCCESS',
          requestId: context.requestId,
          ip: context.ip,
          actorId: context.actorId,
          target: user.username,
        });
        return toUserListItemDto(user);
      } catch (error) {
        if (isUniqueConstraintError(error)) {
          throw ApiError.conflict('DUPLICATE_USERNAME', '用户名已存在');
        }
        throw error;
      }
    },

    async update(id, input, context) {
      const user = await repository.findById(id);
      if (user === null) {
        throw ApiError.notFound('员工不存在');
      }
      // 资源级规则：ADMIN 不得停用自己（api-contract U3）
      if (context.actorId === id && input.status === 'DISABLED') {
        throw ApiError.forbidden('不能停用当前登录账号');
      }

      // 停用即时踢出：更新与会话删除在同一事务（security-design §2；会话中间件每请求查库双保险）
      const updated = await repository.update(id, input, {
        revokeSessions: input.status === 'DISABLED',
      });
      if (updated === null) {
        throw ApiError.notFound('员工不存在');
      }

      if (input.status === 'DISABLED') {
        audit({
          action: 'user.disable',
          outcome: 'SUCCESS',
          requestId: context.requestId,
          ip: context.ip,
          actorId: context.actorId,
          target: updated.username,
        });
      }
      // 角色提升/变更属敏感操作，写入审计（security-design §9 审计扩展）
      if (input.role !== undefined && input.role !== user.role) {
        audit({
          action: 'user.role_change',
          outcome: 'SUCCESS',
          requestId: context.requestId,
          ip: context.ip,
          actorId: context.actorId,
          target: updated.username,
        });
      }
      return toUserListItemDto(updated);
    },

    async resetPassword(id, input, context) {
      const user = await repository.findById(id);
      if (user === null) {
        throw ApiError.notFound('员工不存在');
      }
      assertPasswordExcludesUsername(input.newPassword, user.username);

      const passwordHash = await hashPassword(input.newPassword);
      // 重置密码后该用户全部会话失效，与密码更新同事务（api-contract U4）
      const updated = await repository.updatePasswordHash(id, passwordHash, {
        revokeSessions: true,
      });
      if (!updated) {
        throw ApiError.notFound('员工不存在');
      }
      audit({
        action: 'user.password_reset',
        outcome: 'SUCCESS',
        requestId: context.requestId,
        ip: context.ip,
        actorId: context.actorId,
        target: user.username,
      });
    },
  };
}

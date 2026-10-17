import type { Role, UserStatus } from '@hms/shared';

import { Prisma, type PrismaClient } from '../../generated/prisma/client.js';

export interface UserRecord {
  id: number;
  username: string;
  displayName: string;
  role: Role;
  status: UserStatus;
  passwordHash: string;
  lastLoginAt: Date | null;
  createdAt: Date;
}

export interface CreateUserData {
  username: string;
  passwordHash: string;
  displayName: string;
  role: Role;
}

export interface UpdateUserData {
  displayName?: string | undefined;
  role?: Role | undefined;
  status?: UserStatus | undefined;
}

/** 与主更新同一事务的会话撤销（停用/重置密码即时踢出；审查 P-5） */
export interface RevokeSessionsOptions {
  revokeSessions?: boolean;
}

export interface UserListParams {
  role?: Role;
  status?: UserStatus;
  keyword?: string;
  page: number;
  pageSize: number;
  orderBy: Array<Record<string, 'asc' | 'desc'>>;
}

export interface UsersRepository {
  list(params: UserListParams): Promise<{ items: UserRecord[]; total: number }>;
  findById(id: number): Promise<UserRecord | null>;
  findByUsername(username: string): Promise<UserRecord | null>;
  create(data: CreateUserData): Promise<UserRecord>;
  update(
    id: number,
    data: UpdateUserData,
    options?: RevokeSessionsOptions,
  ): Promise<UserRecord | null>;
  updatePasswordHash(
    id: number,
    passwordHash: string,
    options?: RevokeSessionsOptions,
  ): Promise<boolean>;
}

type UserRow = {
  id: bigint;
  username: string;
  displayName: string;
  role: string;
  status: string;
  passwordHash: string;
  lastLoginAt: Date | null;
  createdAt: Date;
};

function mapUser(row: UserRow): UserRecord {
  return {
    id: Number(row.id),
    username: row.username,
    displayName: row.displayName,
    role: row.role as Role,
    status: row.status as UserStatus,
    passwordHash: row.passwordHash,
    lastLoginAt: row.lastLoginAt,
    createdAt: row.createdAt,
  };
}

export function createUsersRepository(prisma: PrismaClient): UsersRepository {
  return {
    async list(params) {
      const where: Prisma.UserWhereInput = {
        ...(params.role === undefined ? {} : { role: params.role }),
        ...(params.status === undefined ? {} : { status: params.status }),
        ...(params.keyword === undefined
          ? {}
          : {
              OR: [
                { username: { contains: params.keyword } },
                { displayName: { contains: params.keyword } },
              ],
            }),
      };
      const [total, rows] = await Promise.all([
        prisma.user.count({ where }),
        prisma.user.findMany({
          where,
          orderBy: params.orderBy as unknown as Prisma.UserOrderByWithRelationInput[],
          skip: (params.page - 1) * params.pageSize,
          take: params.pageSize,
        }),
      ]);
      return { total, items: rows.map(mapUser) };
    },

    async findById(id) {
      const row = await prisma.user.findUnique({ where: { id } });
      return row === null ? null : mapUser(row);
    },

    async findByUsername(username) {
      const row = await prisma.user.findUnique({ where: { username } });
      return row === null ? null : mapUser(row);
    },

    async create(data) {
      const row = await prisma.user.create({
        data: {
          username: data.username,
          passwordHash: data.passwordHash,
          displayName: data.displayName,
          role: data.role,
        },
      });
      return mapUser(row);
    },

    async update(id, data, options) {
      const updateData = {
        ...(data.displayName === undefined ? {} : { displayName: data.displayName }),
        ...(data.role === undefined ? {} : { role: data.role }),
        ...(data.status === undefined ? {} : { status: data.status }),
      };
      // 停用即时踢出：用户更新与会话删除同一事务，避免"已停用但仍残留会话行"的中间态
      if (options?.revokeSessions === true) {
        return prisma.$transaction(async (tx) => {
          const existing = await tx.user.findUnique({ where: { id }, select: { id: true } });
          if (existing === null) {
            return null;
          }
          const row = await tx.user.update({ where: { id }, data: updateData });
          await tx.session.deleteMany({ where: { userId: id } });
          return mapUser(row);
        });
      }
      const existing = await prisma.user.findUnique({ where: { id }, select: { id: true } });
      if (existing === null) {
        return null;
      }
      const row = await prisma.user.update({ where: { id }, data: updateData });
      return mapUser(row);
    },

    async updatePasswordHash(id, passwordHash, options) {
      // 重置密码后全部会话失效：密码哈希更新与会话删除同一事务（api-contract U4）
      if (options?.revokeSessions === true) {
        return prisma.$transaction(async (tx) => {
          const result = await tx.user.updateMany({ where: { id }, data: { passwordHash } });
          if (result.count === 0) {
            return false;
          }
          await tx.session.deleteMany({ where: { userId: id } });
          return true;
        });
      }
      const result = await prisma.user.updateMany({ where: { id }, data: { passwordHash } });
      return result.count > 0;
    },
  };
}

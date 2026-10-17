import type { Role, UserStatus } from '@hms/shared';

import { Prisma, type PrismaClient } from '../../generated/prisma/client.js';

export interface UserRecord {
  id: number;
  username: string;
  displayName: string;
  role: Role;
  status: UserStatus;
  passwordHash: string;
  failedAttempts: number;
  lockedUntil: Date | null;
}

export interface SessionWithUser {
  session: { id: string; expiresAt: Date };
  user: UserRecord;
}

export interface RecordFailedLoginParams {
  userId: number;
  now: Date;
  /**
   * 服务层在 bcrypt 比较前读取的锁定状态（仅作提示）。
   * 审查 A-4：该值可能已陈旧（比较窗口内其他请求可能已重新锁定），
   * 仓储必须在 users 行锁内重新判定，不得直接据此复位。
   */
  resetFirst: boolean;
  lockAfterAttempts: number;
  lockDurationMs: number;
}

export interface RecordFailedLoginResult {
  failedAttempts: number;
  lockedUntil: Date | null;
}

export interface CompleteLoginParams {
  userId: number;
  sessionId: string;
  sessionExpiresAt: Date;
  lastLoginAt: Date;
  maxSessionsPerUser: number;
}

export interface AuthRepository {
  findUserByUsername(username: string): Promise<UserRecord | null>;
  recordFailedLogin(params: RecordFailedLoginParams): Promise<RecordFailedLoginResult>;
  /** 事务：清零失败计数/锁定、更新 last_login_at、写入新会话并裁剪超限会话 */
  completeLogin(params: CompleteLoginParams): Promise<void>;
  findSessionWithUser(sessionId: string): Promise<SessionWithUser | null>;
  deleteSession(sessionId: string): Promise<void>;
  deleteExpiredSessions(now: Date): Promise<number>;
}

interface UserRow {
  id: bigint;
  username: string;
  displayName: string;
  role: Role;
  status: UserStatus;
  passwordHash: string;
  failedAttempts: number;
  lockedUntil: Date | null;
}

function mapUser(row: UserRow): UserRecord {
  return {
    id: Number(row.id),
    username: row.username,
    displayName: row.displayName,
    role: row.role,
    status: row.status,
    passwordHash: row.passwordHash,
    failedAttempts: row.failedAttempts,
    lockedUntil: row.lockedUntil,
  };
}

export function createAuthRepository(prisma: PrismaClient): AuthRepository {
  return {
    async findUserByUsername(username) {
      const user = await prisma.user.findUnique({ where: { username } });
      return user === null ? null : mapUser(user);
    },

    async recordFailedLogin({
      userId,
      now,
      lockAfterAttempts,
      lockDurationMs,
    }): Promise<RecordFailedLoginResult> {
      // 审查 A-4：以 users 行锁为原子边界，在锁内重新读取并判定锁定窗口。
      // - 锁定已过期 → 从 1 重新计数（保留原有顺序语义，避免过期后一次失败立即重新锁定）；
      // - 并发请求已重新锁定 → 保持现状（不计数、不解除），防止擦除新锁；
      // - 未锁定 → 原子自增，达标即置锁。
      // 不变量：并发失败尝试的计数不会因陈旧读取而塌缩。
      return prisma.$transaction(
        async (tx) => {
          const rows = await tx.$queryRaw<
            Array<{ failed_attempts: number; locked_until: Date | null }>
          >`
            SELECT failed_attempts, locked_until FROM users WHERE id = ${userId} FOR UPDATE`;
          const current = rows[0];
          if (current === undefined) {
            // 用户不存在（登录前已查到且业务不做物理删除，理论不可达）
            return { failedAttempts: 0, lockedUntil: null };
          }

          const lockedUntil = current.locked_until;
          if (lockedUntil !== null && lockedUntil.getTime() <= now.getTime()) {
            // 锁定窗口已过期：从 1 重新计数（保留原有 reset 语义）
            const updated = await tx.user.update({
              where: { id: userId },
              data: { failedAttempts: 1, lockedUntil: null },
            });
            return { failedAttempts: updated.failedAttempts, lockedUntil: null };
          }
          if (lockedUntil !== null) {
            // 并发请求已把账户重新锁定：不得计数或解除锁定（A-4 变体②）
            return { failedAttempts: current.failed_attempts, lockedUntil };
          }

          const failedAttempts = current.failed_attempts + 1;
          const nextLockedUntil =
            failedAttempts >= lockAfterAttempts ? new Date(now.getTime() + lockDurationMs) : null;
          const updated = await tx.user.update({
            where: { id: userId },
            data: {
              failedAttempts,
              ...(nextLockedUntil === null ? {} : { lockedUntil: nextLockedUntil }),
            },
          });
          return { failedAttempts: updated.failedAttempts, lockedUntil: nextLockedUntil };
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted },
      );
    },

    async completeLogin({ userId, sessionId, sessionExpiresAt, lastLoginAt, maxSessionsPerUser }) {
      // READ COMMITTED + 按主键精确删除溢出会话：
      // 避免 RR 下 `id NOT IN (...)` 的扫描/间隙锁与其他登录的会话插入产生 InnoDB 死锁
      // （并发集成测试实测到 sessions 表死锁）。
      await prisma.$transaction(
        async (tx) => {
          await tx.user.update({
            where: { id: userId },
            data: { failedAttempts: 0, lockedUntil: null, lastLoginAt },
          });
          await tx.session.create({
            data: { id: sessionId, userId, expiresAt: sessionExpiresAt },
          });
          const sessions = await tx.session.findMany({
            where: { userId },
            orderBy: { createdAt: 'desc' },
            select: { id: true },
          });
          const overflowIds = sessions.slice(maxSessionsPerUser).map((session) => session.id);
          if (overflowIds.length > 0) {
            await tx.session.deleteMany({ where: { id: { in: overflowIds } } });
          }
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted },
      );
    },

    async findSessionWithUser(sessionId) {
      const session = await prisma.session.findUnique({
        where: { id: sessionId },
        include: { user: true },
      });
      if (session === null) {
        return null;
      }
      return {
        session: { id: session.id, expiresAt: session.expiresAt },
        user: mapUser(session.user),
      };
    },

    async deleteSession(sessionId) {
      // deleteMany：会话不存在时不抛 P2025（过期清理与重复登出为幂等语义）
      await prisma.session.deleteMany({ where: { id: sessionId } });
    },

    async deleteExpiredSessions(now) {
      const result = await prisma.session.deleteMany({ where: { expiresAt: { lt: now } } });
      return result.count;
    },
  };
}

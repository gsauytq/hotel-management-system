import { z } from 'zod';

import { usernameSchema, utf8ByteLength } from './schemas/auth.js';
import { ROLES, USER_STATUSES, type Role, type UserStatus } from './roles.js';

export interface UserListItemDto {
  id: number;
  username: string;
  displayName: string;
  role: Role;
  status: UserStatus;
  lastLoginAt: string | null;
  createdAt: string;
}

/** U1 排序白名单（api-contract U1，默认 createdAt:desc） */
export const USER_SORT_FIELDS = ['createdAt', 'username', 'lastLoginAt'] as const;

/**
 * 员工密码策略（security-design §1）：长度 ≥10、≤72 字节（bcrypt 上限）、
 * 至少含字母与数字；"不得包含用户名"需服务层结合目标用户名校验。
 */
export const userPasswordSchema = z
  .string()
  .min(10, '密码至少 10 个字符')
  .refine((value) => utf8ByteLength(value) <= 72, '密码长度不得超过 72 字节（bcrypt 上限）')
  .refine((value) => /[A-Za-z]/.test(value) && /\d/.test(value), '密码必须同时包含字母与数字');

export const createUserSchema = z.strictObject({
  username: usernameSchema,
  password: userPasswordSchema,
  displayName: z.string().trim().min(1, '姓名不能为空').max(50, '姓名不得超过 50 个字符'),
  role: z.enum(ROLES),
});

export const updateUserSchema = z.strictObject({
  displayName: z
    .string()
    .trim()
    .min(1, '姓名不能为空')
    .max(50, '姓名不得超过 50 个字符')
    .optional(),
  role: z.enum(ROLES).optional(),
  status: z.enum(USER_STATUSES).optional(),
});

export const resetPasswordSchema = z.strictObject({
  newPassword: userPasswordSchema,
});

export type CreateUserRequest = z.infer<typeof createUserSchema>;
export type UpdateUserRequest = z.infer<typeof updateUserSchema>;
export type ResetPasswordRequest = z.infer<typeof resetPasswordSchema>;

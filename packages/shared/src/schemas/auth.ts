import { z } from 'zod';

/**
 * UTF-8 字节长度（bcrypt 上限为 72 字节；字符数不等于字节数）
 * 不依赖 TextEncoder，保证共享包在 Node 与浏览器下行为一致。
 */
export function utf8ByteLength(value: string): number {
  let bytes = 0;
  for (const char of value) {
    const codePoint = char.codePointAt(0) ?? 0;
    if (codePoint <= 0x7f) {
      bytes += 1;
    } else if (codePoint <= 0x7ff) {
      bytes += 2;
    } else if (codePoint <= 0xffff) {
      bytes += 3;
    } else {
      bytes += 4;
    }
  }
  return bytes;
}

/** 员工登录名（api-contract A1/U2）：3-50 位字母/数字/下划线 */
export const usernameSchema = z
  .string()
  .regex(/^[a-zA-Z0-9_]{3,50}$/, '用户名须为 3-50 位字母、数字或下划线');

/** A1 登录请求（api-contract §3：username 正则；password 1–72 字节，bcrypt 上限） */
export const loginRequestSchema = z.object({
  username: usernameSchema,
  password: z
    .string()
    .min(1, '密码不能为空')
    .refine((value) => utf8ByteLength(value) <= 72, '密码长度不得超过 72 字节（bcrypt 上限）'),
});

export type LoginRequest = z.infer<typeof loginRequestSchema>;

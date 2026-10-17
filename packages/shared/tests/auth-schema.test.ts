import { describe, expect, it } from 'vitest';

import { loginRequestSchema, utf8ByteLength } from '../src/schemas/auth.js';

describe('loginRequestSchema（api-contract A1 请求校验）', () => {
  it('合法请求通过解析', () => {
    const result = loginRequestSchema.safeParse({
      username: 'front01',
      password: 'Plain#2026!',
    });
    expect(result.success).toBe(true);
  });

  it('拒绝非法用户名（过短、非法字符、超长）', () => {
    for (const username of ['ab', 'front-01', 'a'.repeat(51), '前台01']) {
      expect(loginRequestSchema.safeParse({ username, password: 'x' }).success, username).toBe(
        false,
      );
    }
  });

  it('拒绝空密码', () => {
    expect(loginRequestSchema.safeParse({ username: 'front01', password: '' }).success).toBe(false);
  });

  it('密码按 UTF-8 字节数限制 72 字节（而非字符数）', () => {
    // 'a' 为 1 字节：72 通过，73 拒绝
    expect(
      loginRequestSchema.safeParse({ username: 'front01', password: 'a'.repeat(72) }).success,
    ).toBe(true);
    expect(
      loginRequestSchema.safeParse({ username: 'front01', password: 'a'.repeat(73) }).success,
    ).toBe(false);
    // 中文字符 3 字节：24 个 = 72 字节通过，25 个 = 75 字节拒绝
    expect(
      loginRequestSchema.safeParse({ username: 'front01', password: '密'.repeat(24) }).success,
    ).toBe(true);
    expect(
      loginRequestSchema.safeParse({ username: 'front01', password: '密'.repeat(25) }).success,
    ).toBe(false);
  });

  it('utf8ByteLength 与已知编码一致', () => {
    expect(utf8ByteLength('abc')).toBe(3);
    expect(utf8ByteLength('中')).toBe(3);
    expect(utf8ByteLength('😀')).toBe(4);
  });
});

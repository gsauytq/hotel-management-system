import { describe, expect, it } from 'vitest';

import { PASSWORD_HASH_COST, hashPassword, verifyPassword } from '../src/utils/password.js';

describe('密码哈希（ADR-008：bcrypt cost=12，不保存明文）', () => {
  it('生成 bcrypt cost=12 哈希，不含明文', async () => {
    const password = 'Plain#2026!';
    const hashed = await hashPassword(password);

    expect(hashed).toMatch(/^\$2[aby]\$12\$/);
    expect(hashed).not.toContain(password);
    expect(hashed).toHaveLength(60);
    expect(PASSWORD_HASH_COST).toBe(12);
  });

  it('同一密码两次哈希不同（加盐）', async () => {
    const first = await hashPassword('SamePassword1');
    const second = await hashPassword('SamePassword1');
    expect(first).not.toBe(second);
  });

  it('verifyPassword 正确区分正确/错误密码', async () => {
    const hashed = await hashPassword('Correct#12345');
    await expect(verifyPassword('Correct#12345', hashed)).resolves.toBe(true);
    await expect(verifyPassword('Wrong#12345', hashed)).resolves.toBe(false);
  });
});

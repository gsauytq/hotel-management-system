import { describe, expect, it } from 'vitest';

import { loadEnv } from '../src/config/env.js';

const VALID_KEY = Buffer.alloc(32, 1).toString('base64');
const validSource = {
  DATABASE_URL: 'mysql://hms_app:test-only@127.0.0.1:3306/hotel',
  GUEST_ID_HMAC_KEY: VALID_KEY,
  GUEST_ID_CIPHER_KEY: VALID_KEY,
} as NodeJS.ProcessEnv;

describe('loadEnv（ADR-007 fail-fast 环境变量校验）', () => {
  it('缺失 DATABASE_URL 时拒绝启动并指明字段', () => {
    expect(() =>
      loadEnv({
        GUEST_ID_HMAC_KEY: VALID_KEY,
        GUEST_ID_CIPHER_KEY: VALID_KEY,
      } as NodeJS.ProcessEnv),
    ).toThrowError(/DATABASE_URL/);
  });

  it('密钥长度不符时拒绝启动', () => {
    expect(() =>
      loadEnv({ ...validSource, GUEST_ID_CIPHER_KEY: 'short-key' } as NodeJS.ProcessEnv),
    ).toThrowError(/GUEST_ID_CIPHER_KEY/);
  });

  it('DATABASE_URL 非法时拒绝启动', () => {
    expect(() =>
      loadEnv({ ...validSource, DATABASE_URL: 'not-a-url' } as NodeJS.ProcessEnv),
    ).toThrowError(/DATABASE_URL/);
  });

  it('合法环境返回配置与文档默认值（PORT=3000、TTL=8h、LOG_LEVEL=info）', () => {
    const config = loadEnv(validSource);
    expect(config.nodeEnv).toBe('development');
    expect(config.port).toBe(3000);
    expect(config.sessionTtlHours).toBe(8);
    expect(config.logLevel).toBe('info');
    expect(config.migrationDatabaseUrl).toBeUndefined();
  });
});

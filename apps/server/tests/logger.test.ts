import { Writable } from 'node:stream';

import { describe, expect, it } from 'vitest';

import { createLogger } from '../src/utils/logger.js';

function collectDestination(): { destination: Writable; output: () => string } {
  const chunks: string[] = [];
  const destination = new Writable({
    write(chunk, _encoding, callback) {
      chunks.push(String(chunk));
      callback();
    },
  });
  return { destination, output: () => chunks.join('') };
}

describe('pino redact（security-design §9 敏感字段过滤）', () => {
  it('密码、令牌、会话与 Cookie 均输出 [REDACTED]', () => {
    const { destination, output } = collectDestination();
    const logger = createLogger({ nodeEnv: 'test', logLevel: 'info' }, destination);

    logger.info(
      {
        password: 'SuperSecret123',
        newPassword: 'SuperSecret456',
        idNumber: '110101199001011234',
        passwordHash: '$2b$12$hashedvalue',
        token: 'token-abc',
        accessToken: 'access-abc',
        refreshToken: 'refresh-abc',
        sessionId: 'session-abc',
        sid: 'sid-abc',
        nested: { token: 'nested-token' },
        req: {
          headers: {
            cookie: 'hms_sid=abcdef0123456789',
            authorization: 'Bearer dummy.jwt.value',
          },
        },
        res: {
          headers: {
            'set-cookie': 'hms_sid=abcdef0123456789; HttpOnly',
          },
        },
      },
      'login attempt',
    );

    const text = output();
    expect(text).toContain('[REDACTED]');

    const secrets = [
      'SuperSecret123',
      'SuperSecret456',
      '110101199001011234',
      '$2b$12$hashedvalue',
      'token-abc',
      'access-abc',
      'refresh-abc',
      'session-abc',
      'sid-abc',
      'nested-token',
      'hms_sid=abcdef0123456789',
      'Bearer dummy.jwt.value',
    ];
    for (const secret of secrets) {
      expect(text, `敏感值泄漏: ${secret}`).not.toContain(secret);
    }
  });
});

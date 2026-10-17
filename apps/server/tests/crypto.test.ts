import { describe, expect, it } from 'vitest';

import { createGuestCrypto } from '../src/utils/crypto.js';

const base64Key = (fill: number): string => Buffer.alloc(32, fill).toString('base64');

function createCrypto() {
  return createGuestCrypto({
    hmacKeyBase64: base64Key(1),
    cipherKeyBase64: base64Key(2),
  });
}

describe('证件号加密工具（ADR-008：AES-256-GCM + HMAC 查重）', () => {
  it('AES-256-GCM 加解密往返一致（iv 随机；布局 iv(12)‖tag(16)‖密文）', () => {
    const crypto = createCrypto();
    const idNumber = '110101199001011234';
    const first = crypto.encryptIdNumber(idNumber);
    const second = crypto.encryptIdNumber(idNumber);

    expect(first).toBeInstanceOf(Uint8Array);
    expect(first.length).toBe(12 + 16 + Buffer.byteLength(idNumber));
    expect(Buffer.from(first).equals(Buffer.from(second))).toBe(false); // 随机 IV
    expect(crypto.decryptIdNumber(first)).toBe(idNumber);
    expect(crypto.decryptIdNumber(second)).toBe(idNumber);
  });

  it('HMAC-SHA256 确定性（64 hex），密钥不同结果不同', () => {
    const crypto = createCrypto();
    const other = createGuestCrypto({
      hmacKeyBase64: base64Key(3),
      cipherKeyBase64: base64Key(2),
    });
    const idNumber = '110101199001011234';
    const hash = crypto.hashIdNumber(idNumber);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(crypto.hashIdNumber(idNumber)).toBe(hash);
    expect(other.hashIdNumber(idNumber)).not.toBe(hash);
  });

  it('篡改密文导致认证失败（GCM tag 校验）', () => {
    const crypto = createCrypto();
    const payload = crypto.encryptIdNumber('110101199001011234');
    payload[payload.length - 1] = payload[payload.length - 1]! ^ 0xff;
    expect(() => crypto.decryptIdNumber(payload)).toThrow();
  });

  it('密文过短被拒绝', () => {
    const crypto = createCrypto();
    expect(() => crypto.decryptIdNumber(new Uint8Array(10))).toThrowError(/格式非法/);
  });

  it('掩码：前 1 后 1，中间 *，长度与明文一致', () => {
    const crypto = createCrypto();
    expect(crypto.maskIdNumber('110101199001011234')).toBe(`1${'*'.repeat(16)}4`);
    expect(crypto.maskIdNumber('AB123')).toBe('A***3');
    expect(crypto.maskIdNumber('AB')).toBe('**');
    expect(crypto.maskIdNumber('A')).toBe('*');
  });
});

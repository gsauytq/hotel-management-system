import { createCipheriv, createDecipheriv, createHmac, randomBytes } from 'node:crypto';

const IV_LENGTH = 12;
const TAG_LENGTH = 16;

export interface GuestCrypto {
  /** HMAC-SHA256 十六进制（用于 (id_type, hash) 唯一约束查重） */
  hashIdNumber(idNumber: string): string;
  /** AES-256-GCM：iv(12) ‖ tag(16) ‖ ciphertext（database-design §2.5） */
  encryptIdNumber(idNumber: string): Uint8Array<ArrayBuffer>;
  decryptIdNumber(payload: Uint8Array): string;
  /** 掩码：前 1 后 1，中间 *（长度与明文一致） */
  maskIdNumber(idNumber: string): string;
}

/**
 * 证件号加密/查重工具（ADR-008）。密钥来自环境变量（base64 32 字节，启动时已校验）。
 * 明文仅存在于请求瞬间与内存；落库为密文，日志/响应一律不出现明文。
 */
export function createGuestCrypto(options: {
  hmacKeyBase64: string;
  cipherKeyBase64: string;
}): GuestCrypto {
  const hmacKey = Buffer.from(options.hmacKeyBase64, 'base64');
  const cipherKey = Buffer.from(options.cipherKeyBase64, 'base64');

  return {
    hashIdNumber(idNumber) {
      return createHmac('sha256', hmacKey).update(idNumber, 'utf8').digest('hex');
    },

    encryptIdNumber(idNumber) {
      const iv = randomBytes(IV_LENGTH);
      const cipher = createCipheriv('aes-256-gcm', cipherKey, iv);
      const ciphertext = Buffer.concat([cipher.update(idNumber, 'utf8'), cipher.final()]);
      const tag = cipher.getAuthTag();
      const payload = new Uint8Array(IV_LENGTH + TAG_LENGTH + ciphertext.length);
      payload.set(iv, 0);
      payload.set(tag, IV_LENGTH);
      payload.set(ciphertext, IV_LENGTH + TAG_LENGTH);
      return payload;
    },

    decryptIdNumber(payload) {
      if (payload.length < IV_LENGTH + TAG_LENGTH) {
        throw new Error('证件号密文格式非法');
      }
      const iv = Buffer.from(payload.subarray(0, IV_LENGTH));
      const tag = Buffer.from(payload.subarray(IV_LENGTH, IV_LENGTH + TAG_LENGTH));
      const ciphertext = Buffer.from(payload.subarray(IV_LENGTH + TAG_LENGTH));
      const decipher = createDecipheriv('aes-256-gcm', cipherKey, iv);
      decipher.setAuthTag(tag);
      return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
    },

    maskIdNumber(idNumber) {
      if (idNumber.length <= 2) {
        return '*'.repeat(idNumber.length);
      }
      return `${idNumber.slice(0, 1)}${'*'.repeat(idNumber.length - 2)}${idNumber.slice(-1)}`;
    },
  };
}

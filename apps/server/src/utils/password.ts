import { compare, hash } from 'bcryptjs';

/** 密码哈希成本（ADR-008：bcrypt cost=12） */
export const PASSWORD_HASH_COST = 12;

export async function hashPassword(password: string): Promise<string> {
  return hash(password, PASSWORD_HASH_COST);
}

export async function verifyPassword(password: string, passwordHash: string): Promise<boolean> {
  return compare(password, passwordHash);
}

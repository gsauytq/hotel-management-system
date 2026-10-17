import { describe, expect, it } from 'vitest';

import { createGuestSchema, updateGuestSchema } from '../src/guests.js';
import { createUserSchema, resetPasswordSchema, updateUserSchema } from '../src/users.js';

describe('员工 schema（api-contract U2/U3/U4）', () => {
  const validUser = {
    username: 'front02',
    password: 'Init#12345',
    displayName: '李雷',
    role: 'RECEPTIONIST',
  };

  it('合法创建请求通过；角色枚举受限', () => {
    expect(createUserSchema.safeParse(validUser).success).toBe(true);
    expect(createUserSchema.safeParse({ ...validUser, role: 'MANAGER' }).success).toBe(false);
    expect(createUserSchema.safeParse({ ...validUser, username: 'a' }).success).toBe(false);
    expect(createUserSchema.safeParse({ ...validUser, passwordHash: 'x' }).success).toBe(false);
  });

  it('密码策略：≥10 位、≤72 字节、同时含字母与数字', () => {
    expect(createUserSchema.safeParse({ ...validUser, password: 'short1A' }).success).toBe(false);
    expect(createUserSchema.safeParse({ ...validUser, password: 'onlyletters' }).success).toBe(
      false,
    );
    expect(createUserSchema.safeParse({ ...validUser, password: '1234567890' }).success).toBe(
      false,
    );
    expect(createUserSchema.safeParse({ ...validUser, password: 'Valid#12345' }).success).toBe(
      true,
    );
    // 73 个 ASCII 字符 → 超过 bcrypt 72 字节上限
    expect(
      createUserSchema.safeParse({ ...validUser, password: `a1${'x'.repeat(71)}` }).success,
    ).toBe(false);
  });

  it('更新 schema 仅允许 displayName/role/status（不可改用户名/密码）', () => {
    expect(updateUserSchema.safeParse({ displayName: '李雷（值班）', role: 'ADMIN' }).success).toBe(
      true,
    );
    expect(updateUserSchema.safeParse({ status: 'DISABLED' }).success).toBe(true);
    expect(updateUserSchema.safeParse({}).success).toBe(true);
    expect(updateUserSchema.safeParse({ username: 'new_name' }).success).toBe(false);
    expect(updateUserSchema.safeParse({ password: 'Valid#12345' }).success).toBe(false);
  });

  it('重置密码使用同一策略且仅接受 newPassword', () => {
    expect(resetPasswordSchema.safeParse({ newPassword: 'New#Pass1234' }).success).toBe(true);
    expect(resetPasswordSchema.safeParse({ newPassword: 'weak' }).success).toBe(false);
    expect(resetPasswordSchema.safeParse({ password: 'New#Pass1234' }).success).toBe(false);
  });
});

describe('客人 schema（api-contract G2/G4）', () => {
  const validGuest = {
    name: '张三',
    phone: '13800138000',
    idType: 'ID_CARD',
    idNumber: '110101199001011234',
  };

  it('合法创建请求通过（备注可选）', () => {
    expect(createGuestSchema.safeParse(validGuest).success).toBe(true);
    expect(createGuestSchema.safeParse({ ...validGuest, remark: 'VIP 常客' }).success).toBe(true);
  });

  it('手机号支持大陆手机号与 6-20 位国际号码；其余格式拒绝', () => {
    for (const phone of ['13800138000', '+8613800138000', '02162345678', '23800138000']) {
      expect(createGuestSchema.safeParse({ ...validGuest, phone }).success, phone).toBe(true);
    }
    for (const phone of ['12345', '123456789012345678901', 'abc12345678', '+']) {
      expect(createGuestSchema.safeParse({ ...validGuest, phone }).success, phone).toBe(false);
    }
  });

  it('姓名/证件类型/证件号校验', () => {
    expect(createGuestSchema.safeParse({ ...validGuest, name: '' }).success).toBe(false);
    expect(createGuestSchema.safeParse({ ...validGuest, name: 'x'.repeat(101) }).success).toBe(
      false,
    );
    expect(createGuestSchema.safeParse({ ...validGuest, idType: 'DRIVER' }).success).toBe(false);
    expect(createGuestSchema.safeParse({ ...validGuest, idNumber: 'abc' }).success).toBe(false);
    expect(createGuestSchema.safeParse({ ...validGuest, idNumber: 'AB12-CD' }).success).toBe(false);
    expect(
      createGuestSchema.safeParse({ ...validGuest, idNumber: 'P1234567', idType: 'PASSPORT' })
        .success,
    ).toBe(true);
  });

  it('更新 schema 允许 name/phone/remark，并识别证件字段修改意图', () => {
    expect(updateGuestSchema.safeParse({ phone: '13900139000', remark: 'x' }).success).toBe(true);
    expect(updateGuestSchema.safeParse({ name: '张三丰' }).success).toBe(true);
    expect(updateGuestSchema.safeParse({}).success).toBe(true);
    expect(updateGuestSchema.safeParse({ idNumber: '110101199001011234' }).success).toBe(true);
    expect(updateGuestSchema.safeParse({ idType: 'PASSPORT' }).success).toBe(true);
    expect(updateGuestSchema.safeParse({ status: 'ACTIVE' }).success).toBe(false);
  });
});

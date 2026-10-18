import { describe, expect, it } from 'vitest';

import { ERROR_CODES, HTTP_STATUS_BY_ERROR_CODE } from '../src/error-codes.js';
import { ROLES, USER_STATUSES } from '../src/roles.js';

describe('@hms/shared 契约常量（骨架冒烟）', () => {
  it('错误码注册表与 api-contract.md §1.5 数量一致且状态码合法', () => {
    expect(Object.keys(ERROR_CODES)).toHaveLength(22);
    for (const [code, status] of Object.entries(ERROR_CODES)) {
      expect(status, code).toBeGreaterThanOrEqual(400);
      expect(status, code).toBeLessThan(600);
      expect(HTTP_STATUS_BY_ERROR_CODE[code as keyof typeof ERROR_CODES]).toBe(status);
    }
  });

  it('角色与用户状态枚举与 database-design.md 一致', () => {
    expect(ROLES).toEqual(['ADMIN', 'RECEPTIONIST']);
    expect(USER_STATUSES).toEqual(['ACTIVE', 'DISABLED']);
  });
});

import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { ApiError } from '../src/shared/http/ApiError.js';
import {
  buildPagination,
  paginationQueryShape,
  parseSortRules,
  sortQuerySchema,
  toPrismaOrderBy,
  tryParseSortRules,
} from '../src/shared/http/pagination.js';

const listSchema = z.object({
  ...paginationQueryShape(),
  sort: sortQuerySchema(['roomNumber', 'status', 'createdAt']),
});

describe('统一分页参数（api-contract §1.3）', () => {
  it('缺省 page=1、pageSize=20；合法值通过并转换为数字', () => {
    const defaults = listSchema.parse({});
    expect(defaults).toMatchObject({ page: 1, pageSize: 20 });
    expect(defaults.sort).toBeUndefined();

    const parsed = listSchema.parse({ page: '2', pageSize: '50', sort: 'roomNumber:asc' });
    expect(parsed).toMatchObject({ page: 2, pageSize: 50, sort: 'roomNumber:asc' });
  });

  it('非法分页被拒绝（page<1、pageSize>100、非整数）', () => {
    expect(listSchema.safeParse({ page: '0' }).success).toBe(false);
    expect(listSchema.safeParse({ pageSize: '101' }).success).toBe(false);
    expect(listSchema.safeParse({ page: 'abc' }).success).toBe(false);
    expect(listSchema.safeParse({ pageSize: '0' }).success).toBe(false);
  });
});

describe('排序白名单（TC-SEC-008 排序注入防护）', () => {
  it('白名单内字段与方向合法（支持多字段）', () => {
    expect(listSchema.safeParse({ sort: 'roomNumber:asc,createdAt:desc' }).success).toBe(true);
  });

  it('白名单外字段/非法方向/注入载荷 → 422', () => {
    for (const sort of [
      'id:asc',
      'roomNumber:up',
      'roomNumber:asc:extra',
      'roomNumber',
      'roomNumber=asc',
      'roomNumber;DROP TABLE:asc',
      'id;DROP TABLE',
      '',
    ]) {
      const result = listSchema.safeParse({ sort });
      expect(result.success, sort).toBe(false);
    }
  });

  it('tryParseSortRules 返回可读错误', () => {
    const invalid = tryParseSortRules('secret:asc', ['roomNumber']);
    expect(invalid.ok).toBe(false);
    if (!invalid.ok) {
      expect(invalid.message).toContain('roomNumber');
    }
    const valid = tryParseSortRules('roomNumber:desc', ['roomNumber']);
    expect(valid).toEqual({ ok: true, rules: [{ field: 'roomNumber', direction: 'desc' }] });
  });

  it('parseSortRules 缺省用回退排序；非法（绕过 schema 时）抛 422 ApiError', () => {
    expect(
      parseSortRules(undefined, ['roomNumber'], [{ field: 'roomNumber', direction: 'asc' }]),
    ).toEqual([{ field: 'roomNumber', direction: 'asc' }]);

    try {
      parseSortRules('id:asc', ['roomNumber'], []);
      expect.unreachable('应抛出 ApiError');
    } catch (error) {
      expect(error).toBeInstanceOf(ApiError);
      expect(error).toMatchObject({ code: 'VALIDATION_FAILED', status: 422 });
    }
  });

  it('toPrismaOrderBy 映射为固定列名对象', () => {
    expect(
      toPrismaOrderBy([
        { field: 'roomNumber', direction: 'asc' },
        { field: 'createdAt', direction: 'desc' },
      ]),
    ).toEqual([{ roomNumber: 'asc' }, { createdAt: 'desc' }]);
  });
});

describe('分页响应构造', () => {
  it('totalPages = ceil(total/pageSize)，空结果 totalPages=0', () => {
    expect(buildPagination(1, 20, 57)).toEqual({ page: 1, pageSize: 20, total: 57, totalPages: 3 });
    expect(buildPagination(2, 20, 40)).toEqual({
      page: 2,
      pageSize: 20,
      total: 40,
      totalPages: 2,
    });
    expect(buildPagination(1, 20, 0)).toEqual({ page: 1, pageSize: 20, total: 0, totalPages: 0 });
  });
});

import { z } from 'zod';

import type { Pagination } from '@hms/shared';

import { ApiError } from './ApiError.js';

export const DEFAULT_PAGE = 1;
export const DEFAULT_PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 100;

/** 统一分页参数（api-contract §1.3：page≥1 默认 1；pageSize 1–100 默认 20） */
export function paginationQueryShape() {
  return {
    page: z.coerce.number().int('页码必须为整数').min(1, '页码最小为 1').default(DEFAULT_PAGE),
    pageSize: z.coerce
      .number()
      .int('每页条数必须为整数')
      .min(1, '每页条数最小为 1')
      .max(MAX_PAGE_SIZE, `每页条数最大为 ${MAX_PAGE_SIZE}`)
      .default(DEFAULT_PAGE_SIZE),
  };
}

export interface SortRule {
  field: string;
  direction: 'asc' | 'desc';
}

export type SortParseResult = { ok: true; rules: SortRule[] } | { ok: false; message: string };

/**
 * 解析 `sort=field:asc,other:desc`。字段必须在白名单内（排序注入防护，TC-SEC-008），
 * 排序字段不会进入 SQL，仅映射为固定列名。
 */
export function tryParseSortRules(
  value: string,
  allowedFields: readonly string[],
): SortParseResult {
  const rules: SortRule[] = [];
  for (const part of value.split(',')) {
    const segments = part.split(':');
    const field = segments[0];
    const direction = segments[1];
    if (
      segments.length !== 2 ||
      field === undefined ||
      field.length === 0 ||
      direction === undefined ||
      !allowedFields.includes(field)
    ) {
      return { ok: false, message: `排序字段非法（白名单：${allowedFields.join(', ')}）` };
    }
    if (direction !== 'asc' && direction !== 'desc') {
      return { ok: false, message: '排序方向必须为 asc 或 desc' };
    }
    rules.push({ field, direction });
  }
  return { ok: true, rules };
}

/** 供路由 query schema 使用：校验 sort 参数（失败 → 422 VALIDATION_FAILED） */
export function sortQuerySchema(allowedFields: readonly string[]) {
  return z
    .string()
    .max(200, '排序参数过长')
    .optional()
    .superRefine((value, ctx) => {
      if (value === undefined) return;
      const result = tryParseSortRules(value, allowedFields);
      if (!result.ok) {
        ctx.addIssue({ code: 'custom', message: result.message });
      }
    });
}

/** 服务层使用：已通过 schema 校验的 sort 字符串 → 排序规则（缺省回退默认排序） */
export function parseSortRules(
  value: string | undefined,
  allowedFields: readonly string[],
  fallback: readonly SortRule[],
): SortRule[] {
  if (value === undefined) return [...fallback];
  const result = tryParseSortRules(value, allowedFields);
  if (!result.ok) {
    throw ApiError.validation('参数校验失败', [{ field: 'sort', message: result.message }]);
  }
  return result.rules;
}

/** Prisma orderBy（动态键）；仓库层负责与具体 model 的 orderBy 类型对齐 */
export function toPrismaOrderBy(rules: readonly SortRule[]): Record<string, 'asc' | 'desc'>[] {
  return rules.map((rule) => ({ [rule.field]: rule.direction }));
}

export function buildPagination(page: number, pageSize: number, total: number): Pagination {
  return {
    page,
    pageSize,
    total,
    totalPages: total === 0 ? 0 : Math.ceil(total / pageSize),
  };
}

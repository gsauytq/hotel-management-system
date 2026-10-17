import { describe, expect, it, vi } from 'vitest';

import { createDatabasePing } from '../src/lib/prisma.js';
import type { PrismaClient } from '../src/generated/prisma/client.js';

type QueryRawMock = (strings: TemplateStringsArray, ...values: unknown[]) => Promise<unknown>;

function fakePrisma(queryRaw: QueryRawMock): PrismaClient {
  return { $queryRaw: queryRaw } as unknown as PrismaClient;
}

describe('createDatabasePing（健康检查必须真实查询数据库）', () => {
  it('执行 SELECT 1 参数化查询并在成功时解析', async () => {
    const queryRaw = vi.fn(async (_strings: TemplateStringsArray, ..._values: unknown[]) => [
      { '1': 1 },
    ]);
    const ping = createDatabasePing(fakePrisma(queryRaw));

    await expect(ping()).resolves.toBeUndefined();
    expect(queryRaw).toHaveBeenCalledTimes(1);

    const firstCall = queryRaw.mock.calls[0];
    expect(firstCall?.[0].join('?')).toBe('SELECT 1');
  });

  it('查询失败时向上抛出（不允许吞掉异常伪装成功）', async () => {
    const queryRaw = vi.fn(async (_strings: TemplateStringsArray, ..._values: unknown[]) => {
      throw new Error('connection refused');
    });
    const ping = createDatabasePing(fakePrisma(queryRaw));

    await expect(ping()).rejects.toThrowError('connection refused');
  });

  it('查询挂起时按超时失败，不无限等待', async () => {
    const queryRaw = vi.fn((_strings: TemplateStringsArray, ..._values: unknown[]) => {
      return new Promise<never>(() => undefined);
    });
    const ping = createDatabasePing(fakePrisma(queryRaw), 20);

    await expect(ping()).rejects.toThrowError(/超时/);
  });
});

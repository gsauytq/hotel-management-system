import { describe, expect, it } from 'vitest';

import {
  addMoney,
  fromCents,
  minMoney,
  multiplyMoney,
  subtractMoney,
  toCents,
} from '../src/utils/money.js';

describe('货币精确运算（禁止浮点累计）', () => {
  it('加减法消除浮点漂移（0.1 + 0.2 = 0.3）', () => {
    expect(addMoney(0.1, 0.2)).toBe(0.3);
    expect(addMoney(288.01, 38.02, 0.97)).toBe(327);
    expect(subtractMoney(0.3, 0.1)).toBe(0.2);
    expect(subtractMoney(614.0, 576.0)).toBe(38);
  });

  it('整数倍乘法精确（0.1 × 3 = 0.3）', () => {
    expect(multiplyMoney(0.1, 3)).toBe(0.3);
    expect(multiplyMoney(288.01, 3)).toBe(864.03);
    expect(multiplyMoney(33.33, 3)).toBe(99.99);
    expect(multiplyMoney(99999.99, 2)).toBe(199999.98);
  });

  it('累加大量两位小数不漂移（循环累计等价于整数分累加）', () => {
    let total = 0;
    for (let index = 0; index < 1000; index += 1) {
      total = addMoney(total, 0.01);
    }
    expect(total).toBe(10);
  });

  it('分与元互转与边界', () => {
    expect(toCents(0.01)).toBe(1);
    expect(toCents(99999.99)).toBe(9999999);
    expect(fromCents(1)).toBe(0.01);
    expect(minMoney(100, 38.5)).toBe(38.5);
  });

  it('非整数倍数被拒绝（防止意外四舍五入）', () => {
    expect(() => multiplyMoney(100, 1.5)).toThrowError(/整数/);
  });
});

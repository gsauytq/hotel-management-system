import { describe, expect, it } from 'vitest';

import {
  addDaysToDateOnly,
  formatDateOnly,
  hotelDateOf,
  hotelDayStartUtc,
  hotelToday,
  nightsBetween,
  toDateOnly,
} from '../src/utils/hotel-date.js';

describe('酒店日历日（A-10：Asia/Shanghai，不依赖服务器进程时区）', () => {
  it('hotelToday 按上海时区跨日换算', () => {
    // 上海 2026-10-14 23:59:59
    expect(hotelToday(new Date('2026-10-14T15:59:59.000Z'))).toBe('2026-10-14');
    // 上海 2026-10-15 00:00:00（UTC 前一日 16:00）
    expect(hotelToday(new Date('2026-10-14T16:00:00.000Z'))).toBe('2026-10-15');
    // 上海 2026-01-01 08:00
    expect(hotelToday(new Date('2026-01-01T00:00:00.000Z'))).toBe('2026-01-01');
  });

  it('hotelDateOf：UTC 时间戳 → 酒店本地日历日（凌晨入住不多计一晚，审查 P-1）', () => {
    // 上海 2026-10-15 00:30（UTC 2026-10-14 16:30）
    expect(hotelDateOf(new Date('2026-10-14T16:30:00.000Z'))).toBe('2026-10-15');
    // 上海 2026-10-14 23:59:59（UTC 2026-10-14 15:59:59）
    expect(hotelDateOf(new Date('2026-10-14T15:59:59.000Z'))).toBe('2026-10-14');
    // 白天入住：UTC 与本地同一日
    expect(hotelDateOf(new Date('2026-10-14T06:02:11.000Z'))).toBe('2026-10-14');
  });

  it('DATE 字段字符串互转固定 UTC 零点（写入/读取不受本地时区影响）', () => {
    const date = toDateOnly('2026-10-15');
    expect(date.toISOString()).toBe('2026-10-15T00:00:00.000Z');
    expect(formatDateOnly(date)).toBe('2026-10-15');
  });

  it('nightsBetween 为日历日晚数（跨月/跨年边界）', () => {
    expect(nightsBetween('2026-10-15', '2026-10-17')).toBe(2);
    expect(nightsBetween('2026-12-31', '2027-01-01')).toBe(1);
    expect(nightsBetween('2027-02-28', '2027-03-01')).toBe(1);
  });

  it('hotelDayStartUtc：酒店本地日 00:00 = 前一日 16:00Z（Asia/Shanghai 固定 +08:00）', () => {
    expect(hotelDayStartUtc('2026-10-15').toISOString()).toBe('2026-10-14T16:00:00.000Z');
    expect(hotelDayStartUtc('2026-01-01').toISOString()).toBe('2025-12-31T16:00:00.000Z');
  });

  it('addDaysToDateOnly：跨月/跨年加减', () => {
    expect(addDaysToDateOnly('2026-10-31', 1)).toBe('2026-11-01');
    expect(addDaysToDateOnly('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDaysToDateOnly('2026-01-01', -1)).toBe('2025-12-31');
  });
});

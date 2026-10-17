import { describe, expect, it } from 'vitest';

import { addDays, hotelToday, nightsBetween, toLocalDateOnly } from '../src/utils/hotel-date';

describe('酒店日历日工具', () => {
  it('按 Asia/Shanghai 计算酒店今日（跨 UTC 日期边界）', () => {
    expect(hotelToday(new Date('2026-10-17T15:59:59.000Z'))).toBe('2026-10-17');
    expect(hotelToday(new Date('2026-10-17T16:00:00.000Z'))).toBe('2026-10-18');
    expect(hotelToday(new Date('2026-10-17T00:30:00.000Z'))).toBe('2026-10-17');
  });

  it('日历日加减与晚数计算不依赖浏览器时区', () => {
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01');
    expect(addDays('2026-10-15', -1)).toBe('2026-10-14');
    expect(nightsBetween('2026-10-15', '2026-10-17')).toBe(2);
    expect(nightsBetween('2026-10-17', '2026-10-15')).toBe(0);
  });

  it('DatePicker 日期转换为本地 YYYY-MM-DD', () => {
    expect(toLocalDateOnly(new Date(2026, 9, 7))).toBe('2026-10-07');
  });
});

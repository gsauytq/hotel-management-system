/** 酒店业务日历日与时间戳处理（假设 A-10：日历日按 Asia/Shanghai，时间戳 UTC 存储） */

export const HOTEL_TIME_ZONE = 'Asia/Shanghai';

const hotelDateFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: HOTEL_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** 时间戳（UTC 存储）→ 酒店本地日历日（YYYY-MM-DD，Asia/Shanghai） */
export function hotelDateOf(timestamp: Date): string {
  return hotelDateFormatter.format(timestamp);
}

/** 酒店本地“今日”（YYYY-MM-DD），不依赖服务器进程时区 */
export function hotelToday(now: Date = new Date()): string {
  return hotelDateOf(now);
}

/** DATE 字段（Prisma @db.Date 以 UTC 零点返回）→ YYYY-MM-DD */
export function formatDateOnly(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** YYYY-MM-DD → UTC 零点 Date（写入 DATE 字段；避免服务器时区漂移） */
export function toDateOnly(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

/** 日历日晚数（左闭右开区间），基于 UTC 零点整数运算 */
export function nightsBetween(checkInDate: string, checkOutDate: string): number {
  const milliseconds = toDateOnly(checkOutDate).getTime() - toDateOnly(checkInDate).getTime();
  return Math.round(milliseconds / 86_400_000);
}

/** 枚举日期区间 [from, toExclusive) 的每一天（YYYY-MM-DD），用于按日生成占用行 */
export function enumerateDateRange(from: string, toExclusive: string): string[] {
  const dates: string[] = [];
  const end = toDateOnly(toExclusive).getTime();
  for (let cursor = toDateOnly(from).getTime(); cursor < end; cursor += 86_400_000) {
    dates.push(new Date(cursor).toISOString().slice(0, 10));
  }
  return dates;
}

/** 日历日加减（YYYY-MM-DD，基于 UTC 零点字符串运算） */
export function addDaysToDateOnly(date: string, days: number): string {
  return new Date(toDateOnly(date).getTime() + days * 86_400_000).toISOString().slice(0, 10);
}

/**
 * 酒店本地日历日的 UTC 起点（用于按“账单日期”等业务日过滤时间戳字段）。
 * Asia/Shanghai 自 1991 年起无夏令时，固定 +08:00（假设 A-10）。
 */
export function hotelDayStartUtc(date: string): Date {
  return new Date(`${date}T00:00:00+08:00`);
}

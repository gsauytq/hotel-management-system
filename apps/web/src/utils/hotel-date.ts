const HOTEL_TIME_ZONE = 'Asia/Shanghai';

/** 酒店本地日历日（Asia/Shanghai）YYYY-MM-DD，与后端 hotelToday 语义一致 */
export function hotelToday(now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: HOTEL_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const valueOf = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((part) => part.type === type)?.value ?? '';
  return `${valueOf('year')}-${valueOf('month')}-${valueOf('day')}`;
}

/** 酒店日历日加减（按 UTC 零点计算，避免本地时区偏移） */
export function addDays(dateOnly: string, days: number): string {
  const date = new Date(`${dateOnly}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** 日历日差（晚数）；日期格式须为 YYYY-MM-DD */
export function nightsBetween(checkInDate: string, checkOutDate: string): number {
  const checkIn = Date.parse(`${checkInDate}T00:00:00.000Z`);
  const checkOut = Date.parse(`${checkOutDate}T00:00:00.000Z`);
  if (Number.isNaN(checkIn) || Number.isNaN(checkOut)) return 0;
  return Math.max(0, Math.round((checkOut - checkIn) / 86_400_000));
}

/** DatePicker 回调中的本地日历日（用户看到的日历日期） */
export function toLocalDateOnly(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

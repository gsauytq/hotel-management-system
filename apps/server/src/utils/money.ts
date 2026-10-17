/**
 * 货币精确运算（关键要求：禁止用普通浮点数直接累计货币金额）。
 *
 * 内部统一转换为「分」（整数）后计算，再还原为两位小数的 number：
 * - 金额来源均为数据库 DECIMAL(10,2)（最多两位小数），toCents 经四舍五入后为精确整数；
 * - 加减乘（整数倍）在安全整数范围内完全精确，避免 0.1+0.2 / 0.1*3 之类浮点漂移；
 * - 与数据库交互的金额仍以 Prisma Decimal（DECIMAL(10,2)）读写（见 stays/bookings 仓储）。
 */
export function toCents(amount: number): number {
  return Math.round(amount * 100);
}

export function fromCents(cents: number): number {
  return cents / 100;
}

export function addMoney(...amounts: number[]): number {
  return fromCents(amounts.reduce((sum, amount) => sum + toCents(amount), 0));
}

export function subtractMoney(minuend: number, subtrahend: number): number {
  return fromCents(toCents(minuend) - toCents(subtrahend));
}

/** 金额 × 整数倍（如 房价 × 晚数 × 房间数；multiplier 必须为整数） */
export function multiplyMoney(amount: number, multiplier: number): number {
  if (!Number.isInteger(multiplier)) {
    throw new Error(`金额倍数必须为整数：${multiplier}`);
  }
  return fromCents(toCents(amount) * multiplier);
}

export function minMoney(left: number, right: number): number {
  return Math.min(left, right);
}

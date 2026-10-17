import { z } from 'zod';

/** 金额必须为两位以内小数（DECIMAL(10,2) 语义） */
export function hasAtMostTwoDecimals(value: number): boolean {
  return Math.abs(value * 100 - Math.round(value * 100)) < 1e-6;
}

/** 金额 schema 工厂：[min, max]、最多两位小数 */
export function moneySchema(min: number, max: number, label: string) {
  return z
    .number()
    .min(min, `${label}不能小于 ${min}`)
    .max(max, `${label}超出上限`)
    .refine(hasAtMostTwoDecimals, `${label}最多两位小数`);
}

function isRealCalendarDate(value: string): boolean {
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

/** 酒店日历日（YYYY-MM-DD，Asia/Shanghai 语义，见假设 A-10） */
export const dateOnlySchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, '日期格式须为 YYYY-MM-DD')
  .refine(isRealCalendarDate, '日期不存在');

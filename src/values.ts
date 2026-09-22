import { WrappError } from './errors.js';

declare const decimalBrand: unique symbol;
declare const dateBrand: unique symbol;
/** Nonnegative exact decimal; maximum 18 integer / 2 fractional digits. */
export type Decimal = string & { readonly [decimalBrand]: true };
export type CalendarDate = string & { readonly [dateBrand]: true };

export function decimal(value: string): Decimal {
  if (typeof value !== 'string' || !/^(0|[1-9]\d{0,17})(\.\d{1,2})?$/.test(value)) {
    throw new WrappError('INVALID_INPUT', 'decimal');
  }
  return value as Decimal;
}
export function isCalendarDate(value: string): boolean {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const year = Number(value.slice(0, 4)),
    month = Number(value.slice(5, 7)),
    day = Number(value.slice(8));
  if (year < 1 || month < 1 || month > 12 || day < 1) return false;
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
  return days !== undefined && day <= days;
}
export function calendarDate(value: string): CalendarDate {
  if (!isCalendarDate(value)) throw new WrappError('INVALID_INPUT', 'calendarDate');
  return value as CalendarDate;
}
export function freeze<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}

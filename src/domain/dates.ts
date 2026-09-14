import type { ISODate } from './types';

/** 每天下午 3 点截止（本地时间） */
export const CUTOFF_HOUR = 15;

/**
 * 这个文件全部用 Date 的本地时间方法（getFullYear/getMonth/getDate/getHours），
 * 刻意不用 toISOString —— 那是 UTC，会把日期搞错。
 */

export function formatLocalDate(d: Date): ISODate {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function parseLocalDate(s: ISODate): Date {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function todayOf(now: Date): ISODate {
  return formatLocalDate(now);
}

export function addDays(date: ISODate, n: number): ISODate {
  const d = parseLocalDate(date);
  d.setDate(d.getDate() + n);
  return formatLocalDate(d);
}

/** 某天的餐，前一天 15:00（本地时间）截止 */
export function cutoffFor(date: ISODate): Date {
  const d = parseLocalDate(date);
  d.setDate(d.getDate() - 1);
  d.setHours(CUTOFF_HOUR, 0, 0, 0);
  return d;
}

/** 到点没？now >= 截止时刻 就锁定 */
export function isLocked(date: ISODate, now: Date): boolean {
  return now.getTime() >= cutoffFor(date).getTime();
}

/** 所在周的周一（周日算本周） */
export function mondayOf(date: ISODate): ISODate {
  const d = parseLocalDate(date);
  const offset = (d.getDay() + 6) % 7; // 周一=0 … 周日=6
  d.setDate(d.getDate() - offset);
  return formatLocalDate(d);
}

/** 周一到周五 5 天 */
export function weekDates(monday: ISODate): ISODate[] {
  return [0, 1, 2, 3, 4].map((i) => addDays(monday, i));
}

export const WEEKDAY_NAMES = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];

export function weekdayName(date: ISODate): string {
  return WEEKDAY_NAMES[(parseLocalDate(date).getDay() + 6) % 7];
}

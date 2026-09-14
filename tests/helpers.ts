import { weekDates } from '../src/domain/dates';
import type { MenuWeek } from '../src/domain/types';

/** 造一周菜单：周一到周五，A 餐 priceA 元、B 餐 priceB 元 */
export function makeMenu(monday: string, priceA = 15, priceB = 14): MenuWeek {
  return {
    id: monday,
    publishedAt: '2026-09-10T02:00:00.000Z',
    days: weekDates(monday).map((date, i) => ({
      date,
      A: { name: `A${i + 1}套餐`, price: priceA },
      B: { name: `B${i + 1}套餐`, price: priceB },
    })),
  };
}

/** 构造本地时间（故意不用 UTC，和窗口机器上的行为一致） */
export function local(y: number, m: number, d: number, h = 0, min = 0, s = 0): Date {
  return new Date(y, m - 1, d, h, min, s);
}

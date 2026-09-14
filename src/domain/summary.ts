import { effectiveStatus } from './codes';
import { addDays, mondayOf, weekDates } from './dates';
import type { Choice, ISODate, Order, Store } from './types';

/** 某一天的份数汇总：A/B 各多少份、取了多少、作废多少 */
export interface DaySummary {
  date: ISODate;
  A: number;
  B: number;
  total: number;
  redeemed: number;
  /** 订了还没取（对今天来说就是还在等的） */
  pending: number;
  /** 过期未取，自动作废的 */
  void: number;
}

export function dailySummary(orders: Order[], date: ISODate, today: ISODate): DaySummary {
  const s: DaySummary = { date, A: 0, B: 0, total: 0, redeemed: 0, pending: 0, void: 0 };
  for (const o of orders) {
    if (o.date !== date) continue;
    s[o.choice] += 1;
    s.total += 1;
    const st = effectiveStatus(o, today);
    if (st === 'redeemed') s.redeemed += 1;
    else if (st === 'void') s.void += 1;
    else s.pending += 1;
  }
  return s;
}

export interface NoShow {
  name: string;
  empId?: string;
  date: ISODate;
  choice: Choice;
}

export interface WeekReport {
  monday: ISODate;
  days: DaySummary[];
  /** 订了没取的人，按日期排 */
  noShows: NoShow[];
}

export function weeklyReport(orders: Order[], monday: ISODate, today: ISODate): WeekReport {
  const days = weekDates(monday).map((d) => dailySummary(orders, d, today));
  const lastDay = addDays(monday, 4);
  const noShows: NoShow[] = [];
  for (const o of orders) {
    if (o.date < monday || o.date > lastDay) continue;
    if (effectiveStatus(o, today) === 'void') {
      noShows.push({ name: o.name, empId: o.empId, date: o.date, choice: o.choice });
    }
  }
  noShows.sort((a, b) =>
    a.date !== b.date ? (a.date < b.date ? -1 : 1) : a.name.localeCompare(b.name, 'zh'),
  );
  return { monday, days, noShows };
}

/** 只保留最近 keepWeeks 周（含本周），更早的菜单和订单删掉 */
export function purgeOld(store: Store, today: ISODate, keepWeeks = 8): Store {
  const cutoffMonday = addDays(mondayOf(today), -7 * keepWeeks);
  return {
    menus: store.menus.filter((m) => m.id >= cutoffMonday),
    orders: store.orders.filter((o) => o.date >= cutoffMonday),
  };
}

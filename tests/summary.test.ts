import { describe, expect, it } from 'vitest';
import { dailySummary, purgeOld, weeklyReport } from '../src/domain/summary';
import type { Order } from '../src/domain/types';
import { makeMenu } from './helpers';

function makeOrder(over: Partial<Order>): Order {
  return {
    id: over.id ?? Math.random().toString(36).slice(2),
    personKey: over.personKey ?? `E:${over.empId ?? 'E000'}`,
    name: over.name ?? '某人',
    empId: over.empId,
    date: over.date ?? '2026-09-14',
    choice: over.choice ?? 'A',
    price: over.price ?? 15,
    code: over.code ?? '000000',
    status: over.status ?? 'active',
    createdAt: '2026-09-10T02:00:00.000Z',
    updatedAt: '2026-09-10T02:00:00.000Z',
    redeemedAt: over.redeemedAt,
  };
}

describe('当日汇总', () => {
  const orders: Order[] = [
    makeOrder({ name: '张三', empId: 'E001', date: '2026-09-15', choice: 'A', code: '100001' }),
    makeOrder({ name: '李四', empId: 'E002', date: '2026-09-15', choice: 'A', code: '100002' }),
    makeOrder({ name: '王五', date: '2026-09-15', choice: 'B', code: '100003' }),
    makeOrder({ name: '赵六', empId: 'E003', date: '2026-09-16', choice: 'B', code: '100004' }),
  ];

  it('一眼看到某天 A 几份、B 几份', () => {
    const s = dailySummary(orders, '2026-09-15', '2026-09-14');
    expect(s.A).toBe(2);
    expect(s.B).toBe(1);
    expect(s.total).toBe(3);
    expect(s.pending).toBe(3);
    expect(s.redeemed).toBe(0);
  });

  it('取了的、作废的分开算', () => {
    const mixed: Order[] = [
      makeOrder({ date: '2026-09-14', choice: 'A', status: 'redeemed', code: '200001' }),
      makeOrder({ date: '2026-09-14', choice: 'A', status: 'active', code: '200002' }), // 当天还没取
      makeOrder({ date: '2026-09-14', choice: 'B', status: 'active', code: '200003' }),
    ];
    const s = dailySummary(mixed, '2026-09-14', '2026-09-14');
    expect(s.redeemed).toBe(1);
    expect(s.pending).toBe(2);
    expect(s.void).toBe(0);
    // 到了第二天，昨天没取的两单自动算作废
    const next = dailySummary(mixed, '2026-09-14', '2026-09-15');
    expect(next.void).toBe(2);
    expect(next.pending).toBe(0);
  });
});

describe('周报', () => {
  it('列出谁订了没取', () => {
    const monday = '2026-09-07'; // 上上周一
    const orders: Order[] = [
      makeOrder({ name: '张三', empId: 'E001', date: '2026-09-07', choice: 'A', status: 'redeemed', code: '300001' }),
      makeOrder({ name: '李四', empId: 'E002', date: '2026-09-08', choice: 'B', status: 'active', code: '300002' }), // 没取
      makeOrder({ name: '王五', date: '2026-09-08', choice: 'A', status: 'active', code: '300003' }), // 没取
      makeOrder({ name: '赵六', empId: 'E003', date: '2026-09-09', choice: 'A', status: 'redeemed', code: '300004' }),
    ];
    const r = weeklyReport(orders, monday, '2026-09-14');
    expect(r.noShows.map((n) => n.name)).toEqual(['李四', '王五']);
    expect(r.noShows[0]).toMatchObject({ date: '2026-09-08', choice: 'B', empId: 'E002' });
    // 本周的不算进来
    const thisWeek = weeklyReport(orders, '2026-09-14', '2026-09-14');
    expect(thisWeek.noShows).toEqual([]);
  });
});

describe('8 周留存', () => {
  it('超过 8 周的菜单和订单被清掉，边界上的保留', () => {
    const today = '2026-09-14'; // 周一
    const store = {
      menus: [makeMenu('2026-07-13'), makeMenu('2026-07-20'), makeMenu('2026-09-14')],
      orders: [
        makeOrder({ date: '2026-07-19', code: '400001' }), // 9 周前，清掉
        makeOrder({ date: '2026-07-20', code: '400002' }), // 正好 8 周前的周一，保留
        makeOrder({ date: '2026-09-14', code: '400003' }),
      ],
      secrets: {},
    };
    const kept = purgeOld(store, today, 8);
    expect(kept.menus.map((m) => m.id)).toEqual(['2026-07-20', '2026-09-14']);
    expect(kept.orders.map((o) => o.code)).toEqual(['400002', '400003']);
  });
});

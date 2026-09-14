import { describe, expect, it } from 'vitest';
import { codesForDate, redeem, sweepVoids } from '../src/domain/codes';
import { formatLocalDate } from '../src/domain/dates';
import { applyBatch } from '../src/domain/orders';
import { dailySummary, weeklyReport } from '../src/domain/summary';
import type { MenuWeek, Order } from '../src/domain/types';
import { local, makeMenu } from './helpers';

/**
 * 老板自己走一遍的那条验收路线：
 * 发菜单 → 订三天的餐 → 拿码 → 核销 → 故意重复核销 → 看次日汇总
 */
describe('全流程走一遍', () => {
  it('发菜单、订三天、拿码、核销、重复核销被拦、次日汇总', () => {
    // ---- 周四（2026-09-17）发布下周菜单 ----
    const menu: MenuWeek = makeMenu('2026-09-21');
    const menus = [menu];
    let orders: Order[] = [];
    const thursday = local(2026, 9, 17, 10, 0);

    // ---- 张三订下周一二三的餐（A、B、A），李四订周一 A、周二 B ----
    const r1 = applyBatch(
      orders,
      menus,
      { name: '张三', empId: 'E001' },
      [
        { type: 'place', date: '2026-09-21', choice: 'A' },
        { type: 'place', date: '2026-09-22', choice: 'B' },
        { type: 'place', date: '2026-09-23', choice: 'A' },
      ],
      thursday,
    );
    if (!r1.ok) throw new Error(`张三下单失败: ${r1.error}`);
    orders = r1.orders;

    const r2 = applyBatch(
      orders,
      menus,
      { name: '李四', empId: 'E002' },
      [
        { type: 'place', date: '2026-09-21', choice: 'A' },
        { type: 'place', date: '2026-09-22', choice: 'B' },
      ],
      thursday,
    );
    if (!r2.ok) throw new Error(`李四下单失败: ${r2.error}`);
    orders = r2.orders;

    // ---- 拿码：一人一天一个码，6 位，当天不重复 ----
    const zsOrders = orders.filter((o) => o.name === '张三');
    expect(zsOrders).toHaveLength(3);
    for (const o of orders) expect(o.code).toMatch(/^\d{6}$/);
    expect(codesForDate(orders, '2026-09-21').size).toBe(2); // 张三、李四各一个，当天不重号

    // ---- 截止后（周日 15:00 一过）想改周一的餐，改不了 ----
    const afterCutoff = local(2026, 9, 20, 15, 0, 1);
    const locked = applyBatch(
      orders,
      menus,
      { name: '张三', empId: 'E001' },
      [{ type: 'change', id: zsOrders[0].id, choice: 'B' }],
      afterCutoff,
    );
    expect(locked).toMatchObject({ ok: false, error: 'locked' });

    // ---- 周一中午：张三到窗口，报码核销 ----
    const mondayNoon = local(2026, 9, 21, 12, 0);
    const today = formatLocalDate(mondayNoon);
    const zsMonday = orders.find((o) => o.name === '张三' && o.date === today)!;
    const hit = orders.find((o) => o.date === today && o.code === zsMonday.code)!;
    const redeemed = redeem(hit, today, mondayNoon);
    expect(redeemed.ok).toBe(true);
    if (!redeemed.ok) return;
    orders = orders.map((o) => (o.id === redeemed.order.id ? redeemed.order : o));

    // ---- 故意重复核销：同一个码再输，必须拦住 ----
    const again = redeem(orders.find((o) => o.id === hit.id)!, today, local(2026, 9, 21, 12, 20));
    expect(again).toMatchObject({ ok: false, error: 'already_redeemed' });

    // ---- 看次日（周二）汇总：B 餐 2 份（张三、李四），A 餐 0 份 ----
    const tue = dailySummary(orders, '2026-09-22', today);
    expect(tue.A).toBe(0);
    expect(tue.B).toBe(2);
    expect(tue.total).toBe(2);

    // 当天（周一）汇总：A 2 份，已取 1
    const mon = dailySummary(orders, today, today);
    expect(mon.A).toBe(2);
    expect(mon.redeemed).toBe(1);
    expect(mon.pending).toBe(1); // 李四还没来

    // ---- 一周后回头看周报：周一李四没取、周二张三李四都没取，全在名单上 ----
    const nextMonday = local(2026, 9, 28, 9, 0);
    orders = sweepVoids(orders, formatLocalDate(nextMonday), nextMonday);
    const report = weeklyReport(orders, '2026-09-21', formatLocalDate(nextMonday));
    const names = report.noShows.map((n) => `${n.date}:${n.name}`);
    expect(names).toContain('2026-09-21:李四');
    expect(names).toContain('2026-09-22:张三');
    expect(names).toContain('2026-09-22:李四');
    expect(names).toContain('2026-09-23:张三');
    expect(report.noShows).toHaveLength(4);
  });
});

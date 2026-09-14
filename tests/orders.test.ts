import { describe, expect, it } from 'vitest';
import { applyBatch, cancelOrder, changeOrder, placeOrder, planChanges } from '../src/domain/orders';
import { local, makeMenu } from './helpers';

const monday = '2026-09-21';
const menu = makeMenu(monday);
const now = local(2026, 9, 17, 10, 0); // 周四上午，下周的餐随便订

describe('下单', () => {
  it('下单成功：价格快照、6 位取餐码、状态 active', () => {
    const r = placeOrder([], [menu], { name: '张三', empId: 'E001' }, '2026-09-21', 'A', now);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.price).toBe(15);
    expect(r.value.code).toMatch(/^\d{6}$/);
    expect(r.value.status).toBe('active');
    expect(r.value.personKey).toBe('E:E001');
  });

  it('一人一天只能订一单', () => {
    const first = placeOrder([], [menu], { name: '张三' }, '2026-09-21', 'A', now);
    if (!first.ok) throw new Error('setup 失败');
    const dup = placeOrder([first.value], [menu], { name: '张三' }, '2026-09-21', 'B', now);
    expect(dup).toMatchObject({ ok: false, error: 'duplicate' });
  });

  it('同一个工号换个名字也算同一个人', () => {
    const a = placeOrder([], [menu], { name: '张三', empId: 'E001' }, '2026-09-21', 'A', now);
    if (!a.ok) throw new Error('setup 失败');
    const b = placeOrder([a.value], [menu], { name: '张三丰', empId: 'E001' }, '2026-09-21', 'B', now);
    expect(b).toMatchObject({ ok: false, error: 'duplicate' });
  });

  it('没发布菜单的日期不能订', () => {
    const r = placeOrder([], [menu], { name: '张三' }, '2026-09-28', 'A', now);
    expect(r).toMatchObject({ ok: false, error: 'no_menu' });
  });

  it('改套餐：取餐码不变，价格快照跟着变', () => {
    const a = placeOrder([], [menu], { name: '张三' }, '2026-09-21', 'A', now);
    if (!a.ok) throw new Error('setup 失败'.replace('失败', '失败'));
    const c = changeOrder([a.value], [menu], a.value.id, 'B', now);
    expect(c.ok).toBe(true);
    if (!c.ok) return;
    expect(c.value.code).toBe(a.value.code);
    expect(c.value.choice).toBe('B');
    expect(c.value.price).toBe(14);
  });

  it('退订后当天可以重新订', () => {
    const a = placeOrder([], [menu], { name: '张三' }, '2026-09-21', 'A', now);
    if (!a.ok) throw new Error('setup 失败');
    const c = cancelOrder([a.value], a.value.id, now);
    expect(c.ok).toBe(true);
    const again = placeOrder([], [menu], { name: '张三' }, '2026-09-21', 'B', now);
    expect(again.ok).toBe(true);
  });

  it('planChanges：把勾选和已有订单对比，算出 订/改/退', () => {
    const existing = placeOrder([], [menu], { name: '张三' }, '2026-09-21', 'A', now);
    if (!existing.ok) throw new Error('setup 失败');
    const ops = planChanges(
      { '2026-09-21': 'B', '2026-09-22': 'A', '2026-09-23': '' },
      [existing.value],
    );
    expect(ops).toEqual([
      { type: 'change', id: existing.value.id, choice: 'B' },
      { type: 'place', date: '2026-09-22', choice: 'A' },
    ]);
  });

  it('applyBatch：一次提交全部生效；动别人的订单会被拒', () => {
    const mine = placeOrder([], [menu], { name: '张三' }, '2026-09-21', 'A', now);
    const other = placeOrder([], [menu], { name: '李四' }, '2026-09-22', 'A', now);
    if (!mine.ok || !other.ok) throw new Error('setup 失败');
    const base = [mine.value, other.value];

    const ok = applyBatch(
      base,
      [menu],
      { name: '张三' },
      [
        { type: 'change', id: mine.value.id, choice: 'B' },
        { type: 'place', date: '2026-09-23', choice: 'A' },
      ],
      now,
    );
    expect(ok.ok).toBe(true);
    if (ok.ok) {
      expect(ok.orders.find((o) => o.id === mine.value.id)?.choice).toBe('B');
      expect(ok.orders.some((o) => o.date === '2026-09-23' && o.name === '张三')).toBe(true);
    }

    const bad = applyBatch(base, [menu], { name: '张三' }, [{ type: 'cancel', id: other.value.id }], now);
    expect(bad).toMatchObject({ ok: false, error: 'not_found' });
  });
});

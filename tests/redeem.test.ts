import { describe, expect, it } from 'vitest';
import { effectiveStatus, redeem, sweepVoids } from '../src/domain/codes';
import { placeOrder } from '../src/domain/orders';
import type { Order } from '../src/domain/types';
import { local, makeMenu } from './helpers';

const monday = '2026-09-14';
const menu = makeMenu(monday);

function orderOn(date: string, code: string): Order {
  const r = placeOrder([], [menu], { name: '张三', empId: 'E001' }, date, 'A', local(2026, 9, 10, 10, 0));
  if (!r.ok) throw new Error('setup 失败');
  return { ...r.value, code };
}

describe('核销', () => {
  it('当天的码核销成功，记下取餐时间', () => {
    const o = orderOn('2026-09-14', '111111');
    const r = redeem(o, '2026-09-14', local(2026, 9, 14, 12, 0));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.order.status).toBe('redeemed');
    expect(r.order.redeemedAt).toBeTruthy();
    // 原对象不被改动
    expect(o.status).toBe('active');
  });

  it('重复核销：同一个码第二次必须拦住', () => {
    const o = orderOn('2026-09-14', '222222');
    const first = redeem(o, '2026-09-14', local(2026, 9, 14, 12, 0));
    if (!first.ok) throw new Error('setup 失败');
    const second = redeem(first.order, '2026-09-14', local(2026, 9, 14, 12, 30));
    expect(second).toMatchObject({ ok: false, error: 'already_redeemed' });
    // 再试多少次都一样
    const third = redeem(first.order, '2026-09-14', local(2026, 9, 14, 13, 0));
    expect(third).toMatchObject({ ok: false, error: 'already_redeemed' });
  });

  it('明天的码今天不能取', () => {
    const o = orderOn('2026-09-15', '333333');
    const r = redeem(o, '2026-09-14', local(2026, 9, 14, 12, 0));
    expect(r).toMatchObject({ ok: false, error: 'not_today' });
  });

  it('过期未取自动作废，作废后核销被拦', () => {
    const o = orderOn('2026-09-14', '444444');
    // 到了 9-15，昨天没取的订单算作废
    expect(effectiveStatus(o, '2026-09-15')).toBe('void');
    const r = redeem(o, '2026-09-15', local(2026, 9, 15, 12, 0));
    expect(r).toMatchObject({ ok: false, error: 'void' });
  });

  it('sweepVoids 只清过期未取的，已取的不动', () => {
    const taken = orderOn('2026-09-14', '555555');
    const first = redeem(taken, '2026-09-14', local(2026, 9, 14, 12, 0));
    if (!first.ok) throw new Error('setup 失败');
    const notTaken = orderOn('2026-09-14', '666666');
    const future = orderOn('2026-09-15', '777777');
    const swept = sweepVoids([first.order, notTaken, future], '2026-09-15', local(2026, 9, 15, 8, 0));
    expect(swept[0].status).toBe('redeemed');
    expect(swept[1].status).toBe('void');
    expect(swept[2].status).toBe('active');
  });
});

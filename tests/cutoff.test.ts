import { describe, expect, it } from 'vitest';
import { cutoffFor, formatLocalDate, isLocked, mondayOf } from '../src/domain/dates';
import { cancelOrder, changeOrder, placeOrder } from '../src/domain/orders';
import { local, makeMenu } from './helpers';

const monday = '2026-09-14'; // 周一
const menu = makeMenu(monday);

describe('截止锁定（全部按本地时间）', () => {
  it('前一天 15:00 截止：14:59 还能订，15:00 整就锁', () => {
    const date = '2026-09-15'; // 周二的餐
    expect(isLocked(date, local(2026, 9, 14, 14, 59, 59))).toBe(false);
    expect(isLocked(date, local(2026, 9, 14, 15, 0, 0))).toBe(true);
    expect(isLocked(date, local(2026, 9, 13, 23, 30))).toBe(false);
  });

  it('周一的餐，周日 15:00 截止', () => {
    expect(formatLocalDate(cutoffFor('2026-09-14'))).toBe('2026-09-13');
    expect(isLocked('2026-09-14', local(2026, 9, 13, 14, 0))).toBe(false);
    expect(isLocked('2026-09-14', local(2026, 9, 13, 15, 0))).toBe(true);
  });

  it('截止后下单被拦', () => {
    const r = placeOrder([], [menu], { name: '张三' }, '2026-09-15', 'A', local(2026, 9, 14, 15, 0, 1));
    expect(r).toMatchObject({ ok: false, error: 'locked' });
  });

  it('截止前下的单，截止后改、退都被拦', () => {
    const placed = placeOrder([], [menu], { name: '张三' }, '2026-09-15', 'A', local(2026, 9, 14, 10, 0));
    if (!placed.ok) throw new Error('setup 失败');
    const orders = [placed.value];
    const after = local(2026, 9, 14, 16, 0);
    expect(changeOrder(orders, [menu], placed.value.id, 'B', after)).toMatchObject({
      ok: false,
      error: 'locked',
    });
    expect(cancelOrder(orders, placed.value.id, after)).toMatchObject({
      ok: false,
      error: 'locked',
    });
  });

  it('日期格式化用本地时间，不漂移到前一天/后一天', () => {
    expect(formatLocalDate(local(2026, 1, 5, 23, 59))).toBe('2026-01-05');
    expect(formatLocalDate(local(2026, 1, 5, 0, 1))).toBe('2026-01-05');
    expect(mondayOf('2026-09-14')).toBe('2026-09-14'); // 周一
    expect(mondayOf('2026-09-20')).toBe('2026-09-14'); // 周日归本周
  });
});

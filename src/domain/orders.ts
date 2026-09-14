import { codesForDate, generateCode } from './codes';
import { isLocked } from './dates';
import type { Choice, ISODate, MenuDay, MenuWeek, Order } from './types';

/**
 * 下单 / 改餐 / 退订。全部纯函数：传进订单数组，返回新订单或新数组，
 * 不碰数据库、不碰界面，方便测试。
 */

export interface Orderer {
  name: string;
  empId?: string;
}

/** 同一个人的判定：有工号认工号，没工号认姓名 */
export function personKeyOf(name: string, empId?: string): string {
  const id = (empId ?? '').trim();
  return id ? `E:${id}` : `N:${name.trim()}`;
}

/**
 * 下单查重用的"同一个人"判定：personKey 相同肯定是同一个人；
 * 一边填了工号一边没填、但姓名相同的，也按同一个人算——
 * 否则同一个人"一次填工号一次不填"就是两个身份，一天能订两单。
 * 两边都填了工号而且不一样 → 明确的两个人（同名同姓各订各的），不算。
 */
function isSamePerson(o: Order, who: Orderer, personKey: string): boolean {
  if (o.personKey === personKey) return true;
  const empId = (who.empId ?? '').trim();
  if (empId && o.empId && o.empId !== empId) return false;
  return o.name === who.name.trim();
}

export type OrderError = 'no_menu' | 'locked' | 'duplicate' | 'not_found';

type Result<T> = { ok: true; value: T } | { ok: false; error: OrderError };

function findMenuDay(menus: MenuWeek[], date: ISODate): MenuDay | undefined {
  for (const w of menus) {
    const d = w.days.find((x) => x.date === date);
    if (d) return d;
  }
  return undefined;
}

function defaultId(): string {
  const c = globalThis.crypto;
  if (c?.randomUUID) return c.randomUUID();
  return `id-${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
}

/** 下单：一人一天一单，截止前才能订，价格取下单时菜单快照 */
export function placeOrder(
  orders: Order[],
  menus: MenuWeek[],
  who: Orderer,
  date: ISODate,
  choice: Choice,
  now: Date,
  rand: () => number = Math.random,
  makeId: () => string = defaultId,
): Result<Order> {
  const day = findMenuDay(menus, date);
  if (!day) return { ok: false, error: 'no_menu' };
  if (isLocked(date, now)) return { ok: false, error: 'locked' };
  const personKey = personKeyOf(who.name, who.empId);
  if (orders.some((o) => o.date === date && isSamePerson(o, who, personKey))) {
    return { ok: false, error: 'duplicate' };
  }
  const ts = now.toISOString();
  return {
    ok: true,
    value: {
      id: makeId(),
      personKey,
      name: who.name.trim(),
      empId: who.empId?.trim() || undefined,
      date,
      choice,
      price: day[choice].price,
      code: generateCode(codesForDate(orders, date), rand),
      status: 'active',
      createdAt: ts,
      updatedAt: ts,
    },
  };
}

/** 改套餐（A↔B）：截止前才能改，取餐码不变，价格快照更新 */
export function changeOrder(
  orders: Order[],
  menus: MenuWeek[],
  id: string,
  choice: Choice,
  now: Date,
): Result<Order> {
  const order = orders.find((o) => o.id === id);
  if (!order) return { ok: false, error: 'not_found' };
  if (isLocked(order.date, now)) return { ok: false, error: 'locked' };
  const day = findMenuDay(menus, order.date);
  if (!day) return { ok: false, error: 'no_menu' };
  return {
    ok: true,
    value: { ...order, choice, price: day[choice].price, updatedAt: now.toISOString() },
  };
}

/** 退订：截止前才能退。退掉即删除，取餐码释放出来 */
export function cancelOrder(orders: Order[], id: string, now: Date): Result<true> {
  const order = orders.find((o) => o.id === id);
  if (!order) return { ok: false, error: 'not_found' };
  if (isLocked(order.date, now)) return { ok: false, error: 'locked' };
  return { ok: true, value: true };
}

export type OrderOp =
  | { type: 'place'; date: ISODate; choice: Choice }
  | { type: 'change'; id: string; choice: Choice }
  | { type: 'cancel'; id: string };

/**
 * 把界面上"每天的勾选"和已有订单对比，算出需要执行的 订/改/退 操作。
 * selections 里没出现的日子不动（比如已截止的天根本不在勾选列表里）。
 */
export function planChanges(
  selections: Record<ISODate, Choice | ''>,
  myOrders: Order[],
): OrderOp[] {
  const ops: OrderOp[] = [];
  for (const date of Object.keys(selections).sort()) {
    const choice = selections[date];
    const existing = myOrders.find((o) => o.date === date);
    if (existing && !choice) {
      ops.push({ type: 'cancel', id: existing.id });
    } else if (existing && choice && existing.choice !== choice) {
      ops.push({ type: 'change', id: existing.id, choice });
    } else if (!existing && choice) {
      ops.push({ type: 'place', date, choice });
    }
  }
  return ops;
}

/**
 * 一次提交一批操作：全部校验通过才落库，任何一个失败就整体不执行。
 * 只能动本人的订单（按 id 找到的订单 personKey 对不上就拒绝）。
 */
export function applyBatch(
  orders: Order[],
  menus: MenuWeek[],
  who: Orderer,
  ops: OrderOp[],
  now: Date,
  rand: () => number = Math.random,
  makeId: () => string = defaultId,
): { ok: true; orders: Order[] } | { ok: false; error: OrderError; opIndex: number } {
  let current = orders;
  const personKey = personKeyOf(who.name, who.empId);
  for (let i = 0; i < ops.length; i += 1) {
    const op = ops[i];
    if (op.type === 'place') {
      const r = placeOrder(current, menus, who, op.date, op.choice, now, rand, makeId);
      if (!r.ok) return { ok: false, error: r.error, opIndex: i };
      current = [...current, r.value];
    } else {
      const target = current.find((o) => o.id === op.id);
      if (!target || target.personKey !== personKey) {
        return { ok: false, error: 'not_found', opIndex: i };
      }
      if (op.type === 'change') {
        const r = changeOrder(current, menus, op.id, op.choice, now);
        if (!r.ok) return { ok: false, error: r.error, opIndex: i };
        current = current.map((o) => (o.id === op.id ? r.value : o));
      } else {
        const r = cancelOrder(current, op.id, now);
        if (!r.ok) return { ok: false, error: r.error, opIndex: i };
        current = current.filter((o) => o.id !== op.id);
      }
    }
  }
  return { ok: true, orders: current };
}

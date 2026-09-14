import type { ISODate, Order, OrderStatus } from './types';

/**
 * 取餐码的生成和核销，独立模块，不依赖任何界面代码。
 * 规则：
 *  - 6 位数字，允许前导零（如 012345）
 *  - 当天唯一：同一个码同一天只发给一个人
 *  - 一人一天一个码（由 orders 模块保证一人一天一单）
 *  - 核销是单向状态机：active → redeemed；过期未取 → void；都不能再变
 */

export const CODE_LENGTH = 6;
const MAX_ATTEMPTS = 1000;

/** 生成一个当天没用过的 6 位码；rand 可注入便于测试 */
export function generateCode(existing: ReadonlySet<string>, rand: () => number = Math.random): string {
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    const code = String(Math.floor(rand() * 1_000_000)).padStart(CODE_LENGTH, '0');
    if (!existing.has(code)) return code;
  }
  throw new Error(`取餐码生成失败：连续 ${MAX_ATTEMPTS} 次冲突`);
}

/** 某天已经发出去的所有码 */
export function codesForDate(orders: readonly Order[], date: ISODate): Set<string> {
  const set = new Set<string>();
  for (const o of orders) if (o.date === date) set.add(o.code);
  return set;
}

/** 过期未取的订单视为作废（读的时候算，不依赖有没有人跑定时任务） */
export function effectiveStatus(order: Order, today: ISODate): OrderStatus {
  if (order.status === 'active' && order.date < today) return 'void';
  return order.status;
}

export type RedeemError = 'already_redeemed' | 'void' | 'not_today';
export type RedeemOutcome = { ok: true; order: Order } | { ok: false; error: RedeemError };

/**
 * 核销。防重复是第一要务：
 * 已经取过的（redeemed）直接拦下，返回 already_redeemed，界面提示"已取过"。
 * 不修改传入的订单，成功时返回一个新对象。
 */
export function redeem(order: Order, today: ISODate, now: Date): RedeemOutcome {
  const status = effectiveStatus(order, today);
  if (status === 'redeemed') return { ok: false, error: 'already_redeemed' };
  if (status === 'void') return { ok: false, error: 'void' };
  if (order.date !== today) return { ok: false, error: 'not_today' };
  const ts = now.toISOString();
  return { ok: true, order: { ...order, status: 'redeemed', redeemedAt: ts, updatedAt: ts } };
}

/** 把过期未取的 active 订单落库成 void（服务启动时、核销前、定时任务都会调） */
export function sweepVoids(orders: Order[], today: ISODate, now: Date): Order[] {
  return orders.map((o) =>
    o.status === 'active' && o.date < today
      ? { ...o, status: 'void' as const, updatedAt: now.toISOString() }
      : o,
  );
}

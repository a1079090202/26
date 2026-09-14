import type { DaySummary } from './domain/summary';
import type { OrderOp } from './domain/orders';
import type { MenuWeek, Order } from './domain/types';

export class ApiError extends Error {
  constructor(
    public code: string,
    message: string,
    public data?: unknown,
  ) {
    super(message);
  }
}

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(path, init);
  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    throw new ApiError(
      (data as { error?: string }).error ?? `http_${r.status}`,
      (data as { message?: string }).message ?? r.statusText,
      data,
    );
  }
  return data as T;
}

function post<T>(path: string, body: unknown): Promise<T> {
  return req<T>(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

export interface StateResponse {
  serverNow: string;
  menus: MenuWeek[];
  summaries: DaySummary[];
}

export const api = {
  state: (from: string, to: string) => req<StateResponse>(`/api/state?from=${from}&to=${to}`),
  mine: (name: string, empId: string) =>
    req<{ orders: Order[] }>(`/api/mine?name=${encodeURIComponent(name)}&empId=${encodeURIComponent(empId)}`),
  report: (from: string, to: string) =>
    req<{ orders: Order[] }>(`/api/report?from=${from}&to=${to}`),
  saveMenu: (week: MenuWeek) => post<{ ok: true }>('/api/menu', { week }),
  batch: (name: string, empId: string, ops: OrderOp[]) =>
    post<{ ok: true; orders: Order[] }>('/api/orders/batch', { name, empId, ops }),
  redeem: (code: string) => post<{ ok: true; order: Order }>('/api/redeem', { code }),
};

/**
 * 截止判断、取餐页"今天"都以窗口机器（服务器）的钟为准。
 * 这里记下服务器和本机的时间差，页面显示时用服务器时间。
 */
let clockOffset = 0;

export function syncClock(serverNow: string): void {
  clockOffset = new Date(serverNow).getTime() - Date.now();
}

export function serverNowDate(): Date {
  return new Date(Date.now() + clockOffset);
}

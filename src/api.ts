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

/** 接口回了 401：需要管理密码 */
export function isUnauthorized(e: unknown): boolean {
  return e instanceof ApiError && e.code === 'unauthorized';
}

const ADMIN_TOKEN_KEY = 'shitang.adminToken';

/** 管理密码存在浏览器里，管理接口请求时带上 */
export function getAdminToken(): string {
  try {
    return localStorage.getItem(ADMIN_TOKEN_KEY) ?? '';
  } catch {
    return '';
  }
}

export function setAdminToken(token: string): void {
  try {
    if (token) localStorage.setItem(ADMIN_TOKEN_KEY, token);
    else localStorage.removeItem(ADMIN_TOKEN_KEY);
  } catch {
    /* 隐私模式存不上就算了 */
  }
}

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const token = getAdminToken();
  const headers = new Headers(init?.headers);
  if (token) headers.set('X-Admin-Token', token);
  const r = await fetch(path, { ...init, headers });
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
  mine: (name: string, empId: string, pin: string) =>
    req<{ orders: Order[] }>(
      `/api/mine?name=${encodeURIComponent(name)}&empId=${encodeURIComponent(empId)}&pin=${encodeURIComponent(pin)}`,
    ),
  report: (from: string, to: string) =>
    req<{ orders: Order[] }>(`/api/report?from=${from}&to=${to}`),
  saveMenu: (week: MenuWeek) => post<{ ok: true }>('/api/menu', { week }),
  batch: (name: string, empId: string, pin: string, ops: OrderOp[]) =>
    post<{ ok: true; orders: Order[] }>('/api/orders/batch', { name, empId, pin, ops }),
  redeem: (code: string) => {
    // 窗口高峰期不能卡死：8 秒没响应就当失败，页面亮红让操作员重试
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8000);
    return req<{ ok: true; order: Order }>('/api/redeem', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code }),
      signal: ctrl.signal,
    }).finally(() => clearTimeout(timer));
  },
  resetPin: (name: string, empId: string) =>
    post<{ ok: true }>('/api/admin/reset-pin', { name, empId }),
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

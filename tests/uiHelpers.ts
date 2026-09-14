import { vi } from 'vitest';

type Handler = (url: string, init?: RequestInit) =>
  | { status?: number; body: unknown }
  | Promise<{ status?: number; body: unknown }>;

/** 按 URL 前缀伪造接口返回，例如 ['/api/redeem', () => ({ body: {...} })]；handler 也可以返回 Promise */
export function mockFetch(handlers: Array<[string, Handler]>) {
  const fn = vi.fn(async (input: unknown, init?: RequestInit) => {
    const url = String(input);
    for (const [prefix, h] of handlers) {
      if (url.startsWith(prefix)) {
        const r = await h(url, init);
        return new Response(JSON.stringify(r.body), {
          status: r.status ?? 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
    }
    return new Response(JSON.stringify({ error: 'not_found' }), { status: 404 });
  });
  vi.stubGlobal('fetch', fn);
  return fn;
}

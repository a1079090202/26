import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { buildSync } from 'esbuild';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { addDays, formatLocalDate, mondayOf } from '../src/domain/dates';

/**
 * 鉴权回归：取餐码是取餐的唯一凭证，不能被人按姓名白拿。
 * - /api/mine、/api/orders/batch 要本人 PIN（首次使用即设置）
 * - /api/menu、/api/report、/api/redeem、/api/admin/reset-pin 要管理密码
 * 起两个真服务：一个没设 ADMIN_PASSWORD（兼容放行），一个设了（必须带 token）。
 */

const dir = mkdtempSync(path.resolve(__dirname, '../.tmp-auth-test-'));
const bundle = path.join(dir, 'server.js');

interface Running {
  proc: ChildProcess;
  base: string;
  dataFile: string;
}

const servers: Running[] = [];

function freePort(): Promise<number> {
  return new Promise((resolve) => {
    const s = net.createServer().listen(0, '127.0.0.1', () => {
      const p = (s.address() as net.AddressInfo).port;
      s.close(() => resolve(p));
    });
  });
}

async function startServer(env: Record<string, string>): Promise<Running> {
  const port = await freePort();
  const dataFile = path.join(dir, `store-${port}.json`);
  const proc = spawn('node', [bundle], {
    env: { ...process.env, DATA_FILE: dataFile, PORT: String(port), ...env },
    stdio: 'pipe',
  });
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 50; i += 1) {
    if (proc.exitCode !== null) throw new Error('服务启动即退出');
    try {
      const r = await fetch(`${base}/api/state`);
      if (r.ok) {
        const running = { proc, base, dataFile };
        servers.push(running);
        return running;
      }
    } catch {
      /* 还没起来 */
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('服务一直没起来');
}

/** 下周菜单（全部可订），返回周一日期 */
function nextWeek() {
  const monday = addDays(mondayOf(formatLocalDate(new Date())), 7);
  return {
    id: monday,
    publishedAt: new Date().toISOString(),
    days: [0, 1, 2, 3, 4].map((i) => ({
      date: addDays(monday, i),
      A: { name: '红烧肉', price: 15 },
      B: { name: '清蒸鱼', price: 14 },
    })),
  };
}

function post(base: string, p: string, body: unknown, token?: string) {
  return fetch(`${base}${p}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { 'X-Admin-Token': token } : {}),
    },
    body: JSON.stringify(body),
  });
}

function mine(base: string, q: Record<string, string>) {
  return fetch(`${base}/api/mine?${new URLSearchParams(q)}`);
}

let open: Running; // 没设 ADMIN_PASSWORD：兼容放行
let guarded: Running; // 设了 ADMIN_PASSWORD=secret

beforeAll(async () => {
  buildSync({
    entryPoints: [path.resolve(__dirname, '../server/server.ts')],
    bundle: true,
    platform: 'node',
    format: 'esm',
    outfile: bundle,
    logLevel: 'silent',
  });
  open = await startServer({});
  guarded = await startServer({ ADMIN_PASSWORD: 'secret' });
  // 两台都发下周菜单，供订餐用
  for (const s of [open, guarded]) {
    const r = await post(s.base, '/api/menu', { week: nextWeek() }, 'secret');
    expect(r.status).toBe(200);
  }
}, 30000);

afterAll(() => {
  for (const s of servers) s.proc.kill();
  rmSync(dir, { recursive: true, force: true });
});

describe('员工 PIN：取餐码不再按姓名白送', () => {
  const who = { name: '钱七', empId: 'E100' };

  it('新人查询不带 PIN → 401 pin_required', async () => {
    const r = await mine(open.base, { ...who, pin: '' });
    expect(r.status).toBe(401);
    expect((await r.json()).error).toBe('pin_required');
  });

  it('首次下单带 PIN 即设置，之后不带/带错都被挡', async () => {
    const monday = nextWeek().id;
    const r = await post(open.base, '/api/orders/batch', {
      ...who,
      pin: '4321',
      ops: [{ type: 'place', date: monday, choice: 'A' }],
    });
    expect(r.status).toBe(200);

    const noPin = await mine(open.base, { ...who, pin: '' });
    expect(noPin.status).toBe(403);
    expect((await noPin.json()).error).toBe('pin_wrong');

    const wrong = await mine(open.base, { ...who, pin: '9999' });
    expect(wrong.status).toBe(403);

    const ok = await mine(open.base, { ...who, pin: '4321' });
    expect(ok.status).toBe(200);
    const body = await ok.json();
    expect(body.orders).toHaveLength(1);
    expect(body.orders[0].code).toMatch(/^\d{6}$/);
  });

  it('别人同名同姓也拿不走：工号不同是另一个人', async () => {
    const r = await mine(open.base, { name: '钱七', empId: 'E999', pin: '1234' });
    // 新 personKey：这次带的 PIN 即设置，返回的是空订单，看不到钱七的码
    expect(r.status).toBe(200);
    expect((await r.json()).orders).toHaveLength(0);
  });

  it('改单退单也要 PIN', async () => {
    const r = await post(open.base, '/api/orders/batch', {
      ...who,
      pin: '0000',
      ops: [{ type: 'change', id: 'whatever', choice: 'B' }],
    });
    expect(r.status).toBe(403);
    // 带对 PIN 可以改
    const mine1 = await (await mine(open.base, { ...who, pin: '4321' })).json();
    const ok = await post(open.base, '/api/orders/batch', {
      ...who,
      pin: '4321',
      ops: [{ type: 'change', id: mine1.orders[0].id, choice: 'B' }],
    });
    expect(ok.status).toBe(200);
  });

  it('连续错 5 次锁 5 分钟，锁定期对的 PIN 也进不来', async () => {
    for (let i = 0; i < 5; i += 1) {
      const r = await mine(open.base, { ...who, pin: '1111' });
      expect(r.status).toBe(403);
    }
    const locked = await mine(open.base, { ...who, pin: '1111' });
    expect(locked.status).toBe(423);
    expect((await locked.json()).error).toBe('pin_locked');
    const evenRight = await mine(open.base, { ...who, pin: '4321' });
    expect(evenRight.status).toBe(423);
  });

  it('窗口重置 PIN 后可以重设', async () => {
    const r = await post(open.base, '/api/admin/reset-pin', who);
    expect(r.status).toBe(200);
    const needNew = await mine(open.base, { ...who, pin: '' });
    expect(needNew.status).toBe(401);
    const reset = await mine(open.base, { ...who, pin: '5678' });
    expect(reset.status).toBe(200);
    expect((await reset.json()).orders).toHaveLength(1);
  });
});

describe('管理密码（设了 ADMIN_PASSWORD）', () => {
  it('发菜单、周报、核销、重置 PIN 都要 token', async () => {
    for (const [method, p, body] of [
      ['POST', '/api/menu', { week: nextWeek() }],
      ['GET', '/api/report', null],
      ['POST', '/api/redeem', { code: '123456' }],
      ['POST', '/api/admin/reset-pin', { name: '张三' }],
    ] as const) {
      const r =
        method === 'GET'
          ? await fetch(`${guarded.base}${p}`)
          : await post(guarded.base, p, body);
      expect(r.status, `${p} 无 token`).toBe(401);
      expect((await r.json()).error).toBe('unauthorized');
    }
  });

  it('错 token 也是 401，对 token 放行', async () => {
    const bad = await post(guarded.base, '/api/menu', { week: nextWeek() }, 'wrong');
    expect(bad.status).toBe(401);
    const good = await post(guarded.base, '/api/menu', { week: nextWeek() }, 'secret');
    expect(good.status).toBe(200);
    const rep = await fetch(`${guarded.base}/api/report`, {
      headers: { 'X-Admin-Token': 'secret' },
    });
    expect(rep.status).toBe(200);
  });

  it('员工接口和总览不要管理密码', async () => {
    const st = await fetch(`${guarded.base}/api/state`);
    expect(st.status).toBe(200);
    const needPin = await mine(guarded.base, { name: '新人', empId: '', pin: '' });
    expect(needPin.status).toBe(401); // 要的是 PIN，不是管理密码
    expect((await needPin.json()).error).toBe('pin_required');
  });
});

describe('发菜单：日期必须和所选周一致（防切周竞态把别的周写进这个 id）', () => {
  /** 以 monday 为 id，days 从 monday+dayOffset 起连续 5 天 */
  function weekFor(monday: string, dayOffset = 0) {
    return {
      id: monday,
      publishedAt: new Date().toISOString(),
      days: [0, 1, 2, 3, 4].map((i) => ({
        date: addDays(monday, i + dayOffset),
        A: { name: '红烧肉', price: 15.5 },
        B: { name: '清蒸鱼', price: 14 },
      })),
    };
  }

  it('id 不是周一 → 400', async () => {
    const monday = nextWeek().id;
    const r = await post(guarded.base, '/api/menu', { week: weekFor(addDays(monday, 1)) }, 'secret');
    expect(r.status).toBe(400);
    expect((await r.json()).message).toContain('周一');
  });

  it('id 是下周、days 却是下下周的 5 天 → 400，且没落库', async () => {
    const monday = nextWeek().id;
    const r = await post(guarded.base, '/api/menu', { week: weekFor(monday, 7) }, 'secret');
    expect(r.status).toBe(400);

    // 库里下周菜单仍是 beforeAll 发的那份（菜名是「红烧肉/清蒸鱼」之外的验证见下），
    // 这里确认下下周没被误写进去
    const st = await (await fetch(`${guarded.base}/api/state`)).json();
    const ids = st.menus.map((m: { id: string }) => m.id);
    expect(ids).not.toContain(addDays(monday, 7));
  });

  it('日期对得上的菜单（含小数价格）→ 200', async () => {
    const r = await post(guarded.base, '/api/menu', { week: weekFor(nextWeek().id) }, 'secret');
    expect(r.status).toBe(200);
  });
});

describe('管理密码（没设 ADMIN_PASSWORD，兼容放行）', () => {
  it('管理接口直接可用', async () => {
    const r = await fetch(`${open.base}/api/report`);
    expect(r.status).toBe(200);
  });
});

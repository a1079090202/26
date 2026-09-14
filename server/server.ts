import http from 'node:http';
import { networkInterfaces } from 'node:os';
import path from 'node:path';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { redeem, sweepVoids } from '../src/domain/codes';
import { addDays, formatLocalDate } from '../src/domain/dates';
import { applyBatch, personKeyOf, type OrderOp } from '../src/domain/orders';
import { dailySummary, purgeOld } from '../src/domain/summary';
import type { MenuWeek, Store } from '../src/domain/types';
import { StoreFile } from './store';

/**
 * 跑在窗口机器上的小服务：只用 Node 自带模块，不联网、不装数据库。
 * 员工电脑浏览器打开 http://窗口机器IP:端口 就能用。
 */

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.resolve(ROOT, '..', 'dist');
const DATA_FILE = process.env.DATA_FILE ?? path.resolve(ROOT, '..', 'data', 'store.json');
const PORT = Number(process.env.PORT ?? 8080);

const storeFile = new StoreFile(DATA_FILE);
let store: Store = storeFile.load();

/** 每次落库前把"过期未取"的订单扫成作废，并清理 8 周前的老数据 */
function housekeeping(now: Date): void {
  const today = formatLocalDate(now);
  store = purgeOld({ ...store, orders: sweepVoids(store.orders, today, now) }, today);
}

housekeeping(new Date());
storeFile.save(store);
// 服务一直开着也每小时扫一次
setInterval(() => {
  housekeeping(new Date());
  storeFile.save(store);
}, 60 * 60 * 1000).unref();

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

function sendJson(res: http.ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}

function readBody(req: http.IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > 1024 * 1024) {
        reject(new Error('body too large'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new Error('bad json'));
      }
    });
    req.on('error', reject);
  });
}

function validateMenuWeek(week: MenuWeek | undefined): string | null {
  if (!week || typeof week.id !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(week.id)) {
    return '菜单缺少周日期';
  }
  if (!Array.isArray(week.days) || week.days.length !== 5) {
    return '一周要是 5 天（周一到周五）';
  }
  for (const d of week.days) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d?.date)) return '菜单里有日期格式不对';
    for (const key of ['A', 'B'] as const) {
      const meal = d[key];
      if (!meal || typeof meal.name !== 'string' || !meal.name.trim()) {
        return `${d.date} 的 ${key} 套餐还没填名字`;
      }
      if (typeof meal.price !== 'number' || !Number.isFinite(meal.price) || meal.price < 0) {
        return `${d.date} 的 ${key} 套餐价格不对`;
      }
    }
  }
  return null;
}

async function handleApi(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  url: URL,
): Promise<void> {
  const now = new Date();
  const today = formatLocalDate(now);
  const method = req.method ?? 'GET';
  const p = url.pathname;

  // 总览：菜单 + 指定日期范围内每天的份数汇总（不含任何人名，员工端也安全）
  if (method === 'GET' && p === '/api/state') {
    const from = url.searchParams.get('from') ?? today;
    const to = url.searchParams.get('to') ?? from;
    const dates = new Set<string>();
    for (const m of store.menus) {
      for (const d of m.days) if (d.date >= from && d.date <= to) dates.add(d.date);
    }
    for (const o of store.orders) {
      if (o.date >= from && o.date <= to) dates.add(o.date);
    }
    const summaries = [...dates].sort().map((d) => dailySummary(store.orders, d, today));
    sendJson(res, 200, { serverNow: now.toISOString(), menus: store.menus, summaries });
    return;
  }

  // 查"我的订单"：按姓名/工号
  if (method === 'GET' && p === '/api/mine') {
    const name = (url.searchParams.get('name') ?? '').trim();
    const empId = (url.searchParams.get('empId') ?? '').trim();
    if (!name) {
      sendJson(res, 400, { error: 'bad_request', message: '请填写姓名' });
      return;
    }
    const key = personKeyOf(name, empId);
    const keepFrom = addDays(today, -7);
    const orders = store.orders
      .filter((o) => o.personKey === key && o.date >= keepFrom)
      .sort((a, b) => (a.date < b.date ? -1 : 1));
    sendJson(res, 200, { orders });
    return;
  }

  // 周报用的原始订单（窗口机器上用）
  if (method === 'GET' && p === '/api/report') {
    const from = url.searchParams.get('from') ?? addDays(today, -56);
    const to = url.searchParams.get('to') ?? today;
    const orders = store.orders.filter((o) => o.date >= from && o.date <= to);
    sendJson(res, 200, { orders });
    return;
  }

  // 发布/更新一周菜单
  if (method === 'POST' && p === '/api/menu') {
    const body = (await readBody(req)) as { week?: MenuWeek };
    const err = validateMenuWeek(body?.week);
    if (err) {
      sendJson(res, 400, { error: 'bad_menu', message: err });
      return;
    }
    const week = body.week!;
    store = {
      ...store,
      menus: [...store.menus.filter((m) => m.id !== week.id), week].sort((a, b) =>
        a.id < b.id ? -1 : 1,
      ),
    };
    storeFile.save(store);
    sendJson(res, 200, { ok: true });
    return;
  }

  // 订餐：一次提交 订/改/退 一批操作，要么全成要么全不成
  if (method === 'POST' && p === '/api/orders/batch') {
    const body = (await readBody(req)) as { name?: string; empId?: string; ops?: OrderOp[] };
    const name = String(body?.name ?? '').trim();
    const empId = String(body?.empId ?? '').trim();
    if (!name || !Array.isArray(body?.ops)) {
      sendJson(res, 400, { error: 'bad_request', message: '请填写姓名' });
      return;
    }
    const result = applyBatch(store.orders, store.menus, { name, empId }, body.ops, now);
    if (!result.ok) {
      sendJson(res, 409, { error: result.error, opIndex: result.opIndex });
      return;
    }
    store = { ...store, orders: result.orders };
    storeFile.save(store);
    const key = personKeyOf(name, empId);
    sendJson(res, 200, {
      ok: true,
      orders: store.orders
        .filter((o) => o.personKey === key)
        .sort((a, b) => (a.date < b.date ? -1 : 1)),
    });
    return;
  }

  // 窗口核销：输 6 位码。重复核销在这里被状态机拦住。
  if (method === 'POST' && p === '/api/redeem') {
    const body = (await readBody(req)) as { code?: string };
    const code = String(body?.code ?? '').trim();
    if (!/^\d{6}$/.test(code)) {
      sendJson(res, 400, { error: 'bad_code', message: '取餐码是 6 位数字' });
      return;
    }
    housekeeping(now);
    const idx = store.orders.findIndex((o) => o.date === today && o.code === code);
    if (idx >= 0) {
      const outcome = redeem(store.orders[idx], today, now);
      if (outcome.ok) {
        const orders = store.orders.slice();
        orders[idx] = outcome.order;
        store = { ...store, orders };
        storeFile.save(store);
        sendJson(res, 200, { ok: true, order: outcome.order });
      } else {
        sendJson(res, 409, { ok: false, error: outcome.error, order: store.orders[idx] });
      }
      return;
    }
    // 今天没这个码：看看是不是别的日子的，给个明白话
    const other = store.orders.find((o) => o.code === code);
    if (!other) {
      sendJson(res, 404, { ok: false, error: 'not_found' });
      return;
    }
    const outcome = redeem(other, today, now);
    sendJson(res, 409, {
      ok: false,
      error: outcome.ok ? 'not_today' : outcome.error,
      order: other,
    });
    return;
  }

  sendJson(res, 404, { error: 'not_found' });
}

function serveStatic(res: http.ServerResponse, pathname: string): void {
  let p = decodeURIComponent(pathname);
  if (p === '/') p = '/index.html';
  const file = path.normalize(path.join(DIST, p));
  if (!file.startsWith(DIST) || !existsSync(file) || !statSync(file).isFile()) {
    const index = path.join(DIST, 'index.html');
    if (existsSync(index)) {
      res.writeHead(200, { 'Content-Type': MIME['.html'] });
      res.end(readFileSync(index));
      return;
    }
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('前端还没构建：请先在项目目录运行 npm run build');
    return;
  }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] ?? 'application/octet-stream' });
  res.end(readFileSync(file));
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  if (url.pathname.startsWith('/api/')) {
    handleApi(req, res, url).catch((err) => {
      console.error(err);
      sendJson(res, 500, { error: 'server_error' });
    });
  } else if ((req.method ?? 'GET') === 'GET') {
    serveStatic(res, url.pathname);
  } else {
    sendJson(res, 404, { error: 'not_found' });
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`食堂订餐服务已启动（数据文件：${DATA_FILE}）`);
  console.log(`  本机打开：  http://localhost:${PORT}`);
  for (const addrs of Object.values(networkInterfaces())) {
    for (const a of addrs ?? []) {
      if (a.family === 'IPv4' && !a.internal) {
        console.log(`  员工访问：  http://${a.address}:${PORT}`);
      }
    }
  }
});

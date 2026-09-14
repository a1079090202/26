import http from 'node:http';
import { networkInterfaces } from 'node:os';
import path from 'node:path';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { redeem, sweepVoids } from '../src/domain/codes';
import { addDays, formatLocalDate, mondayOf, weekDates } from '../src/domain/dates';
import { applyBatch, personKeyOf, type OrderOp } from '../src/domain/orders';
import { dailySummary, purgeOld } from '../src/domain/summary';
import type { MenuWeek, PersonSecret, Store } from '../src/domain/types';
import { adminTokenOk, isValidPin, makeSecret, PinLimiter, verifyPin } from './auth';
import { StoreFile } from './store';

/**
 * 跑在窗口机器上的小服务：只用 Node 自带模块，不联网、不装数据库。
 * 员工电脑浏览器打开 http://窗口机器IP:端口 就能用。
 */

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.resolve(ROOT, '..', 'dist');
const DATA_FILE = process.env.DATA_FILE ?? path.resolve(ROOT, '..', 'data', 'store.json');
const PORT = Number(process.env.PORT ?? 8080);
/** 管理密码：发菜单/周报/核销/重置PIN 要带上。不设就放行（启动时会警告） */
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? '';

const storeFile = new StoreFile(DATA_FILE);
let store: Store = storeFile.load();
const pinLimiter = new PinLimiter();

/** 每次落库前把"过期未取"的订单扫成作废，并清理 8 周前的老数据 */
function housekeeping(now: Date): void {
  const today = formatLocalDate(now);
  store = purgeOld({ ...store, orders: sweepVoids(store.orders, today, now) }, today);
}

housekeeping(new Date());
storeFile.save(store);
// 服务一直开着也每小时扫一次；扫失败（比如磁盘满）记日志就行，别把服务搞挂
setInterval(() => {
  try {
    housekeeping(new Date());
    storeFile.save(store);
  } catch (err) {
    console.error('定时清理失败（下小时会再试）:', err);
  }
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
  if (mondayOf(week.id) !== week.id) {
    return '菜单的周日期得是周一';
  }
  if (!Array.isArray(week.days) || week.days.length !== 5) {
    return '一周要是 5 天（周一到周五）';
  }
  // days 的日期必须正好是 id 那个周一到周五：切周竞态/手工构造可能把别的周的 5 天
  // 塞进这个 id，按 id 落库就是"写错库"，这里必须挡住
  const expected = weekDates(week.id);
  for (const [i, d] of week.days.entries()) {
    if (!d || d.date !== expected[i]) {
      return '菜单里的日期和所选周对不上，请重新选周再发一次';
    }
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

/** 这些路径要管理密码（x-admin-token 头） */
const ADMIN_PATHS = new Set(['/api/menu', '/api/report', '/api/redeem', '/api/admin/reset-pin']);

type PinGate =
  | { ok: true; setSecret?: PersonSecret }
  | { ok: false; status: number; error: string; message: string };

/**
 * 某人的 PIN 闸门：已设 PIN 就校验；没设就把这次带的 PIN 设上（首次使用/换电脑）。
 * 通过返回 { ok: true }（setSecret 非空表示是新设的，调用方要落库）；
 * 不通过返回错误，调用方直接回响应。
 */
function pinGate(key: string, pin: string): PinGate {
  const locked = pinLimiter.lockedUntil(key, Date.now());
  if (locked) {
    return { ok: false, status: 423, error: 'pin_locked', message: '试错太多，锁 5 分钟，稍后再试' };
  }
  const secret = store.secrets[key];
  if (secret) {
    if (verifyPin(pin, secret)) {
      pinLimiter.ok(key);
      return { ok: true };
    }
    pinLimiter.fail(key, Date.now());
    return { ok: false, status: 403, error: 'pin_wrong', message: 'PIN 不对' };
  }
  if (!isValidPin(pin)) {
    return { ok: false, status: 401, error: 'pin_required', message: '请设置 4-6 位数字的 PIN' };
  }
  return { ok: true, setSecret: makeSecret(pin) };
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

  // 管理接口先过密码
  if (ADMIN_PATHS.has(p) && !adminTokenOk(req, ADMIN_PASSWORD)) {
    sendJson(res, 401, { error: 'unauthorized', message: '需要管理密码' });
    return;
  }

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

  // 查"我的订单"：按姓名/工号 + PIN（取餐码只给本人看）
  if (method === 'GET' && p === '/api/mine') {
    const name = (url.searchParams.get('name') ?? '').trim();
    const empId = (url.searchParams.get('empId') ?? '').trim();
    const pin = (url.searchParams.get('pin') ?? '').trim();
    if (!name) {
      sendJson(res, 400, { error: 'bad_request', message: '请填写姓名' });
      return;
    }
    const key = personKeyOf(name, empId);
    const gate = pinGate(key, pin);
    if (!gate.ok) {
      sendJson(res, gate.status, { error: gate.error, message: gate.message });
      return;
    }
    if (gate.setSecret) {
      store = { ...store, secrets: { ...store.secrets, [key]: gate.setSecret } };
      storeFile.save(store);
    }
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

  // 订餐：一次提交 订/改/退 一批操作，要么全成要么全不成。要带本人 PIN。
  if (method === 'POST' && p === '/api/orders/batch') {
    const body = (await readBody(req)) as {
      name?: string;
      empId?: string;
      pin?: string;
      ops?: OrderOp[];
    };
    const name = String(body?.name ?? '').trim();
    const empId = String(body?.empId ?? '').trim();
    const pin = String(body?.pin ?? '').trim();
    if (!name || !Array.isArray(body?.ops)) {
      sendJson(res, 400, { error: 'bad_request', message: '请填写姓名' });
      return;
    }
    const key = personKeyOf(name, empId);
    const gate = pinGate(key, pin);
    if (!gate.ok) {
      sendJson(res, gate.status, { error: gate.error, message: gate.message });
      return;
    }
    const result = applyBatch(store.orders, store.menus, { name, empId }, body.ops, now);
    if (!result.ok) {
      sendJson(res, 409, { error: result.error, opIndex: result.opIndex });
      return;
    }
    // 订单成功了才把新设的 PIN 一起落库
    store = { ...store, orders: result.orders };
    if (gate.setSecret) {
      store = { ...store, secrets: { ...store.secrets, [key]: gate.setSecret } };
    }
    storeFile.save(store);
    sendJson(res, 200, {
      ok: true,
      orders: store.orders
        .filter((o) => o.personKey === key)
        .sort((a, b) => (a.date < b.date ? -1 : 1)),
    });
    return;
  }

  // 员工忘 PIN：窗口用管理密码帮忙重置，员工下次下单/查询时重设
  if (method === 'POST' && p === '/api/admin/reset-pin') {
    const body = (await readBody(req)) as { name?: string; empId?: string };
    const name = String(body?.name ?? '').trim();
    const empId = String(body?.empId ?? '').trim();
    if (!name) {
      sendJson(res, 400, { error: 'bad_request', message: '请填写姓名' });
      return;
    }
    const key = personKeyOf(name, empId);
    if (!(key in store.secrets)) {
      sendJson(res, 404, { error: 'not_found', message: '这个人还没设过 PIN' });
      return;
    }
    const secrets = { ...store.secrets };
    delete secrets[key];
    store = { ...store, secrets };
    storeFile.save(store);
    pinLimiter.ok(key);
    sendJson(res, 200, { ok: true });
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
  let p: string;
  try {
    p = decodeURIComponent(pathname);
  } catch {
    // 畸形编码（如 /%E0%A4%A）是客户端的问题，回 400，绝不能把进程搞挂
    sendJson(res, 400, { error: 'bad_url' });
    return;
  }
  if (p === '/') p = '/index.html';
  const file = path.normalize(path.join(DIST, p));
  if (!file.startsWith(DIST + path.sep) || !existsSync(file) || !statSync(file).isFile()) {
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

function handleRequest(req: http.IncomingMessage, res: http.ServerResponse): void {
  let url: URL;
  try {
    url = new URL(req.url ?? '/', 'http://localhost');
  } catch {
    sendJson(res, 400, { error: 'bad_url' });
    return;
  }
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
}

const server = http.createServer((req, res) => {
  // 任何一个请求处理出错都不能拖垮整个服务：记日志、回 500、继续服务
  try {
    handleRequest(req, res);
  } catch (err) {
    console.error(err);
    if (!res.headersSent) sendJson(res, 500, { error: 'server_error' });
    res.end();
  }
});

// 客户端发的 HTTP 本身就有问题（畸形请求行等）：回 400 关掉，别崩
server.on('clientError', (err, socket) => {
  console.error('客户端请求畸形:', err.message);
  if (socket.writable) {
    socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n');
  } else {
    socket.destroy();
  }
});

// 兜底自愈：没想到的异常也只记日志，服务继续跑（窗口机器上没人盯着重启）
process.on('uncaughtException', (err) => {
  console.error('未捕获异常（服务继续运行）:', err);
});
process.on('unhandledRejection', (err) => {
  console.error('未处理的 Promise 拒绝（服务继续运行）:', err);
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`食堂订餐服务已启动（数据文件：${DATA_FILE}）`);
  if (!ADMIN_PASSWORD) {
    console.warn('⚠️  未设置 ADMIN_PASSWORD：任何人都能发菜单、看周报、核销！');
    console.warn('    建议设置后重启，例如：set ADMIN_PASSWORD=你的密码 && npm start');
  }
  console.log(`  本机打开：  http://localhost:${PORT}`);
  for (const addrs of Object.values(networkInterfaces())) {
    for (const a of addrs ?? []) {
      if (a.family === 'IPv4' && !a.internal) {
        console.log(`  员工访问：  http://${a.address}:${PORT}`);
      }
    }
  }
});

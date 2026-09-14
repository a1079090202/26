/**
 * 端到端验收：用真浏览器把老板的验收路线走一遍。
 * 发菜单(界面) → 订三天的餐 → 拿码 → 核销 → 故意重复核销 → 看次日汇总 → 周报
 *
 * 用法：先 npm run build，再 node scripts/e2e.mjs
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';

const PORT = 8124;
const BASE = `http://localhost:${PORT}`;
const dir = mkdtempSync(path.join(tmpdir(), 'shitang-e2e-'));
const DATA_FILE = path.join(dir, 'store.json');

let passed = 0;
function ok(name) {
  passed += 1;
  console.log(`  ✓ ${name}`);
}
function fail(name, extra) {
  console.error(`  ✗ ${name}`);
  if (extra !== undefined) console.error('    ', extra);
  process.exitCode = 1;
}
async function expect(cond, name, extra) {
  if (cond) ok(name);
  else fail(name, extra);
}
/** 等元素出现（最多 5 秒），出现才算过 */
async function see(locator, name) {
  try {
    await locator.first().waitFor({ state: 'visible', timeout: 5000 });
    ok(name);
    return true;
  } catch {
    fail(name);
    return false;
  }
}

// 用独立数据文件起服务 + 样例数据
const seed = spawn('node', ['server-build/seed.js'], {
  env: { ...process.env, DATA_FILE },
  stdio: 'inherit',
});
await new Promise((res, rej) => seed.on('exit', (c) => (c === 0 ? res() : rej(new Error('seed 失败')))));

const server = spawn('node', ['server-build/server.js'], {
  env: { ...process.env, DATA_FILE, PORT: String(PORT) },
  stdio: 'pipe',
});
await new Promise((res) => setTimeout(res, 800));

const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  page.on('pageerror', (err) => fail(`页面脚本报错: ${err.message}`));

  // ---------- 1. 发菜单（界面操作：下周菜单已由样例数据填好，直接发布） ----------
  await page.goto(`${BASE}/#/menu`);
  await page.getByRole('button', { name: '发布这一周的菜单' }).click();
  await see(page.locator('.msg-ok').filter({ hasText: '已发布' }), '菜单管理：发布下周菜单');

  // ---------- 2. 订三天的餐 ----------
  await page.goto(`${BASE}/#/`);
  await page.locator('.id-row input').first().fill('钱七');
  await page.locator('.id-row input').nth(1).fill('E100');
  await page.locator('.id-row input').nth(2).fill('1234'); // 首次订餐即设置 PIN
  const openCards = page.locator('.day-card:not(.locked)');
  await openCards.first().waitFor({ state: 'visible', timeout: 5000 });
  const cardCount = await openCards.count();
  await expect(cardCount >= 3, `订餐页有 ${cardCount} 天可订（>=3）`);
  for (let i = 0; i < 3; i += 1) {
    await openCards.nth(i).locator('.meal-opt').first().click(); // 都选 A 餐
  }
  await page.getByRole('button', { name: '提交订餐' }).click();
  await see(page.locator('.msg-ok').filter({ hasText: '订好了' }), '提交订餐成功');

  // ---------- 3. 拿码：我的取餐码出现 3 个 6 位码 ----------
  const codeCells = page.locator('section.card .code');
  await codeCells.first().waitFor({ state: 'visible', timeout: 5000 });
  const codes = (await codeCells.allTextContents()).map((c) => c.trim());
  await expect(codes.length === 3, '我的取餐码显示 3 个码', codes);
  await expect(
    codes.every((c) => /^\d{6}$/.test(c)),
    '取餐码都是 6 位数字',
    codes,
  );

  // ---------- 4. 核销：拿样例数据里李四今天的码去窗口 ----------
  const store = JSON.parse(readFileSync(DATA_FILE, 'utf8'));
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const today = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const liToday = store.orders.find((o) => o.name === '李四' && o.date === today && o.status === 'active');
  await expect(!!liToday, '样例数据里有李四今天的待取订单');
  await page.goto(`${BASE}/#/window`);
  await page.locator('.code-input').fill(liToday.code);
  await see(page.locator('.redeem-result.ok').filter({ hasText: '核销成功' }), '窗口核销：输码成功放行');

  // ---------- 5. 故意重复核销 ----------
  await page.locator('.code-input').fill(liToday.code);
  await see(page.locator('.redeem-result.dup').filter({ hasText: '已经取过了' }), '重复核销被拦：提示已取过');

  // ---------- 6. 次日汇总 ----------
  await page.goto(`${BASE}/#/summary`);
  const tomorrowCard = page.locator('.sum-card').first();
  await see(tomorrowCard.locator('h3').filter({ hasText: '明天' }), '汇总页有"明天"卡片');
  console.log(`  · 明天备餐数：${(await tomorrowCard.innerText()).replaceAll('\n', ' ')}`);

  // ---------- 7. 周报：订了没取 ----------
  await page.goto(`${BASE}/#/report`);
  await see(page.locator('h3').filter({ hasText: '订了没取' }), '周报有未取名单');
  const bodyText = await page.locator('main').innerText();
  await expect(bodyText.includes('张三') || bodyText.includes('王五'), '周报里能看到上周没取的人');

  console.log(process.exitCode ? '\n有步骤没通过' : `\n全部通过（${passed} 步）`);
} finally {
  await browser.close();
  server.kill();
  rmSync(dir, { recursive: true, force: true });
}

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { codesForDate, generateCode } from '../src/domain/codes';
import { addDays, formatLocalDate, mondayOf, parseLocalDate, weekDates } from '../src/domain/dates';
import { personKeyOf } from '../src/domain/orders';
import type { Choice, ISODate, MenuWeek, Order, OrderStatus, Store } from '../src/domain/types';
import { StoreFile } from './store';

/**
 * 样例数据：上周 + 本周 + 下周的菜单，和几条订餐记录。
 * 日期都按"今天"推算，什么时候运行都能直接看到效果：
 *  - 上周：有人取了、有人没取（作废）→ 周报有内容
 *  - 今天：两条待取 → 可以马上去核销页试（含重复核销）
 *  - 明天和下周：几条已订 → 汇总页有数字
 *
 * 用法：npm run seed        （数据库为空才写入）
 *       npm run seed -- --force   （覆盖重来）
 */

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const DATA_FILE = process.env.DATA_FILE ?? path.resolve(ROOT, '..', 'data', 'store.json');

// 周一到周五的 A/B 套餐和价格
const DISHES: [aName: string, aPrice: number, bName: string, bPrice: number][] = [
  ['红烧排骨 + 清炒时蔬 + 米饭', 15, '香菇滑鸡 + 清炒时蔬 + 米饭', 14],
  ['土豆牛腩 + 蒜蓉青菜 + 米饭', 16, '番茄炒蛋 + 麻婆豆腐 + 米饭', 12],
  ['清蒸鲈鱼 + 手撕包菜 + 米饭', 16, '鱼香肉丝 + 手撕包菜 + 米饭', 13],
  ['可乐鸡翅 + 蒜蓉油麦菜 + 米饭', 15, '青椒肉丝 + 蒜蓉油麦菜 + 米饭', 13],
  ['红烧肉 + 酸辣土豆丝 + 米饭', 15, '宫保鸡丁 + 酸辣土豆丝 + 米饭', 14],
];

function makeWeek(monday: ISODate, publishedAt: string): MenuWeek {
  return {
    id: monday,
    publishedAt,
    days: weekDates(monday).map((date, i) => ({
      date,
      A: { name: DISHES[i][0], price: DISHES[i][1] },
      B: { name: DISHES[i][2], price: DISHES[i][3] },
    })),
  };
}

function localNoonISO(date: ISODate): string {
  const d = parseLocalDate(date);
  d.setHours(12, 5, 0, 0);
  return d.toISOString();
}

function buildSample(now: Date): Store {
  const today = formatLocalDate(now);
  const thisMonday = mondayOf(today);
  const lastMonday = addDays(thisMonday, -7);
  const nextMonday = addDays(thisMonday, 7);

  const menus = [
    makeWeek(lastMonday, `${lastMonday}T02:00:00.000Z`),
    makeWeek(thisMonday, `${addDays(lastMonday, 3)}T02:00:00.000Z`),
    makeWeek(nextMonday, `${addDays(thisMonday, 3)}T02:00:00.000Z`),
  ];

  const orders: Order[] = [];
  let seq = 1;
  const add = (
    who: { name: string; empId?: string },
    date: ISODate,
    choice: Choice,
    status: OrderStatus,
  ) => {
    const day = menus.flatMap((m) => m.days).find((d) => d.date === date);
    if (!day) throw new Error(`样例数据出错：${date} 没有菜单`);
    const created = addDays(date, -3);
    orders.push({
      id: `seed-${seq++}`,
      personKey: personKeyOf(who.name, who.empId),
      name: who.name,
      empId: who.empId,
      date,
      choice,
      price: day[choice].price,
      code: generateCode(codesForDate(orders, date)),
      status,
      createdAt: `${created}T02:30:00.000Z`,
      updatedAt: `${created}T02:30:00.000Z`,
      redeemedAt: status === 'redeemed' ? localNoonISO(date) : undefined,
    });
  };

  const zhangsan = { name: '张三', empId: 'E001' };
  const lisi = { name: '李四', empId: 'E002' };
  const wangwu = { name: '王五' };

  // 上周：取了的和没取（作废）的都有
  add(zhangsan, addDays(lastMonday, 0), 'A', 'redeemed');
  add(zhangsan, addDays(lastMonday, 1), 'B', 'void');
  add(lisi, addDays(lastMonday, 2), 'A', 'redeemed');
  add(wangwu, addDays(lastMonday, 3), 'B', 'redeemed');
  add(wangwu, addDays(lastMonday, 4), 'A', 'void');

  // 今天：两条待取，方便马上试核销
  if (today >= thisMonday && today <= addDays(thisMonday, 4)) {
    add(zhangsan, today, 'A', 'active');
    add(lisi, today, 'B', 'active');
  }

  // 明天（如果在本周内有菜单）：一条待取
  const tomorrow = addDays(today, 1);
  if (tomorrow >= thisMonday && tomorrow <= addDays(thisMonday, 4)) {
    add(zhangsan, tomorrow, 'B', 'active');
  }

  // 下周：张三订了三天，李四两天，王五一天
  add(zhangsan, addDays(nextMonday, 0), 'A', 'active');
  add(zhangsan, addDays(nextMonday, 1), 'B', 'active');
  add(zhangsan, addDays(nextMonday, 2), 'A', 'active');
  add(lisi, addDays(nextMonday, 0), 'B', 'active');
  add(lisi, addDays(nextMonday, 3), 'A', 'active');
  add(wangwu, addDays(nextMonday, 1), 'A', 'active');

  return { menus, orders, secrets: {} };
}

const storeFile = new StoreFile(DATA_FILE);
const existing = storeFile.load();
const force = process.argv.includes('--force');
if ((existing.menus.length > 0 || existing.orders.length > 0) && !force) {
  console.log(`已有数据（${DATA_FILE}），不覆盖。想重来请运行：npm run seed -- --force`);
  process.exit(1);
}

const sample = buildSample(new Date());
storeFile.save(sample);

console.log(`样例数据已写入 ${DATA_FILE}`);
console.log(`  菜单：${sample.menus.map((m) => m.id).join('、')} 三周`);
console.log(`  订单：${sample.orders.length} 条`);
const today = formatLocalDate(new Date());
const todayOrders = sample.orders.filter((o) => o.date === today && o.status === 'active');
if (todayOrders.length > 0) {
  console.log('  今天可以拿去试核销的取餐码：');
  for (const o of todayOrders) {
    console.log(`    ${o.name} ${o.choice}餐 → ${o.code}`);
  }
}

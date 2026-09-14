// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import App from '../src/App';
import MenuAdminPage, { parsePriceInput } from '../src/pages/MenuAdminPage';
import ReportPage from '../src/pages/ReportPage';
import SummaryPage from '../src/pages/SummaryPage';
import { addDays, formatLocalDate, mondayOf } from '../src/domain/dates';
import { mockFetch } from './uiHelpers';

afterEach(cleanup);

describe('页面骨架', () => {
  it('导航有五个入口', () => {
    mockFetch([]);
    render(<App />);
    for (const t of ['订餐', '窗口核销', '菜单管理', '份数汇总', '周报']) {
      expect(screen.getByText(t)).toBeTruthy();
    }
  });

  it('汇总页：明天的 A/B 份数一眼能看到', async () => {
    const today = formatLocalDate(new Date());
    const tomorrow = addDays(today, 1);
    mockFetch([
      [
        '/api/state',
        () => ({
          body: {
            serverNow: new Date().toISOString(),
            menus: [],
            summaries: [
              { date: today, A: 1, B: 1, total: 2, redeemed: 1, pending: 1, void: 0 },
              { date: tomorrow, A: 2, B: 3, total: 5, redeemed: 0, pending: 5, void: 0 },
            ],
          },
        }),
      ],
    ]);
    render(<SummaryPage />);
    const heading = await screen.findByText(/明天/);
    const card = heading.closest('.sum-card');
    expect(card?.textContent).toContain('A餐 2 份');
    expect(card?.textContent).toContain('B餐 3 份');
  });

  it('周报：列出订了没取的人', async () => {
    const today = formatLocalDate(new Date());
    const monday = mondayOf(today);
    mockFetch([
      [
        '/api/report',
        () => ({
          body: {
            orders: [
              {
                id: '1',
                personKey: 'E:E001',
                name: '张三',
                empId: 'E001',
                date: monday,
                choice: 'A',
                price: 15,
                code: '111111',
                status: 'void',
                createdAt: '',
                updatedAt: '',
              },
            ],
          },
        }),
      ],
    ]);
    render(<ReportPage />);
    await screen.findByText(/订了没取（/);
    expect(screen.getByText('张三')).toBeTruthy();
  });

  it('菜单管理：没填完不让发，填完能发布', async () => {
    let saved = 0;
    mockFetch([
      ['/api/state', () => ({ body: { serverNow: new Date().toISOString(), menus: [], summaries: [] } })],
      ['/api/report', () => ({ body: { orders: [] } })],
      [
        '/api/menu',
        () => {
          saved += 1;
          return { body: { ok: true } };
        },
      ],
    ]);
    render(<MenuAdminPage />);
    // 等 5 天 × 2 个菜名输入框出来
    await waitFor(() => expect(screen.getAllByPlaceholderText('菜名')).toHaveLength(10));

    fireEvent.click(screen.getByRole('button', { name: '发布这一周的菜单' }));
    await screen.findByText(/还没填名字/);
    expect(saved).toBe(0);

    for (const input of screen.getAllByPlaceholderText('菜名')) {
      fireEvent.change(input, { target: { value: '红烧排骨' } });
    }
    fireEvent.click(screen.getByRole('button', { name: '发布这一周的菜单' }));
    await screen.findByText(/已发布/);
    expect(saved).toBe(1);
  });

  it('parsePriceInput：半截小数也认，非法输入不认', () => {
    expect(parsePriceInput('15.5')).toBe(15.5);
    expect(parsePriceInput('15.')).toBe(15); // 输入过程中的 "15."
    expect(parsePriceInput('.5')).toBe(0.5);
    expect(parsePriceInput('')).toBeNull();
    expect(parsePriceInput('.')).toBeNull();
    expect(parsePriceInput('-5')).toBeNull();
    expect(parsePriceInput('abc')).toBeNull();
    expect(parsePriceInput('1.2.3')).toBeNull();
  });

  it('价格框输入 "15.5" 不会被吃掉小数点，发布时按分取整', async () => {
    let payload: unknown = null;
    mockFetch([
      ['/api/state', () => ({ body: { serverNow: new Date().toISOString(), menus: [], summaries: [] } })],
      ['/api/report', () => ({ body: { orders: [] } })],
      [
        '/api/menu',
        (url, init) => {
          payload = JSON.parse(String(init?.body));
          return { body: { ok: true } };
        },
      ],
    ]);
    render(<MenuAdminPage />);
    const names = await screen.findAllByPlaceholderText('菜名');
    expect(names).toHaveLength(10);

    const prices = document.querySelectorAll<HTMLInputElement>('input.price-input');
    // 先输 "15." —— 老实现这里小数点立刻被吃掉
    fireEvent.change(prices[0], { target: { value: '15.' } });
    expect(prices[0].value).toBe('15.');
    fireEvent.change(prices[0], { target: { value: '15.5' } });
    expect(prices[0].value).toBe('15.5');
    // 字母/负号进不了框
    fireEvent.change(prices[1], { target: { value: '12x' } });
    expect(prices[1].value).toBe('14'); // 保持加载时的默认值
    fireEvent.change(prices[1], { target: { value: '-3' } });
    expect(prices[1].value).toBe('14');

    for (const input of names) {
      fireEvent.change(input, { target: { value: '红烧排骨' } });
    }
    fireEvent.click(screen.getByRole('button', { name: '发布这一周的菜单' }));
    await screen.findByText(/已发布/);
    const days = (payload as { week: { days: Array<{ A: { price: number } }> } }).week.days;
    expect(days[0].A.price).toBe(15.5);
  });

  it('快速切周：旧周的慢响应不能盖到新周表单上，发布写的是新周', async () => {
    const thisMonday = mondayOf(formatLocalDate(new Date()));
    const nextMonday = addDays(thisMonday, 7);
    const weekOf = (monday: string, dish: string) => ({
      id: monday,
      publishedAt: new Date().toISOString(),
      days: [0, 1, 2, 3, 4].map((i) => ({
        date: addDays(monday, i),
        A: { name: dish, price: 15 },
        B: { name: dish, price: 14 },
      })),
    });

    // 下周的 state 先回，本周的 state 故意拖到最后才回（模拟旧周慢响应）
    let resolveStaleState: (() => void) | null = null;
    const staleStateGate = new Promise<void>((r) => {
      resolveStaleState = r;
    });
    const fetchMock = mockFetch([
      [
        '/api/state',
        (url) => {
          const from = new URL(url, 'http://x').searchParams.get('from');
          if (from === thisMonday) {
            return staleStateGate.then(() => ({
              body: {
                serverNow: new Date().toISOString(),
                menus: [weekOf(thisMonday, '本周菜-不该出现')],
                summaries: [],
              },
            }));
          }
          return {
            body: {
              serverNow: new Date().toISOString(),
              menus: [weekOf(nextMonday, '下周菜')],
              summaries: [],
            },
          };
        },
      ],
      ['/api/report', () => ({ body: { orders: [] } })],
    ]);

    render(<MenuAdminPage />);
    const nameInputs = await screen.findAllByPlaceholderText('菜名');
    // 默认停在「下周」
    expect((nameInputs[0] as HTMLInputElement).value).toBe('下周菜');

    // 切到「本周」：本周请求挂着；再立刻切回「下周」，下周数据先回
    fireEvent.click(screen.getByRole('button', { name: /^本周/ }));
    fireEvent.click(screen.getByRole('button', { name: /^下周/ }));
    await waitFor(() => expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(4));
    expect((screen.getAllByPlaceholderText('菜名')[0] as HTMLInputElement).value).toBe('下周菜');

    // 本周那个慢响应现在才回来
    resolveStaleState!();
    await new Promise((r) => setTimeout(r, 20));
    expect((screen.getAllByPlaceholderText('菜名')[0] as HTMLInputElement).value).toBe('下周菜');
  });
});

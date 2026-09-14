// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import App from '../src/App';
import MenuAdminPage from '../src/pages/MenuAdminPage';
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
});

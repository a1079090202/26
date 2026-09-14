// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import OrderPage from '../src/pages/OrderPage';
import { addDays, formatLocalDate, mondayOf } from '../src/domain/dates';
import { makeMenu } from './helpers';
import { mockFetch } from './uiHelpers';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('订餐页（界面）', () => {
  it('填姓名 → 勾三天 → 提交 → 看到 3 个取餐码', async () => {
    const today = formatLocalDate(new Date());
    const menus = [makeMenu(addDays(mondayOf(today), 7))]; // 下周菜单，全部可订
    const placedOps: unknown[] = [];
    let sentPin = '';
    mockFetch([
      ['/api/state', () => ({ body: { serverNow: new Date().toISOString(), menus, summaries: [] } })],
      ['/api/mine', () => ({ body: { orders: [] } })],
      [
        '/api/orders/batch',
        (_url, init) => {
          const body = JSON.parse(String(init?.body)) as {
            name: string;
            empId: string;
            pin: string;
            ops: Array<{ type: string; date?: string; choice?: 'A' | 'B' }>;
          };
          const orders = body.ops
            .filter((o) => o.type === 'place')
            .map((op, i) => {
              placedOps.push(op);
              sentPin = body.pin;
              return {
                id: `new-${i}`,
                personKey: `E:${body.empId}`,
                name: body.name,
                empId: body.empId,
                date: op.date,
                choice: op.choice,
                price: 15,
                code: `10000${i}`,
                status: 'active',
                createdAt: '',
                updatedAt: '',
              };
            });
          return { body: { ok: true, orders } };
        },
      ],
    ]);

    const { container } = render(<OrderPage />);
    // 等菜单渲染出至少 3 天可订
    await waitFor(() => {
      expect(container.querySelectorAll('.day-card:not(.locked)').length).toBeGreaterThanOrEqual(3);
    });

    fireEvent.change(screen.getByPlaceholderText('必填'), { target: { value: '钱七' } });
    fireEvent.change(screen.getByPlaceholderText('选填，更保险'), { target: { value: 'E100' } });
    fireEvent.change(screen.getByPlaceholderText('4-6 位数字'), { target: { value: '4321' } });

    const openCards = container.querySelectorAll('.day-card:not(.locked)');
    for (let i = 0; i < 3; i += 1) {
      const radio = openCards[i].querySelector('.meal-opt input');
      expect(radio).toBeTruthy();
      fireEvent.click(radio!);
    }
    fireEvent.click(screen.getByRole('button', { name: '提交订餐' }));

    await screen.findByText(/订好了/);
    expect(placedOps).toHaveLength(3);
    expect(sentPin).toBe('4321'); // 提交要带 PIN
    const codes = [...container.querySelectorAll('section.card .code')].map((el) => el.textContent);
    expect(codes).toEqual(['100000', '100001', '100002']);
  });

  it('退订的反馈说"退好了"，不说"订好了"', async () => {
    const today = formatLocalDate(new Date());
    const monday = addDays(mondayOf(today), 7); // 下周菜单，全部可订
    const menus = [makeMenu(monday)];
    const existing = {
      id: 'o1',
      personKey: 'E:E100',
      name: '钱七',
      empId: 'E100',
      date: monday,
      choice: 'A',
      price: 15,
      code: '654321',
      status: 'active',
      createdAt: '',
      updatedAt: '',
    };
    const sentOps: unknown[] = [];
    mockFetch([
      ['/api/state', () => ({ body: { serverNow: new Date().toISOString(), menus, summaries: [] } })],
      ['/api/mine', () => ({ body: { orders: [existing] } })],
      [
        '/api/orders/batch',
        (_url, init) => {
          const body = JSON.parse(String(init?.body)) as { ops: unknown[] };
          sentOps.push(...body.ops);
          return { body: { ok: true, orders: [] } };
        },
      ],
    ]);

    const { container } = render(<OrderPage />);
    await waitFor(() => {
      expect(container.querySelectorAll('.day-card:not(.locked)').length).toBeGreaterThanOrEqual(5);
    });
    fireEvent.change(screen.getByPlaceholderText('必填'), { target: { value: '钱七' } });
    fireEvent.change(screen.getByPlaceholderText('选填，更保险'), { target: { value: 'E100' } });
    fireEvent.change(screen.getByPlaceholderText('4-6 位数字'), { target: { value: '4321' } });
    fireEvent.click(screen.getByRole('button', { name: '查我的订单' }));
    // 等订单回来：下周一的卡片上出现取餐码
    await waitFor(() => expect(container.querySelector('.day-code')).toBeTruthy());

    // 把下周一点成"不订"，提交
    const monCard = [...container.querySelectorAll('.day-card')].find((c) =>
      c.textContent?.includes('654321'),
    )!;
    fireEvent.click(monCard.querySelector('.meal-opt.none input')!);
    fireEvent.click(screen.getByRole('button', { name: '提交订餐' }));

    await screen.findByText(/退好了/);
    expect(screen.queryByText(/订好了/)).toBeNull();
    expect(sentOps).toEqual([{ type: 'cancel', id: 'o1' }]);
  });

  it('页面开着跨过 15:00：截止天的改动不静默丢弃，明确提示没提交', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const monday = mondayOf(formatLocalDate(new Date()));
    const tuesday = addDays(monday, 1);
    const wednesday = addDays(monday, 2);
    // 周二 14:59：周三的餐还可订（前一天 15:00 截止）
    vi.setSystemTime(new Date(`${tuesday}T14:59:00`));
    const menus = [makeMenu(monday)];
    const fetchMock = mockFetch([
      ['/api/state', () => ({ body: { serverNow: new Date().toISOString(), menus, summaries: [] } })],
      ['/api/mine', () => ({ body: { orders: [] } })],
      ['/api/orders/batch', () => ({ body: { ok: true, orders: [] } })],
    ]);

    const { container } = render(<OrderPage />);
    await waitFor(() => {
      expect(container.querySelectorAll('.day-card:not(.locked)').length).toBeGreaterThanOrEqual(3);
    });
    fireEvent.change(screen.getByPlaceholderText('必填'), { target: { value: '钱七' } });
    fireEvent.change(screen.getByPlaceholderText('4-6 位数字'), { target: { value: '4321' } });

    // 勾选周三的 A 餐（此时还可订）
    const wedCard = [...container.querySelectorAll('.day-card')].find((c) =>
      c.textContent?.includes(wednesday.slice(5)),
    )!;
    expect(wedCard.className).not.toContain('locked');
    fireEvent.click(wedCard.querySelector('.meal-opt input')!);

    // 跨过 15:00 再提交：周三已截止
    vi.setSystemTime(new Date(`${tuesday}T15:01:00`));
    fireEvent.click(screen.getByRole('button', { name: '提交订餐' }));

    const msg = await screen.findByText(/已过截止/);
    expect(msg.className).toContain('msg-warn');
    expect(msg.textContent).toContain('没有提交');
    // 没发任何下单请求：改动既没被静默提交，也被明确告知丢了
    expect(
      fetchMock.mock.calls.some(([u]) => String(u).startsWith('/api/orders/batch')),
    ).toBe(false);
  });
});

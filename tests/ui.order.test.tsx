// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import OrderPage from '../src/pages/OrderPage';
import { addDays, formatLocalDate, mondayOf } from '../src/domain/dates';
import { makeMenu } from './helpers';
import { mockFetch } from './uiHelpers';

afterEach(cleanup);

describe('订餐页（界面）', () => {
  it('填姓名 → 勾三天 → 提交 → 看到 3 个取餐码', async () => {
    const today = formatLocalDate(new Date());
    const menus = [makeMenu(addDays(mondayOf(today), 7))]; // 下周菜单，全部可订
    const placedOps: unknown[] = [];
    mockFetch([
      ['/api/state', () => ({ body: { serverNow: new Date().toISOString(), menus, summaries: [] } })],
      ['/api/mine', () => ({ body: { orders: [] } })],
      [
        '/api/orders/batch',
        (_url, init) => {
          const body = JSON.parse(String(init?.body)) as {
            name: string;
            empId: string;
            ops: Array<{ type: string; date?: string; choice?: 'A' | 'B' }>;
          };
          const orders = body.ops
            .filter((o) => o.type === 'place')
            .map((op, i) => {
              placedOps.push(op);
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

    const openCards = container.querySelectorAll('.day-card:not(.locked)');
    for (let i = 0; i < 3; i += 1) {
      const radio = openCards[i].querySelector('.meal-opt input');
      expect(radio).toBeTruthy();
      fireEvent.click(radio!);
    }
    fireEvent.click(screen.getByRole('button', { name: '提交订餐' }));

    await screen.findByText(/订好了/);
    expect(placedOps).toHaveLength(3);
    const codes = [...container.querySelectorAll('section.card .code')].map((el) => el.textContent);
    expect(codes).toEqual(['100000', '100001', '100002']);
  });
});

// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import RedeemPage from '../src/pages/RedeemPage';
import { formatLocalDate } from '../src/domain/dates';
import { mockFetch } from './uiHelpers';

afterEach(cleanup);

describe('窗口核销页（界面）', () => {
  it('输码成功变绿；再输同一个码变红提示已取过', async () => {
    const today = formatLocalDate(new Date());
    const order = {
      id: 'o1',
      personKey: 'E:E002',
      name: '李四',
      empId: 'E002',
      date: today,
      choice: 'B',
      price: 14,
      code: '613894',
      status: 'redeemed',
      createdAt: '',
      updatedAt: '',
      redeemedAt: new Date().toISOString(),
    };
    let calls = 0;
    mockFetch([
      [
        '/api/state',
        () => ({
          body: {
            serverNow: new Date().toISOString(),
            menus: [],
            summaries: [{ date: today, A: 0, B: 1, total: 1, redeemed: 0, pending: 1, void: 0 }],
          },
        }),
      ],
      [
        '/api/redeem',
        () => {
          calls += 1;
          if (calls === 1) return { body: { ok: true, order } };
          return { status: 409, body: { ok: false, error: 'already_redeemed', order } };
        },
      ],
    ]);

    render(<RedeemPage />);
    const input = screen.getByPlaceholderText('输 6 位取餐码');

    fireEvent.change(input, { target: { value: '613894' } });
    await screen.findByText(/核销成功/);
    expect(screen.getByText(/李四/)).toBeTruthy();

    fireEvent.change(input, { target: { value: '613894' } });
    await screen.findByText(/已经取过了/);
    expect(calls).toBe(2);
  });
});

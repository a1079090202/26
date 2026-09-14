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

  it('网络故障亮红"没核销上"，绝不留上一单的绿色；恢复后照常用', async () => {
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
      status: 'active',
      createdAt: '',
      updatedAt: '',
    };
    let mode: 'ok' | 'down' = 'ok';
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
          if (mode === 'down') throw new TypeError('Failed to fetch'); // 网络断了
          return { body: { ok: true, order } };
        },
      ],
    ]);

    render(<RedeemPage />);
    const input = screen.getByPlaceholderText('输 6 位取餐码');

    // 第一单：成功，绿色放行
    fireEvent.change(input, { target: { value: '613894' } });
    await screen.findByText(/核销成功/);
    expect(document.querySelector('.redeem-result.ok')).toBeTruthy();

    // 网络断了，第二单：必须亮红，绿色不能残留
    mode = 'down';
    fireEvent.change(input, { target: { value: '555555' } });
    await screen.findByText(/没核销上/);
    expect(document.querySelector('.redeem-result.err')).toBeTruthy();
    expect(document.querySelector('.redeem-result.ok')).toBeNull();
    expect(screen.queryByText(/核销成功/)).toBeNull();

    // 网络恢复，第三单照常
    mode = 'ok';
    fireEvent.change(input, { target: { value: '613894' } });
    await screen.findByText(/核销成功/);
    expect(document.querySelector('.redeem-result.ok')).toBeTruthy();
  });

  it('核销请求没回来时：上一单的绿色立刻下屏，显示"核销中"，输入框禁用', async () => {
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
      status: 'active',
      createdAt: '',
      updatedAt: '',
    };
    let release: (() => void) | null = null;
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
        async () => {
          // 挂住请求，模拟服务慢/卡
          await new Promise<void>((res) => {
            release = res;
          });
          return { body: { ok: true, order } };
        },
      ],
    ]);

    render(<RedeemPage />);
    const input = screen.getByPlaceholderText('输 6 位取餐码') as HTMLInputElement;

    // 先成一单拿绿色（这次也走挂起逻辑，先放行）
    fireEvent.change(input, { target: { value: '613894' } });
    await new Promise((r) => setTimeout(r, 50));
    release!();
    await screen.findByText(/核销成功/);

    // 第二单：请求挂起期间，绿色必须消失、显示核销中、输入框禁用
    fireEvent.change(input, { target: { value: '555555' } });
    await screen.findByText(/核销中/);
    expect(document.querySelector('.redeem-result.ok')).toBeNull();
    expect(input.disabled).toBe(true);

    // 请求回来了：绿色是这一单的，输入框恢复
    release!();
    await screen.findByText(/核销成功/);
    expect(input.disabled).toBe(false);
  });
});

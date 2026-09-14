import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { myStore } from '../src/db/myOrders';
import type { Order } from '../src/domain/types';

describe('员工端 IndexedDB（我的取餐码便签）', () => {
  it('身份和我的订单存进去能读回来', async () => {
    await myStore.saveIdentity({ name: '钱七', empId: 'E100' });
    expect(await myStore.loadIdentity()).toEqual({ name: '钱七', empId: 'E100' });

    const orders: Order[] = [
      {
        id: 'o1',
        personKey: 'E:E100',
        name: '钱七',
        empId: 'E100',
        date: '2026-09-21',
        choice: 'A',
        price: 15,
        code: '123456',
        status: 'active',
        createdAt: '',
        updatedAt: '',
      },
    ];
    await myStore.saveMyOrders(orders);
    expect(await myStore.loadMyOrders()).toEqual(orders);
  });
});

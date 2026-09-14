import 'fake-indexeddb/auto';
import { describe, expect, it, vi } from 'vitest';
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

  it('每次读写都把连接关掉，长开页面不会越积越多', async () => {
    const spy = vi.spyOn(IDBDatabase.prototype, 'close');
    try {
      await myStore.saveIdentity({ name: '钱七', empId: 'E100' });
      await myStore.loadIdentity();
      await myStore.saveMyOrders([]);
      await myStore.loadMyOrders();
      // 4 次读写 = 4 次打开 = 4 次关闭
      expect(spy).toHaveBeenCalledTimes(4);
    } finally {
      spy.mockRestore();
    }
  });
});

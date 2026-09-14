import type { Order } from '../domain/types';

/**
 * 员工自己电脑上的 IndexedDB：只存"我是谁"和"我的取餐码"，
 * 下次打开页面直接显示，不用再输名字查。
 * 正式数据都在窗口机器上，这里只是个便签；读写失败（隐私模式等）就当没有。
 */

const DB_NAME = 'shitang';
const STORE = 'kv';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open(DB_NAME, 1);
    r.onupgradeneeded = () => {
      r.result.createObjectStore(STORE);
    };
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

async function idbGet<T>(key: string): Promise<T | undefined> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const r = tx.objectStore(STORE).get(key);
    r.onsuccess = () => resolve(r.result as T | undefined);
    r.onerror = () => reject(r.error);
  });
}

async function idbSet(key: string, value: unknown): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export interface Identity {
  name: string;
  empId: string;
}

export const myStore = {
  async loadIdentity(): Promise<Identity | undefined> {
    try {
      return await idbGet<Identity>('identity');
    } catch {
      return undefined;
    }
  },
  async saveIdentity(id: Identity): Promise<void> {
    try {
      await idbSet('identity', id);
    } catch {
      /* 存不上就算了 */
    }
  },
  async loadMyOrders(): Promise<Order[] | undefined> {
    try {
      return await idbGet<Order[]>('myOrders');
    } catch {
      return undefined;
    }
  },
  async saveMyOrders(orders: Order[]): Promise<void> {
    try {
      await idbSet('myOrders', orders);
    } catch {
      /* 存不上就算了 */
    }
  },
};

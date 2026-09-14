import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { StoreFile } from '../server/store';
import type { Store } from '../src/domain/types';

describe('本机数据文件', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'shitang-'));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('文件不存在时返回空库', () => {
    const f = new StoreFile(path.join(dir, 'not-there', 'store.json'));
    expect(f.load()).toEqual({ menus: [], orders: [], secrets: {} });
  });

  it('保存后能原样读回（目录不存在会自动建）', () => {
    const f = new StoreFile(path.join(dir, 'sub', 'store.json'));
    const data: Store = {
      menus: [
        {
          id: '2026-09-21',
          publishedAt: '2026-09-17T02:00:00.000Z',
          days: [
            {
              date: '2026-09-21',
              A: { name: '红烧排骨', price: 15 },
              B: { name: '香菇滑鸡', price: 14 },
            },
          ],
        },
      ],
      orders: [
        {
          id: 'o1',
          personKey: 'E:E001',
          name: '张三',
          empId: 'E001',
          date: '2026-09-21',
          choice: 'A',
          price: 15,
          code: '123456',
          status: 'active',
          createdAt: '2026-09-17T02:00:00.000Z',
          updatedAt: '2026-09-17T02:00:00.000Z',
        },
      ],
      secrets: {},
    };
    f.save(data);
    expect(f.load()).toEqual(data);
  });
});

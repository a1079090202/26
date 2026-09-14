import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { Store } from '../src/domain/types';

/**
 * 数据就存本机一个 JSON 文件（默认 data/store.json）。
 * 写的时候先写临时文件再改名，写一半断电也不会把原文件弄坏。
 */
export class StoreFile {
  constructor(private readonly file: string) {}

  load(): Store {
    if (!existsSync(this.file)) return { menus: [], orders: [], secrets: {} };
    const raw = readFileSync(this.file, 'utf8');
    if (!raw.trim()) return { menus: [], orders: [], secrets: {} };
    const data = JSON.parse(raw) as Partial<Store>;
    // 老数据文件没有 secrets 字段，按空处理
    return { menus: data.menus ?? [], orders: data.orders ?? [], secrets: data.secrets ?? {} };
  }

  save(store: Store): void {
    mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    writeFileSync(tmp, JSON.stringify(store, null, 2), 'utf8');
    renameSync(tmp, this.file);
  }
}

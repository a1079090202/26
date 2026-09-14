import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import type http from 'node:http';
import type { PersonSecret } from '../src/domain/types';

/**
 * 鉴权小模块（只用 Node 自带 crypto，保持零依赖）：
 * - 员工 PIN：4-6 位数字，按人存 scrypt 哈希；试错 5 次锁 5 分钟防枚举
 * - 管理密码：环境变量 ADMIN_PASSWORD，接口比对 x-admin-token 头
 */

/** PIN 是 4-6 位数字，员工好记 */
export function isValidPin(pin: string): boolean {
  return /^\d{4,6}$/.test(pin);
}

export function makeSecret(pin: string): PersonSecret {
  const salt = randomBytes(16).toString('hex');
  return { salt, hash: hashPin(pin, salt) };
}

function hashPin(pin: string, salt: string): string {
  return scryptSync(pin, salt, 32).toString('hex');
}

export function verifyPin(pin: string, secret: PersonSecret): boolean {
  const a = Buffer.from(hashPin(pin, secret.salt), 'hex');
  const b = Buffer.from(secret.hash, 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}

const MAX_FAILS = 5;
const LOCK_MS = 5 * 60 * 1000;

/** PIN 试错限速：内存态，重启清零。键是 personKey */
export class PinLimiter {
  private fails = new Map<string, { count: number; lockedUntil: number }>();

  /** 还在锁定期就返回解锁时间戳，否则返回 0 */
  lockedUntil(key: string, now: number): number {
    const f = this.fails.get(key);
    if (!f) return 0;
    if (f.lockedUntil > now) return f.lockedUntil;
    if (f.lockedUntil > 0) this.fails.delete(key); // 锁已过期，清零重来
    return 0;
  }

  fail(key: string, now: number): void {
    const f = this.fails.get(key) ?? { count: 0, lockedUntil: 0 };
    f.count += 1;
    if (f.count >= MAX_FAILS) {
      f.lockedUntil = now + LOCK_MS;
      f.count = 0;
    }
    this.fails.set(key, f);
  }

  ok(key: string): void {
    this.fails.delete(key);
  }
}

/** 管理接口校验：未设 ADMIN_PASSWORD 时放行（启动时已打印警告） */
export function adminTokenOk(req: http.IncomingMessage, adminPassword: string): boolean {
  if (!adminPassword) return true;
  const token = req.headers['x-admin-token'];
  if (typeof token !== 'string' || !token) return false;
  // 哈希后再比，避免逐项比较泄露长度/前缀
  const a = createHash('sha256').update(token).digest();
  const b = createHash('sha256').update(adminPassword).digest();
  return timingSafeEqual(a, b);
}

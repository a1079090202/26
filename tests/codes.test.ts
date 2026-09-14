import { describe, expect, it } from 'vitest';
import { generateCode } from '../src/domain/codes';

describe('取餐码生成', () => {
  it('连发 500 个码：全唯一、都是 6 位数字', () => {
    const existing = new Set<string>();
    for (let i = 0; i < 500; i += 1) {
      const code = generateCode(existing);
      expect(code).toMatch(/^\d{6}$/);
      expect(existing.has(code)).toBe(false);
      existing.add(code);
    }
    expect(existing.size).toBe(500);
  });

  it('撞号会重试：同一个随机值不会发出重复的码', () => {
    const seq = [0.5, 0.5, 0.25];
    let i = 0;
    const rand = () => seq[Math.min(i++, seq.length - 1)];
    const existing = new Set<string>();
    const c1 = generateCode(existing, rand);
    existing.add(c1);
    const c2 = generateCode(existing, rand);
    expect(c1).toBe('500000');
    expect(c2).toBe('250000');
  });

  it('前导零保留：000001 也是合法码', () => {
    expect(generateCode(new Set(), () => 0.000001)).toBe('000001');
  });

  it('一直撞号就报错，不会死循环', () => {
    expect(() => generateCode(new Set(['123456']), () => 0.1234567)).toThrow();
  });
});

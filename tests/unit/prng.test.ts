import { describe, expect, it } from 'vitest';
import { frameSeed, hashSeed, mulberry32, withSeededRandom } from '../../src/core/prng';

describe('mulberry32', () => {
  it('同 seed 同序列', () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    for (let i = 0; i < 100; i++) expect(a()).toBe(b());
  });

  it('不同 seed 不同序列', () => {
    const a = mulberry32(1);
    const b = mulberry32(2);
    const seqA = Array.from({ length: 16 }, () => a());
    const seqB = Array.from({ length: 16 }, () => b());
    expect(seqA).not.toEqual(seqB);
  });

  it('输出落在 [0, 1)', () => {
    const r = mulberry32(7);
    for (let i = 0; i < 1000; i++) {
      const v = r();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});

describe('hashSeed', () => {
  it('稳定且对输入敏感', () => {
    expect(hashSeed(1, 'a', 2)).toBe(hashSeed(1, 'a', 2));
    expect(hashSeed(1, 'a', 2)).not.toBe(hashSeed(1, 'a', 3));
    expect(hashSeed(1, 'a')).not.toBe(hashSeed('a', 1));
  });
});

describe('withSeededRandom', () => {
  it('多次调用互不污染', () => {
    const one = withSeededRandom(9, (rng) => [rng(), rng(), rng()]);
    const two = withSeededRandom(9, (rng) => [rng(), rng(), rng()]);
    expect(one).toEqual(two);
  });
});

describe('frameSeed', () => {
  it('同一工程同一帧 → 同一种子', () => {
    expect(frameSeed(123, 40)).toBe(frameSeed(123, 40));
    expect(frameSeed(123, 40)).not.toBe(frameSeed(123, 41));
    expect(frameSeed(123, 40)).not.toBe(frameSeed(124, 40));
  });
});

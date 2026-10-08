import { describe, expect, it } from 'vitest';
import {
  LIFE_BITS,
  birthFromMask,
  bitRows,
  boolsToMask,
  clampMask,
  getBit,
  maskMax,
  maskToBools,
  masksFromBS,
  parseBS,
  setBit,
  surviveFromMask,
  toggleBit,
  totalBits,
} from '../../src/core/bitmask';

describe('位表行序（界面与生成器读的必须是同一套映射）', () => {
  it("'eca' 高位在前：第一行是 ■■■（bit7），最后一行是 □□□（bit0）", () => {
    const rows = bitRows([{ bits: 8, style: 'eca' }]);
    expect(rows.map((r) => r.bit)).toEqual([7, 6, 5, 4, 3, 2, 1, 0]);
    expect(rows.map((r) => r.indexInGroup)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
  });

  it("'count' 低位在前：第一行是邻居数 0", () => {
    const rows = bitRows([{ bits: 9, style: 'count' }]);
    expect(rows.map((r) => r.bit)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it('两组（B/S）的第二组位号从 9 起 —— 出生占低 9 位、存活占高 9 位', () => {
    const rows = bitRows([
      { bits: 9, style: 'count' },
      { bits: 9, style: 'count' },
    ]);
    expect(rows.slice(0, 9).every((r) => r.group === 0 && r.bit < 9)).toBe(true);
    expect(rows.slice(9).every((r) => r.group === 1 && r.bit >= 9)).toBe(true);
    expect(totalBits([{ bits: 9, style: 'count' }, { bits: 9, style: 'count' }])).toBe(LIFE_BITS);
  });

  it('规则号的位序就是 Wolfram 的读法：Rule 30 = 00011110₂', () => {
    const rows = bitRows([{ bits: 8, style: 'eca' }]);
    // 邻域 111 → bit7 … □□□ → bit0；rule 30 的位（高位在前）= 0,0,0,1,1,1,1,0
    expect(rows.map((r) => getBit(30, r.bit))).toEqual([0, 0, 0, 1, 1, 1, 1, 0]);
  });
});

describe('掩码位运算', () => {
  it('maskMax / clampMask 钳到合法范围', () => {
    expect(maskMax(8)).toBe(255);
    expect(maskMax(LIFE_BITS)).toBe(2 ** 18 - 1);
    expect(maskMax(0)).toBe(0);
    expect(clampMask(9999, 8)).toBe(255);
    expect(clampMask(-5, 8)).toBe(0);
    expect(clampMask(Number.NaN, 8)).toBe(0);
    expect(clampMask('110', 8)).toBe(110);
  });

  it('toggleBit 翻转一位并钳回范围；越界位不动', () => {
    expect(toggleBit(0, 0, 8)).toBe(1);
    expect(toggleBit(1, 0, 8)).toBe(0);
    expect(toggleBit(0b0001_1010, 3, 8)).toBe(0b0001_0010);
    expect(toggleBit(5, 99, 8)).toBe(5);
    // 翻完仍在 0..255
    expect(toggleBit(255, 7, 8)).toBe(127);
  });

  it('setBit 显式置位 / 清位', () => {
    expect(setBit(0, 3, true, 8)).toBe(8);
    expect(setBit(8, 3, false, 8)).toBe(0);
    expect(setBit(0, -1, true, 8)).toBe(0);
  });

  it('maskToBools / boolsToMask 往返', () => {
    const mask = 0b1011_0011;
    expect(boolsToMask(maskToBools(mask, 8), 8)).toBe(mask);
    expect(maskToBools(1, 4)).toEqual([1, 0, 0, 0]);
  });
});

describe('生命类 CA 的 B/S 打包', () => {
  it('Conway B3/S23 打包成 6152（出生占低 9 位、存活占高 9 位）', () => {
    const m = masksFromBS(1 << 3, (1 << 2) | (1 << 3));
    expect(m).toBe(6152);
    expect(birthFromMask(m)).toBe(1 << 3);
    expect(surviveFromMask(m)).toBe((1 << 2) | (1 << 3));
  });

  it('HighLife B36/S23 打包成 6216（与 Conway 只差出生的一位）', () => {
    const life = masksFromBS(1 << 3, (1 << 2) | (1 << 3));
    const high = masksFromBS((1 << 3) | (1 << 6), (1 << 2) | (1 << 3));
    expect(high).toBe(6216);
    // 掩码不同 ⇒ 规则不同（同一格子会演化出不同的下一代）
    expect(high).not.toBe(life);
    expect((high ^ life) >>> 0).toBe(1 << 6);
  });

  it('Seeds B2/S 的存活掩码为 0', () => {
    const m = masksFromBS(1 << 2, 0);
    expect(surviveFromMask(m)).toBe(0);
    expect(birthFromMask(m)).toBe(1 << 2);
  });

  it('parseBS 认得 B3/S23，解析不了时回退', () => {
    expect(parseBS('B3/S23')).toBe(6152);
    expect(parseBS('b36/s23')).toBe(6216);
    expect(parseBS('nonsense', 7)).toBe(7);
    expect(parseBS('B9/S23', 7)).toBe(7);
  });

  it('birthFromMask / surviveFromMask 对越界输入钳住', () => {
    expect(birthFromMask(-1)).toBe(0);
    expect(surviveFromMask(2 ** 18)).toBe(0x1ff); // 钳到 2^18-1 → 高 9 位全 1
  });
});

describe('边界值补测（由 Stryker 变异测试暴露的缺口）', () => {
  it('setBit / toggleBit 的越界分支：bit<0、bit===bits、bit>bits，且掩码不落在钳位上界', () => {
    // 原测试只用了 bit=3、bit=-1（掩码为 0）、bit=99，恰好绕开了「越界但掩码非零」这一组，
    // 于是守卫写成 `bit < 0 && bit >= bits` / `bit > bits` / `bit <= 0` 时测试照样全绿。
    expect(setBit(255, -1, true, 8)).toBe(255);
    expect(setBit(255, -1, false, 8)).toBe(255);
    expect(setBit(0, 0, true, 8)).toBe(1);
    expect(setBit(0, 8, true, 8)).toBe(0);
    expect(setBit(0, 9, true, 8)).toBe(0);
    expect(toggleBit(255, -1, 8)).toBe(255);
    expect(toggleBit(0, 0, 8)).toBe(1);
    expect(toggleBit(5, 8, 8)).toBe(5);
    expect(toggleBit(0, 9, 8)).toBe(0);
  });

  it('parseBS 的锚点与空白：前后缀垃圾必须拒绝，分隔符两侧的空白必须接受', () => {
    expect(parseBS('xxB3/S23', 7)).toBe(7);
    expect(parseBS('B3/S23xx', 7)).toBe(7);
    expect(parseBS('B3/ S23', 7)).toBe(6152);
  });
});

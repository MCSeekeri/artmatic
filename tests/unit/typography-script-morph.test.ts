import { describe, expect, it } from 'vitest';
import { morphPath, morphSegmentCount } from '../../src/typography/script/morph';
import { parsePathNodes } from '../../src/typography/path-nodes';

const A = 'M0,0 L10,0 L10,10 Z';
const B = 'M0,0 L20,0 L20,20 Z';

describe('morphPath', () => {
  it('k=0 / k=1 原样返回端点（逐字符精确）', () => {
    expect(morphPath(A, B, 0)).toBe(A);
    expect(morphPath(A, B, 1)).toBe(B);
    expect(morphPath(A, B, -1)).toBe(A);
    expect(morphPath(A, B, 2)).toBe(B);
  });

  it('中间态可解析、全是有限数', () => {
    for (const k of [0.1, 0.25, 0.5, 0.75, 0.9]) {
      const d = morphPath(A, B, k);
      expect(d).not.toContain('NaN');
      expect(d).not.toContain('Infinity');
      const subs = parsePathNodes(d);
      expect(subs.length).toBeGreaterThan(0);
      for (const sp of subs) {
        for (const n of sp.nodes) {
          expect(Number.isFinite(n.x)).toBe(true);
          expect(Number.isFinite(n.y)).toBe(true);
        }
      }
    }
  });

  it('段数不同的两条路径也能插值（细分不改形状）', () => {
    const a = 'M0,0 L10,0 L10,10 L0,10 Z';
    const b = 'M0,0 L20,0 L20,20 Z';
    const d = morphPath(a, b, 0.5);
    expect(d).not.toContain('NaN');
    expect(morphSegmentCount(d)).toBeGreaterThanOrEqual(4);
  });

  it('子路径数量不同时用退化点补齐，不抛', () => {
    const a = 'M0,0 L10,0 Z';
    const b = 'M0,0 L10,0 Z M5,5 L6,5 Z';
    const d = morphPath(a, b, 0.5);
    expect(d).not.toContain('NaN');
    expect(parsePathNodes(d).length).toBe(2);
  });

  it('闭合与开放混用时不丢画面', () => {
    const d = morphPath('M0,0 L10,0 L10,10 Z', 'M0,0 L20,0', 0.5);
    expect(d).not.toContain('NaN');
    expect(d.length).toBeGreaterThan(0);
  });

  it('带弧线的路径先归一化成三次贝塞尔再插值', () => {
    const d = morphPath('M0,0 A5,5 0 1 0 10,0', 'M0,0 L10,0', 0.5);
    expect(d).not.toContain('NaN');
    expect(d.toUpperCase()).toContain('C');
  });

  it('相同路径直接返回，不做无谓细分', () => {
    expect(morphPath(A, A, 0.4)).toBe(A);
  });

  it('非有限 k 退回 a', () => {
    expect(morphPath(A, B, Number.NaN)).toBe(A);
  });
});

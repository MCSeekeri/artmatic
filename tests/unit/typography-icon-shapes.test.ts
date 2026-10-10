import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  ICON_STROKE_WIDTH,
  SHAPE_BOX,
  iconGridFrames,
  iconNodeToPath,
  primitivePath,
} from '../../src/typography/icon-shapes';

describe('primitivePath', () => {
  it('circle：两条半圆弧，圆心与半径原样', () => {
    const d = primitivePath('circle', { cx: 12, cy: 12, r: 10 });
    expect(d).toContain('M2,12');
    expect(d).toContain('a10,10');
    expect(d.match(/a10,10/g)!.length).toBe(2);
  });

  it('circle：fill="currentColor" 的实心点按半径减半线宽，r 不够时退化成圆点', () => {
    // r=1、线宽 2 ⇒ 半径 0，用一个「点」（零长度线段 + round cap）表达
    const dot = primitivePath('circle', { cx: 12, cy: 12, r: 1, fill: 'currentColor' });
    expect(dot).toBe('M12,12 L12,12');
    // r=3 ⇒ 半径 2 的圆描边后外径正好是 3
    expect(primitivePath('circle', { cx: 0, cy: 0, r: 3, fill: 'currentColor' })).toContain('a2,2');
  });

  it('rect：圆角与直角两种形态，rx 超限按半边长钳制', () => {
    expect(primitivePath('rect', { x: 1, y: 2, width: 4, height: 6 })).toBe('M1,2 H5 V8 H1 Z');
    expect(primitivePath('rect', { x: 0, y: 0, width: 10, height: 10, rx: 2 })).toContain('A2,2');
    // 只给 ry 时 rx 取同值（SVG 规范）
    expect(primitivePath('rect', { x: 0, y: 0, width: 10, height: 10, ry: 3 })).toContain('A3,3');
    expect(primitivePath('rect', { x: 0, y: 0, width: 10, height: 10, rx: 99 })).toContain('A5,5');
    expect(primitivePath('rect', { x: 0, y: 0, width: 0, height: 10 })).toBe('');
  });

  it('line / polyline / polygon', () => {
    expect(primitivePath('line', { x1: 1, y1: 2, x2: 3, y2: 4 })).toBe('M1,2 L3,4');
    expect(primitivePath('polyline', { points: '1,2 3,4 5,6' })).toBe('M1,2 L3,4 L5,6');
    expect(primitivePath('polygon', { points: '1 2 3 4 5 6' })).toBe('M1,2 L3,4 L5,6 Z');
    expect(primitivePath('polyline', { points: '1,2 3' })).toBe('');
  });

  it('path 直接用 d；未知标签返回空串', () => {
    expect(primitivePath('path', { d: 'M1 2h3' })).toBe('M1 2h3');
    expect(primitivePath('blob', { d: 'M1 2' })).toBe('');
  });
});

describe('iconNodeToPath', () => {
  it('24 单位制坐标换算到 0..100', () => {
    // 从 (0,0) 到 (24,24) 的一条线 → (0,0) 到 (100,100)
    const d = iconNodeToPath([['path', { d: 'M0 0 L24 24' }]]);
    expect(d).toBe('M0,0 L100,100');
  });

  it('多图元合并成一条路径（shape:"svg" 只支持一条 d）', () => {
    const d = iconNodeToPath([
      ['circle', { cx: 12, cy: 12, r: 10 }],
      ['path', { d: 'M12 8v8' }],
    ]);
    expect(d.match(/M/g)!.length).toBe(2);
  });

  it('空节点集返回空串（调用方按「这一格没有内容」处理）', () => {
    expect(iconNodeToPath([])).toBe('');
    expect(iconNodeToPath([['blob', {}]])).toBe('');
  });

  it('描边宽度 = Lucide 的 2/24 换算到 100 单位制', () => {
    expect(ICON_STROKE_WIDTH).toBeCloseTo(SHAPE_BOX / 12, 6);
  });
});

describe('iconGridFrames', () => {
  const size = { w: 1000, h: 800 };

  it('单个图标 = 形状的默认（短边 30%、居中）', () => {
    const [f] = iconGridFrames(size, 1);
    expect(f!.w).toBe(f!.h);
    expect(f!.w).toBe(Math.round(800 * 0.3));
    expect(f!.x + f!.w / 2).toBeCloseTo(size.w / 2, 0);
    expect(f!.y + f!.h / 2).toBeCloseTo(size.h / 2, 0);
  });

  it('多个图标排成网格：互不重叠且在画布内', () => {
    const frames = iconGridFrames(size, 9);
    expect(frames.length).toBe(9);
    for (const f of frames) {
      expect(f.x).toBeGreaterThanOrEqual(0);
      expect(f.y).toBeGreaterThanOrEqual(0);
      expect(f.x + f.w).toBeLessThanOrEqual(size.w);
      expect(f.y + f.h).toBeLessThanOrEqual(size.h);
    }
    for (let i = 0; i < frames.length; i++) {
      for (let j = i + 1; j < frames.length; j++) {
        const a = frames[i]!;
        const b = frames[j]!;
        const overlaps = a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
        expect(overlaps, `${i} 与 ${j} 重叠`).toBe(false);
      }
    }
  });

  it('顺序从左到右、从上到下', () => {
    const frames = iconGridFrames(size, 4);
    expect(frames[1]!.x).toBeGreaterThan(frames[0]!.x);
    expect(frames[1]!.y).toBe(frames[0]!.y);
    expect(frames[2]!.y).toBeGreaterThan(frames[0]!.y);
    expect(frames[2]!.x).toBe(frames[0]!.x);
  });

  it('数量多到挤不下时整体收缩，仍然全部落在画布内', () => {
    const frames = iconGridFrames(size, 64);
    const d = frames[0]!.w;
    expect(d).toBeGreaterThan(0);
    for (const f of frames) {
      expect(f.x).toBeGreaterThanOrEqual(0);
      expect(f.x + f.w).toBeLessThanOrEqual(size.w);
    }
  });
});

/**
 * 全量守卫：把 lucide 1800+ 个图标的 iconNode 全部跑一遍转换。
 *
 * 这是「iconNode 的标签集变了 / 某个图标的数值畸形」在 CI 里唯一会红的地方 ——
 * 选择器里坏一格是静默的（那一格留空），没人会逐个点。
 * 直接读 node_modules（不经 glob），所以它同时钉住了「转换层不依赖加载层」。
 */
describe('全量图标转换守卫', () => {
  const dir = fileURLToPath(new URL('../../node_modules/@lucide/svelte/dist/icons', import.meta.url));
  const files = readdirSync(dir).filter((f) => f.endsWith('.svelte'));

  it('每一个图标都能转出合法的 0..100 路径', () => {
    const empty: string[] = [];
    const nan: string[] = [];
    const outOfBox: string[] = [];

    for (const file of files) {
      const raw = readFileSync(join(dir, file), 'utf8');
      const m = /const iconData = (\{[\s\S]*?\});/.exec(raw);
      if (!m) {
        empty.push(file);
        continue;
      }
      const node = (JSON.parse(m[1]!) as { node: Parameters<typeof iconNodeToPath>[0] }).node;
      const d = iconNodeToPath(node);
      if (!d) empty.push(file);
      else if (d.includes('NaN')) nan.push(file);
      else {
        for (const mm of d.matchAll(/-?\d+(?:\.\d+)?/g)) {
          const v = Number(mm[0]);
          // 控制点可以略超出 0..100（圆弧的贝塞尔手柄），但必须在同一量级
          if (v < -2 || v > SHAPE_BOX + 2) {
            outOfBox.push(`${file}:${v}`);
            break;
          }
        }
      }
    }

    expect(files.length).toBeGreaterThan(1000);
    expect({
      empty: empty.slice(0, 6),
      nan: nan.slice(0, 6),
      outOfBox: outOfBox.slice(0, 6),
    }).toEqual({ empty: [], nan: [], outOfBox: [] });
  });
});

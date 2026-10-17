/**
 * defs/outline.ts — 轮廓族（报告 §7.5 / §6 的 D1、D3、D4）。
 *
 * 三个都不走 `clipPath`：`ShapeElement` 只有一个 `d`，而 `<clipPath>` 需要
 * `<defs>` 与 id（同一页插入两份还会撞 id，见报告 §3.5d 的 svg.js 坑）。
 * 故障切分因此改成**按竖条解析出圆弧角区间**，纯几何、无 clip。
 */

import { CENTER, TAU, clamp, num, range, rngOf } from '../shared';
import { pt, polar, serializePrims, type Prim } from '../prims';
import type { SvgGenSpec } from '../types';

/** 闭合有机形：等角分布的控制点 + 半径扰动。 */
function blobPoints(
  c: { x: number; y: number },
  radius: number,
  count: number,
  roughness: number,
  rnd: () => number,
): { x: number; y: number }[] {
  const out: { x: number; y: number }[] = [];
  for (let i = 0; i < count; i++) {
    const a = (TAU * i) / count + (rnd() - 0.5) * (TAU / count) * 0.4;
    /*
     * 扰动**只向内**（r ≤ radius）：向外扰动会让半径 48 的 blob 顶点跑到 70 多，
     * 直接出盒。向内凹同样有机，还顺带保证「radius 就是最大半径」这个直觉。
     */
    const r = Math.max(1, radius * (1 - roughness * 0.45 * rnd()));
    out.push(polar(c, r, a));
  }
  return out;
}

const blob: SvgGenSpec = {
  id: 'blob',
  labelKey: 'gen.blob',
  group: 'outline',
  defaultSeed: 88,
  params: [
    range('points', 'gen.p.points', 5, 24, 1, 9),
    range('radius', 'gen.p.radius', 0.15, 0.48, 0.01, 0.38),
    range('roughness', 'gen.p.roughness', 0, 1, 0.05, 0.35),
  ],
  build(p, seed) {
    const rnd = rngOf(seed);
    const points = clamp(Math.round(num(p, 'points', 9)), 3, 24);
    const radius = clamp(num(p, 'radius', 0.38), 0.05, 0.48) * 100;
    const roughness = clamp(num(p, 'roughness', 0.35), 0, 1);
    const pts = blobPoints(pt(CENTER, CENTER), radius, points, roughness, rnd);
    const { d, commands } = serializePrims([{ t: 'spline', pts, close: true }]);
    return { d, commands };
  },
};

const splat: SvgGenSpec = {
  id: 'splat',
  labelKey: 'gen.splat',
  group: 'outline',
  defaultSeed: 55,
  params: [
    range('radius', 'gen.p.radius', 0.08, 0.45, 0.01, 0.26),
    range('blobs', 'gen.p.blobs', 3, 40, 1, 14),
    range('spread', 'gen.p.spread', 0, 0.5, 0.01, 0.18),
    range('blobSize', 'gen.p.blobSize', 0.02, 0.16, 0.005, 0.055),
    range('wobble', 'gen.p.wobble', 0, 1, 0.05, 0.4),
  ],
  build(p, seed) {
    const rnd = rngOf(seed);
    const radius = clamp(num(p, 'radius', 0.26), 0.02, 0.45) * 100;
    const count = clamp(Math.round(num(p, 'blobs', 14)), 0, 40);
    const spread = clamp(num(p, 'spread', 0.18), 0, 0.5) * 100;
    const blobSize = clamp(num(p, 'blobSize', 0.055), 0.01, 0.16) * 100;
    const wobble = clamp(num(p, 'wobble', 0.4), 0, 1);
    const c = pt(CENTER, CENTER);
    const prims: Prim[] = [
      { t: 'spline', pts: blobPoints(c, radius, 11, wobble, rnd), close: true },
    ];
    /*
     * 溅点：主形 + N 个偏移的小有机形。**同一条 `d`** —— 一个元素一份填充，
     * 拼成多元素的话图层列表会炸（报告 §9.4 的方案 ①：「降级为整体外观」）。
     */
    for (let i = 0; i < count; i++) {
      const a = rnd() * TAU;
      const size = blobSize * (0.45 + rnd() * 0.55);
      // 中心距夹到「不越出方盒」：溅点飞出 0..100 会撑大包围盒。
      const dist = Math.min(radius * 0.9 + rnd() * spread, 48 - size);
      const cc = pt(c.x + Math.cos(a) * dist, c.y + Math.sin(a) * dist);
      prims.push({ t: 'spline', pts: blobPoints(cc, size, 7, wobble * 0.8, rnd), close: true });
    }
    const { d, commands } = serializePrims(prims);
    return { d, commands };
  },
};

const glitchsplit: SvgGenSpec = {
  id: 'glitchsplit',
  labelKey: 'gen.glitchsplit',
  group: 'outline',
  defaultSeed: 31,
  params: [
    range('rings', 'gen.p.rings', 2, 8, 1, 6),
    range('segments', 'gen.p.segments', 4, 20, 1, 12),
    range('bandWidth', 'gen.p.bandWidth', 0.6, 6, 0.2, 2.4),
    range('shift', 'gen.p.shift', 0, 0.25, 0.01, 0.1),
    range('jitter', 'gen.p.jitter', 0, 1, 0.05, 0.5),
  ],
  build(p, seed) {
    const rnd = rngOf(seed);
    const rings = clamp(Math.round(num(p, 'rings', 6)), 1, 8);
    const segments = clamp(Math.round(num(p, 'segments', 12)), 2, 20);
    const bandWidth = clamp(num(p, 'bandWidth', 2.4), 0.2, 6);
    const shift = clamp(num(p, 'shift', 0.1), 0, 0.25);
    const jitter = clamp(num(p, 'jitter', 0.5), 0, 1);
    const c = pt(CENTER, CENTER);
    const colW = 100 / segments;
    const rStart = 12;
    const rEnd = 46;
    const rStep = (rEnd - rStart) / rings;
    const samples = 96;
    const step = TAU / samples;
    const prims: Prim[] = [];
    for (let ri = 0; ri < rings; ri++) {
      const r = rStart + ri * rStep;
      const r0 = r;
      const r1 = r + Math.min(bandWidth, rStep * 0.9);
      for (let k = 0; k < segments; k++) {
        const x0 = k * colW;
        const x1 = x0 + colW;
        // 奇偶竖条反向位移 —— 互补是故障感的来源，随机切矩形会露底。
        const dx =
          (k % 2 === 0 ? 1 : -1) *
          Math.min(4, shift * colW * 4) *
          (0.55 + 0.45 * rnd() * jitter);
        const mid = (r0 + r1) / 2;
        const inside: boolean[] = [];
        for (let i = 0; i < samples; i++) {
          const a = i * step;
          const x = c.x + mid * Math.cos(a);
          inside.push(x >= x0 && x <= x1);
        }
        const cc = pt(c.x + dx, c.y);
        /*
         * 找出中径圆落在本竖条内的角度区间（通常两段：上弧 / 下弧）。
         * 从**第一个区间外**的采样点起走，环形的首尾段才不会各算一半。
         */
        const startIdx = inside.indexOf(false);
        if (startIdx < 0) {
          prims.push({ t: 'band', c: cc, r0, r1, a0: 0, a1: TAU });
        } else {
          let runStart = -1;
          for (let n = 0; n <= samples; n++) {
            const cur = inside[(startIdx + n) % samples]!;
            if (cur && runStart < 0) runStart = n;
            if (!cur && runStart >= 0) {
              const a0 = (startIdx + runStart) * step;
              const a1 = (startIdx + n) * step;
              if (a1 - a0 > 1e-4) prims.push({ t: 'band', c: cc, r0, r1, a0, a1 });
              runStart = -1;
            }
          }
        }
      }
    }
    const { d, commands } = serializePrims(prims);
    return { d, commands };
  },
};

export const OUTLINE_GENERATORS: SvgGenSpec[] = [blob, splat, glitchsplit];

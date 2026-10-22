/**
 * defs/code.ts — 编码 / 工业语汇（报告 §7.7 / §6 的 G1–G2）。
 *
 * 这两个是**宽条素材**：条码天然 4:1、尺子 3:1。`aspect` 只影响插入时给的
 * 元素盒，坐标仍然 authored 在 0..100 方盒里（走既有的 `scaleFrom100`）。
 * 拉伸是可接受的：条码的竖条本来就该随宽度变宽。
 */

import { clamp, num, range, rngOf } from '../shared';
import { rectPoints, serializePrims, pt, type Prim } from '../prims';
import type { SvgGenSpec } from '../types';

const barcode: SvgGenSpec = {
  id: 'barcode',
  labelKey: 'gen.barcode',
  group: 'code',
  defaultSeed: 70,
  aspect: 4,
  notes:
    'Paint the bars with FILL, not stroke: the path is a set of closed rectangles, so a ' +
    'stroke traces every bar outline. With bars only a fraction of a unit wide, a normal ' +
    'stroke width is wider than the bar itself and neighbouring outlines merge into one ' +
    'solid plate — that is a stroke-width artefact, not a generator bug. Also note the ' +
    'frame is stretched (aspect 4): bar widths scale with the frame width.',
  params: [
    range('bars', 'gen.p.bars', 8, 120, 1, 56),
    range('minW', 'gen.p.minW', 0.4, 2, 0.1, 0.7),
    range('maxW', 'gen.p.maxW', 0.4, 4, 0.1, 1.8),
    range('gap', 'gen.p.gap', 0.1, 2, 0.05, 0.6),
    range('tall', 'gen.p.tall', 0.4, 1, 0.02, 1),
  ],
  build(p, seed) {
    const rnd = rngOf(seed);
    const bars = clamp(Math.round(num(p, 'bars', 56)), 1, 120);
    const minW = clamp(num(p, 'minW', 0.7), 0.1, 2);
    const maxW = Math.max(minW, clamp(num(p, 'maxW', 1.8), 0.1, 4));
    const gap = clamp(num(p, 'gap', 0.6), 0.05, 2);
    const tall = clamp(num(p, 'tall', 1), 0.1, 1);
    // 先按「自然宽度」铺满一条超长序列，再统一缩回 100 —— 参数怎么调都不会
    // 溢出或半途截断（截断会让最右一根永远停在同一个宽度，看起来像 bug）。
    const widths: number[] = [];
    const gaps: number[] = [];
    let total = 0;
    for (let i = 0; i < bars; i++) {
      const w = minW + rnd() * (maxW - minW);
      const g = gap * (0.5 + rnd() * 1.5);
      widths.push(w);
      gaps.push(g);
      total += w + g;
    }
    const k = 100 / Math.max(1e-6, total);
    const h = 100 * tall;
    const y = (100 - h) / 2;
    let x = 0;
    const prims: Prim[] = [];
    for (let i = 0; i < bars; i++) {
      const w = widths[i]! * k;
      prims.push({ t: 'poly', pts: rectPoints(x, y, Math.max(0.05, w), h), close: true });
      x += w + gaps[i]! * k;
    }
    const { d, commands } = serializePrims(prims);
    return { d, commands };
  },
};

const hudticks: SvgGenSpec = {
  id: 'hudticks',
  labelKey: 'gen.hudticks',
  group: 'code',
  defaultSeed: 81,
  aspect: 3,
  notes:
    'Same paint rule as barcode: use FILL. Every tick is a closed quad, and stroke widths ' +
    'above ~1 unit swallow the gaps between ticks.',
  params: [
    range('count', 'gen.p.count', 8, 72, 1, 28),
    range('tickLen', 'gen.p.tickLen', 0.1, 0.6, 0.01, 0.32),
    range('majorEvery', 'gen.p.majorEvery', 2, 10, 1, 4),
    range('majorScale', 'gen.p.majorScale', 1, 2.5, 0.1, 1.6),
    range('tickWidth', 'gen.p.tickWidth', 0.15, 1.2, 0.05, 0.35),
    range('slant', 'gen.p.slant', 0, 40, 1, 10),
    range('jitter', 'gen.p.jitter', 0, 1, 0.05, 0.15),
  ],
  build(p, seed) {
    const rnd = rngOf(seed);
    const count = clamp(Math.round(num(p, 'count', 28)), 1, 72);
    const tickLen = clamp(num(p, 'tickLen', 0.32), 0.02, 0.6);
    const every = clamp(Math.round(num(p, 'majorEvery', 4)), 1, 10);
    const majorScale = clamp(num(p, 'majorScale', 1.6), 1, 2.5);
    const tickW = clamp(num(p, 'tickWidth', 0.35), 0.05, 1.2);
    const slant = clamp(num(p, 'slant', 10), 0, 40) / 100;
    const jitter = clamp(num(p, 'jitter', 0.15), 0, 1);
    const baseY = 50;
    const prims: Prim[] = [];
    // 主轴：一根横贯的细条，尺子的「零线」。
    prims.push({
      t: 'poly',
      pts: rectPoints(3, baseY - tickW * 0.45, 94, tickW * 0.9),
      close: true,
    });
    const span = 88;
    for (let i = 0; i < count; i++) {
      const x = 6 + (count === 1 ? span / 2 : (span * i) / (count - 1));
      const major = i % every === 0;
      // 刻度长度夹到 44：主轴在 y=50，再长就越过盒顶。
      const len = Math.min(
        44,
        tickLen * 45 * (major ? majorScale : 1) * (1 + (rnd() - 0.5) * jitter * 0.4),
      );
      const w = tickW * (major ? 1.5 : 1);
      // 斜切按短边算：x 最大 94，顶部再偏 4.8 也仍在盒内。
      const topShift = slant * Math.min(len, 12);
      prims.push({
        t: 'poly',
        pts: [
          pt(x - w / 2, baseY - len),
          pt(x + w / 2 + topShift, baseY - len),
          pt(x + w / 2, baseY),
          pt(x - w / 2, baseY),
        ],
        close: true,
      });
    }
    const { d, commands } = serializePrims(prims);
    return { d, commands };
  },
};

export const CODE_GENERATORS: SvgGenSpec[] = [barcode, hudticks];

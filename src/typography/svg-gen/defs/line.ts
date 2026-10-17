/**
 * defs/line.ts — 线族（报告 §7.4 / §6 的 C1–C4）。
 *
 * 线族全部是 `strokeOnly`：它们只有线宽没有面积，插进画布时默认
 * 「无填充 + 描边」，否则就是一张空白。闭合带（`waveband`）是唯一例外 ——
 * 那是面，不是线。
 */

import { CENTER, TAU, clamp, num, rad, range, rngOf } from '../shared';
import { clipLineToBox, pt, serializePrims, type Prim } from '../prims';
import type { SvgGenSpec } from '../types';

const hatch: SvgGenSpec = {
  id: 'hatch',
  labelKey: 'gen.hatch',
  group: 'line',
  defaultSeed: 3,
  params: [
    range('count', 'gen.p.count', 4, 40, 1, 22),
    range('angle', 'gen.p.angle', 0, 180, 5, 45),
    range('width', 'gen.p.width', 0.1, 2, 0.05, 0.4),
    /*
     * 上限是 **1**（不是 0.9）：0.9 意味着每段之间永远留 10% 的缝，
     * 线宽 1–2px 时接缝看得清清楚楚。1 = 连续线（分段只在拐角处接上）。
     */
    range('dash', 'gen.p.dash', 0, 1, 0.05, 0),
    range('inset', 'gen.p.inset', 0, 0.2, 0.01, 0.04),
  ],
  build(p) {
    const count = clamp(Math.round(num(p, 'count', 22)), 1, 40);
    const angle = num(p, 'angle', 45);
    const dash = clamp(num(p, 'dash', 0), 0, 1);
    const inset = clamp(num(p, 'inset', 0.04), 0, 0.2) * 100;
    const a = rad(angle);
    const u = pt(Math.cos(a), Math.sin(a));
    const nrm = pt(-u.y, u.x);
    const c = pt(CENTER, CENTER);
    const box = { x0: inset, y0: inset, x1: 100 - inset, y1: 100 - inset };
    // 线族要盖满盒子：偏移量的跨度取对角线，而不是盒宽 —— 45° 时后者只盖住中间一条。
    const span = Math.SQRT2 * 100;
    const period = (span / count) * 1.25;
    const prims: Prim[] = [];
    for (let i = 0; i < count; i++) {
      const off = -span / 2 + ((i + 0.5) * span) / count;
      const base = pt(c.x + nrm.x * off, c.y + nrm.y * off);
      const clipped = clipLineToBox(base, u, box);
      if (!clipped) continue;
      const [t0, t1] = clipped;
      if (dash <= 0.02) {
        prims.push({
          t: 'line',
          a: pt(base.x + u.x * t0, base.y + u.y * t0),
          b: pt(base.x + u.x * t1, base.y + u.y * t1),
        });
        continue;
      }
      const on = period * dash;
      for (let t = t0; t < t1; t += period) {
        const e = Math.min(t + on, t1);
        prims.push({
          t: 'line',
          a: pt(base.x + u.x * t, base.y + u.y * t),
          b: pt(base.x + u.x * e, base.y + u.y * e),
        });
      }
    }
    const { d, commands } = serializePrims(prims);
    return { d, strokeOnly: true, commands };
  },
};

const sine: SvgGenSpec = {
  id: 'sine',
  labelKey: 'gen.sine',
  group: 'line',
  defaultSeed: 12,
  aspect: 1.6,
  params: [
    range('rows', 'gen.p.rows', 1, 24, 1, 8),
    range('amp', 'gen.p.amp', 0.05, 1, 0.05, 0.5),
    range('freq', 'gen.p.freq', 0.5, 6, 0.1, 2),
    range('phase', 'gen.p.phase', 0, 1, 0.05, 0.15),
    range('samples', 'gen.p.samples', 8, 96, 1, 40),
  ],
  build(p) {
    const rows = clamp(Math.round(num(p, 'rows', 8)), 1, 24);
    const amp = clamp(num(p, 'amp', 0.5), 0.01, 1);
    const freq = clamp(num(p, 'freq', 2), 0.1, 8);
    const phase = clamp(num(p, 'phase', 0.15), -1, 1);
    const samples = clamp(Math.round(num(p, 'samples', 40)), 4, 96);
    const rowH = 100 / rows;
    const prims: Prim[] = [];
    for (let r = 0; r < rows; r++) {
      const baseY = (r + 0.5) * rowH;
      const A = amp * rowH * 0.42;
      const pts: { x: number; y: number }[] = [];
      for (let i = 0; i <= samples; i++) {
        const t = i / samples;
        pts.push({
          x: t * 100,
          y: baseY + Math.sin(TAU * (freq * t + phase * r)) * A,
        });
      }
      prims.push({ t: 'spline', pts });
    }
    const { d, commands } = serializePrims(prims);
    return { d, strokeOnly: true, commands };
  },
};

const waveband: SvgGenSpec = {
  id: 'waveband',
  labelKey: 'gen.waveband',
  group: 'line',
  defaultSeed: 21,
  params: [
    range('bands', 'gen.p.bands', 1, 12, 1, 4),
    range('amp', 'gen.p.amp', 0.05, 1, 0.05, 0.6),
    range('thick', 'gen.p.thick', 0.1, 0.9, 0.02, 0.4),
    range('jitter', 'gen.p.jitter', 0, 1, 0.05, 0.2),
    range('samples', 'gen.p.samples', 8, 48, 1, 22),
  ],
  build(p, seed) {
    const rnd = rngOf(seed);
    const bands = clamp(Math.round(num(p, 'bands', 4)), 1, 12);
    const amp = clamp(num(p, 'amp', 0.6), 0.01, 1);
    const thick = clamp(num(p, 'thick', 0.4), 0.05, 0.9);
    const jitter = clamp(num(p, 'jitter', 0.2), 0, 1);
    const samples = clamp(Math.round(num(p, 'samples', 22)), 4, 48);
    const bandH = 100 / bands;
    const prims: Prim[] = [];
    for (let b = 0; b < bands; b++) {
      /*
       * 每个带只在**自己的槽**里呼吸：振幅与带厚之和必须 ≤ 槽高，否则
       * 上下沿会跑到邻居（及盒外）。系数 0.33 是倒推出来的：
       * 顶部偏移 = A + 0.4A（抖动）= 1.4A，要求 ≤ (槽高 − 带厚) / 2。
       */
      const h = Math.max(0.5, thick * bandH * 0.6);
      const A = amp * Math.max(0, bandH - h) * 0.33;
      const baseY = b * bandH + bandH / 2 - h / 2;
      const freq = 1 + Math.round(rnd() * 2);
      const phase = rnd() * TAU;
      const top: { x: number; y: number }[] = [];
      for (let i = 0; i <= samples; i++) {
        const t = i / samples;
        const wobble = (rnd() - 0.5) * jitter * A * 0.8;
        top.push({ x: t * 100, y: baseY + Math.sin(phase + TAU * freq * t) * A + wobble });
      }
      const bottom = top
        .slice()
        .reverse()
        .map((q) => ({ x: q.x, y: q.y + h }));
      /*
       * 闭合带必须**一条子路径**：上沿 → `L` 落到下沿右端 → 下沿反向 → `Z`。
       * 下沿另起 `M` 的话 evenodd 会把带子算成两片互相抵消的形状（空白）。
       */
      prims.push({ t: 'spline', pts: top });
      prims.push({ t: 'spline', pts: bottom, connect: true });
      prims.push({ t: 'close' });
    }
    const { d, commands } = serializePrims(prims);
    return { d, commands };
  },
};

const squiggle: SvgGenSpec = {
  id: 'squiggle',
  labelKey: 'gen.squiggle',
  group: 'line',
  defaultSeed: 66,
  params: [
    range('count', 'gen.p.count', 1, 30, 1, 6),
    range('amp', 'gen.p.amp', 0.05, 1, 0.05, 0.35),
    range('freq', 'gen.p.freq', 0.5, 6, 0.1, 2.2),
    range('noise', 'gen.p.noise', 0, 1, 0.05, 0.3),
    range('samples', 'gen.p.samples', 8, 64, 1, 32),
  ],
  build(p, seed) {
    const rnd = rngOf(seed);
    const count = clamp(Math.round(num(p, 'count', 6)), 1, 30);
    const amp = clamp(num(p, 'amp', 0.35), 0.01, 1);
    const freq = clamp(num(p, 'freq', 2.2), 0.1, 8);
    const noise = clamp(num(p, 'noise', 0.3), 0, 1);
    const samples = clamp(Math.round(num(p, 'samples', 32)), 4, 64);
    const slot = 100 / count;
    const prims: Prim[] = [];
    for (let i = 0; i < count; i++) {
      const baseY = (i + 0.5) * slot;
      // 0.22 而非 0.4：噪声幅值叠加后是 1.7A，必须仍落在半个槽内。
      const A = amp * slot * 0.22;
      const phase = rnd() * TAU;
      const pts: { x: number; y: number }[] = [];
      for (let k = 0; k <= samples; k++) {
        const t = k / samples;
        // 手绘感 = 低频正弦 + 每点独立的噪声偏移（抖动幅度按槽高归一）。
        pts.push({
          x: t * 100,
          y: baseY + Math.sin(phase + TAU * freq * t) * A + (rnd() - 0.5) * noise * A * 1.4,
        });
      }
      prims.push({ t: 'spline', pts });
    }
    const { d, commands } = serializePrims(prims);
    return { d, strokeOnly: true, commands };
  },
};

export const LINE_GENERATORS: SvgGenSpec[] = [hatch, sine, waveband, squiggle];

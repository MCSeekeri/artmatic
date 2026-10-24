/**
 * defs/radial.ts — 径向族（报告 §7.3 / §6 的 B1–B4）。
 *
 * 三处来自报告的硬约束：
 *  1. **刻度 / 楔形必须是闭合四边形**，不能写成 `M…L…` 的开放线段 ——
 *     evenodd 只认有面积的子路径，开放线段在填充里等于不存在（PoC 踩到）。
 *  2. **射线的长度与角度解耦**：先以中心为锚画一条横线，再绕中心转，
 *     而不是在极坐标里算端点（`tttwinkle` 的做法）。
 *  3. **螺旋要真算**：`dasharray` 错位法只适合描边，填充型螺旋必须采样
 *     阿基米德螺旋再偏移成带。
 */

import {
  CENTER,
  TAU,
  clamp,
  check,
  flag,
  lerp,
  num,
  rad,
  range,
  rngOf,
} from '../shared';
import { pt, polar, serializePrims, type Prim } from '../prims';
import type { SvgGenSpec } from '../types';

const rings: SvgGenSpec = {
  id: 'rings',
  labelKey: 'gen.rings',
  group: 'radial',
  defaultSeed: 5,
  notes:
    'rInner / rOuter are fractions of the 0..100 box (0.46 ≈ 46% of the frame). ' +
    'width is a length in that same box (1 ≈ 1% of the frame side), and it is clamped ' +
    'to 0.9× the gap between neighbouring rings — with many rings a large width is ' +
    'silently capped, so lower count or raise rOuter instead of pushing width up.',
  params: [
    range('count', 'gen.p.count', 2, 24, 1, 8),
    range('rInner', 'gen.p.rInner', 0, 0.42, 0.01, 0.12),
    range('rOuter', 'gen.p.rOuter', 0.12, 0.5, 0.01, 0.46),
    range('width', 'gen.p.width', 0.4, 8, 0.2, 2.4),
    range('start', 'gen.p.start', 0, 360, 5, 0),
    // 默认整圈（同心环）；调到 300 就是一串 C 形弧 —— 与 `spiral` 区分开。
    range('sweep', 'gen.p.sweep', 10, 360, 5, 360),
    /*
     * 带宽衰减：第 i 圈的宽度 × (1 − taper)^i。**负值 = 逐圈变宽**，
     * 所以它是「衰减率」而不是「宽度」——0 就是等宽。
     */
    range('taperWidth', 'gen.p.taperWidth', -0.6, 0.6, 0.02, 0),
  ],
  build(p) {
    const count = clamp(Math.round(num(p, 'count', 8)), 1, 24);
    const rIn = clamp(num(p, 'rInner', 0.12), 0, 0.42) * 100;
    const rOut = clamp(num(p, 'rOuter', 0.46), 0.02, 0.5) * 100;
    // 相邻两圈的实际间距（count=1 时退化成「内外半径之差」）。
    const pitch = Math.abs(rOut - rIn) / Math.max(1, count - 1);
    // 环宽不能超过环间距：重叠部分在 evenodd 下会互相抵消，看起来像「少了几圈」。
    const maxW = Math.max(0.3, pitch * 0.9);
    const w0 = clamp(num(p, 'width', 2.4), 0.1, maxW);
    const taper = clamp(num(p, 'taperWidth', 0), -0.6, 0.6);
    const factor = 1 - taper;
    const a0 = rad(num(p, 'start', 0) - 90);
    const sweepDeg = clamp(num(p, 'sweep', 300), 1, 360);
    const a1 = a0 + rad(sweepDeg);
    const prims: Prim[] = [];
    for (let i = 0; i < count; i++) {
      const r = count === 1 ? (rIn + rOut) / 2 : lerp(rIn, rOut, i / (count - 1));
      // 每圈独立夹取：变宽的那侧也绝不与邻圈重叠（否则 evenodd 挖出缺口）。
      const w = clamp(w0 * Math.pow(factor, i), 0.1, maxW);
      prims.push({
        t: 'band',
        c: pt(CENTER, CENTER),
        r0: Math.max(0, r - w / 2),
        // 外沿夹到 49.5：半径 + 半个环宽越过 50 会让路径出盒（包围盒被撑大）。
        r1: Math.min(49.5, r + w / 2),
        a0,
        a1,
      });
    }
    const { d, commands } = serializePrims(prims);
    return { d, evenOdd: true, commands };
  },
};

const rays: SvgGenSpec = {
  id: 'rays',
  labelKey: 'gen.rays',
  group: 'radial',
  defaultSeed: 18,
  params: [
    range('count', 'gen.p.count', 3, 120, 1, 24),
    range('lenMin', 'gen.p.lenMin', 0.02, 0.5, 0.01, 0.16),
    range('lenMax', 'gen.p.lenMax', 0.02, 0.5, 0.01, 0.46),
    range('width', 'gen.p.width', 0.15, 3, 0.05, 0.9),
    range('rot', 'gen.p.rot', 0, 360, 5, 0),
    check('taper', 'gen.p.taper', true),
  ],
  build(p, seed) {
    const rnd = rngOf(seed);
    const count = clamp(Math.round(num(p, 'count', 24)), 1, 120);
    const rMin = clamp(num(p, 'lenMin', 0.16), 0.01, 0.5) * 100;
    const rMax = Math.max(rMin + 0.5, clamp(num(p, 'lenMax', 0.46), 0.01, 0.5) * 100);
    const width = clamp(num(p, 'width', 0.9), 0.05, 3);
    const base = rad(num(p, 'rot', 0) - 90);
    const taper = flag(p, 'taper');
    const c = pt(CENTER, CENTER);
    const step = TAU / count;
    const prims: Prim[] = [];
    for (let i = 0; i < count; i++) {
      // 长度独立采样、角度按等分推进 —— 长度与角度解耦（`tttwinkle` 的关键）。
      const len = rMin + rnd() * (rMax - rMin);
      const a = base + i * step;
      const half = width / 2 / Math.max(len, 1);
      const p1 = polar(c, len, a - half);
      const p2 = polar(c, len, a + half);
      if (taper) {
        prims.push({ t: 'poly', pts: [c, p1, p2], close: true });
      } else {
        const inner = len * 0.3;
        prims.push({
          t: 'poly',
          pts: [polar(c, inner, a - half), p1, p2, polar(c, inner, a + half)],
          close: true,
        });
      }
    }
    const { d, commands } = serializePrims(prims);
    return { d, commands };
  },
};

const dial: SvgGenSpec = {
  id: 'dial',
  labelKey: 'gen.dial',
  group: 'radial',
  defaultSeed: 42,
  notes:
    'tickLen / ringWidth / tickWidth are lengths in the 0..100 box (1 ≈ 1% of the frame ' +
    'side). Ticks are drawn as closed quads and the ring as a band; the element must be ' +
    'filled (or stroked) or nothing shows.',
  params: [
    range('count', 'gen.p.count', 12, 120, 1, 60),
    range('majorEvery', 'gen.p.majorEvery', 2, 12, 1, 5),
    range('tickLen', 'gen.p.tickLen', 0.01, 0.3, 0.01, 0.1),
    range('majorScale', 'gen.p.majorScale', 1, 3, 0.1, 1.8),
    range('tickWidth', 'gen.p.tickWidth', 0.1, 1.4, 0.05, 0.45),
    range('ringWidth', 'gen.p.ringWidth', 0, 6, 0.2, 1.2),
    /** 刻度**居中**：刻度线的中点对齐「环带那段半径的中点」。 */
    check('centered', 'gen.p.centered', false),
    /** 主刻度翻转：默认共享外沿（由外向内延长），翻转后共享内沿（由内向外延长）。 */
    check('flipMajor', 'gen.p.flipMajor', false),
  ],
  build(p) {
    const count = clamp(Math.round(num(p, 'count', 60)), 4, 120);
    const every = clamp(Math.round(num(p, 'majorEvery', 5)), 1, 12);
    const R = 48;
    const tickLen = clamp(num(p, 'tickLen', 0.1), 0.01, 0.3) * R * 2;
    const majorScale = clamp(num(p, 'majorScale', 1.8), 1, 3);
    const tickW = clamp(num(p, 'tickWidth', 0.45), 0.05, 1.4);
    const ringW = clamp(num(p, 'ringWidth', 1.2), 0, 6);
    const centered = flag(p, 'centered');
    const flip = flag(p, 'flipMajor');
    const c = pt(CENTER, CENTER);
    const prims: Prim[] = [];
    if (ringW > 0) {
      prims.push({ t: 'band', c, r0: Math.max(0.5, R - ringW), r1: R, a0: 0, a1: TAU });
    }
    /*
     * 刻度是**闭合窄四边形**，沿半径方向排布。三种锚定：
     *  - 默认：共享外沿 R，主刻度向**内**延长；
     *  - 翻转：共享主刻度的内沿，主刻度向**外**延长（主刻度到达外沿）；
     *  - 居中：以环带中线为轴，两侧各伸 len/2（翻转时主刻度只向外长）。
     *
     * 返回 **nonzero**（不是 evenodd）：刻度与圆环、刻度与刻度之间的重叠必须是
     * **并集**。evenodd 下交集会被挖空 —— 表现是「刻度穿过环的地方消失」。
     * 环本身仍然是空心的，靠 `band` 内圈的反向绕向（见 prims.ts::band）。
     */
    const mid = ringW > 0 ? R - ringW / 2 : R;
    const minor = tickLen;
    const major = tickLen * majorScale;
    for (let i = 0; i < count; i++) {
      const a = rad((i / count) * 360 - 90);
      const isMajor = i % every === 0;
      const len = isMajor ? major : minor;
      const w = tickW * (isMajor ? 1.6 : 1);
      const ux = Math.cos(a);
      const uy = Math.sin(a);
      const nx = -uy;
      const ny = ux;

      let r0: number;
      let r1: number;
      if (centered) {
        if (flip && isMajor) {
          // 内端固定在短刻度的内侧，主刻度向外延长。
          r0 = mid - minor / 2;
          r1 = r0 + len;
        } else {
          r0 = mid - len / 2;
          r1 = mid + len / 2;
        }
      } else if (flip) {
        r0 = R - major;
        r1 = r0 + len;
      } else {
        r0 = R - len;
        r1 = R;
      }
      // 越界的部分直接切掉：出盒会撑大包围盒（选中框 / 光栅化区域跟着错）。
      const lo = Math.max(0.5, r0);
      const hi = Math.min(49.5, r1);
      if (hi - lo < 0.2) continue;
      prims.push({
        t: 'poly',
        pts: [
          pt(c.x + ux * hi + nx * w, c.y + uy * hi + ny * w),
          pt(c.x + ux * lo + nx * w, c.y + uy * lo + ny * w),
          pt(c.x + ux * lo - nx * w, c.y + uy * lo - ny * w),
          pt(c.x + ux * hi - nx * w, c.y + uy * hi - ny * w),
        ],
        close: true,
      });
    }
    const { d, commands } = serializePrims(prims);
    return { d, commands };
  },
};

const spiral: SvgGenSpec = {
  id: 'spiral',
  labelKey: 'gen.spiral',
  group: 'radial',
  defaultSeed: 9,
  params: [
    range('turns', 'gen.p.turns', 1, 8, 0.1, 3.5),
    range('rStart', 'gen.p.rStart', 0.02, 0.3, 0.01, 0.06),
    range('rEnd', 'gen.p.rEnd', 0.15, 0.5, 0.01, 0.46),
    range('width', 'gen.p.width', 0.2, 3, 0.05, 1),
    range('samples', 'gen.p.samples', 24, 260, 1, 140),
  ],
  build(p) {
    const turns = clamp(num(p, 'turns', 3.5), 0.5, 8);
    const r0 = clamp(num(p, 'rStart', 0.06), 0.01, 0.3) * 100;
    const w = clamp(num(p, 'width', 1), 0.1, 3);
    // 外沿（含半个带宽）不越过 49.5：出盒会撑大包围盒。
    const r1 = Math.min(clamp(num(p, 'rEnd', 0.46), 0.05, 0.5) * 100, 49.5 - w / 2);
    const samples = clamp(Math.round(num(p, 'samples', 140)), 8, 260);
    const c = pt(CENTER, CENTER);
    const outer: { x: number; y: number }[] = [];
    const inner: { x: number; y: number }[] = [];
    for (let i = 0; i <= samples; i++) {
      const t = i / samples;
      // 阿基米德：θ 与 r 同步线性推进。
      const a = t * turns * TAU;
      const r = lerp(r0, r1, t);
      outer.push(polar(c, r + w / 2, a));
      inner.push(polar(c, Math.max(0.2, r - w / 2), a));
    }
    inner.reverse();
    const prims: Prim[] = [
      { t: 'spline', pts: outer },
      { t: 'spline', pts: inner, connect: true },
      { t: 'close' },
    ];
    const { d, commands } = serializePrims(prims);
    return { d, commands };
  },
};

export const RADIAL_GENERATORS: SvgGenSpec[] = [rings, rays, dial, spiral];

/**
 * defs/grid.ts — 网格族（报告 §7.2 / §6 的 A1–A4）。
 *
 * 四个生成器共享一条纪律：**抖动的单位是格距的比例**，不是绝对像素。
 * 用绝对像素的话，把行列数从 8 调到 40，抖动幅度会从「轻微」变成「散架」
 * —— 这是 PoC 踩到的坑（报告 §9.3 表格最后一行）。
 */

import {
  CENTER,
  SHAPE_OPTIONS,
  check,
  clamp,
  flag,
  num,
  range,
  rngOf,
  select,
  str,
} from '../shared';
import { crossPoints, pt, polygonPoints, rectPoints, serializePrims, type Prim } from '../prims';
import type { SvgGenSpec } from '../types';

const tenprint: SvgGenSpec = {
  id: 'tenprint',
  labelKey: 'gen.tenprint',
  group: 'grid',
  defaultSeed: 10,
  params: [
    range('cols', 'gen.p.cols', 4, 36, 1, 16),
    range('rows', 'gen.p.rows', 4, 36, 1, 16),
    range('prob', 'gen.p.prob', 0, 1, 0.05, 0.5),
    range('inset', 'gen.p.inset', 0, 0.45, 0.01, 0.1),
  ],
  build(p, seed) {
    const rnd = rngOf(seed);
    const cols = clamp(Math.round(num(p, 'cols', 16)), 2, 36);
    const rows = clamp(Math.round(num(p, 'rows', 16)), 2, 36);
    const prob = clamp(num(p, 'prob', 0.5), 0, 1);
    const inset = clamp(num(p, 'inset', 0.1), 0, 0.45);
    const cw = 100 / cols;
    const ch = 100 / rows;
    const prims: Prim[] = [];
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        const x0 = x * cw + cw * inset;
        const y0 = y * ch + ch * inset;
        const x1 = (x + 1) * cw - cw * inset;
        const y1 = (y + 1) * ch - ch * inset;
        // 每格两条对角线里挑一条 —— 10 PRINT 的全部内容就这一句。
        prims.push(
          rnd() < prob
            ? { t: 'line', a: pt(x0, y1), b: pt(x1, y0) }
            : { t: 'line', a: pt(x0, y0), b: pt(x1, y1) },
        );
      }
    }
    const { d, commands } = serializePrims(prims);
    return { d, strokeOnly: true, commands };
  },
};

const dotgrid: SvgGenSpec = {
  id: 'dotgrid',
  labelKey: 'gen.dotgrid',
  group: 'grid',
  defaultSeed: 24,
  params: [
    range('cols', 'gen.p.cols', 4, 22, 1, 12),
    range('rows', 'gen.p.rows', 4, 22, 1, 12),
    // `random` 只给点阵：每格从五种图元里抽一个（种子驱动，可复现）。
    select('shape', 'gen.p.shape', 'circle', [
      ...SHAPE_OPTIONS,
      { labelKey: 'gen.opt.random', value: 'random' },
    ]),
    range('size', 'gen.p.size', 0.15, 0.95, 0.05, 0.45),
    {
      type: 'range',
      key: 'crossArm',
      labelKey: 'gen.p.crossArm',
      min: 0.05,
      max: 0.6,
      step: 0.01,
      defaultValue: 0.3,
      // 只在十字（或随机图元，可能抽到十字）时有意义。
      visibleWhen: (v) => v['shape'] === 'cross' || v['shape'] === 'random',
    },
    range('jitter', 'gen.p.jitter', 0, 1, 0.05, 0),
    range('omit', 'gen.p.omit', 0, 0.9, 0.05, 0),
  ],
  build(p, seed) {
    const rnd = rngOf(seed);
    const cols = clamp(Math.round(num(p, 'cols', 12)), 2, 22);
    const rows = clamp(Math.round(num(p, 'rows', 12)), 2, 22);
    const shape = str(p, 'shape', 'circle');
    const size = clamp(num(p, 'size', 0.45), 0.05, 0.95);
    const crossArm = clamp(num(p, 'crossArm', 0.3), 0.05, 0.6);
    const jitter = clamp(num(p, 'jitter', 0), 0, 1);
    const omit = clamp(num(p, 'omit', 0), 0, 0.9);
    const cw = 100 / cols;
    const ch = 100 / rows;
    const short = Math.min(cw, ch);
    const r = (size * short) / 2;
    const amp = (jitter * short) / 2;
    /** 随机图元的候选（顺序固定 ⇒ 同种子抽到同一个）。 */
    const POOL = ['circle', 'square', 'diamond', 'triangle', 'cross'] as const;
    /** 各图元相对半径的外扩系数（视觉重量拉平，不然十字会显得小）。 */
    const EXT: Record<string, number> = { circle: 1, square: 1.25, diamond: 1.35, triangle: 1.45, cross: 1.2 };
    const prims: Prim[] = [];
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        if (omit > 0 && rnd() < omit) continue;
        // 先取随机数再决定画什么：省略率与抖动共用一条流时，顺序一变
        // 整张图就换样（不过同参数同种子仍然逐字节复现）。
        const jx = (rnd() - 0.5) * 2 * amp;
        const jy = (rnd() - 0.5) * 2 * amp;
        // 固定图元**不消耗**随机数：改了 crossArm 之类的参数不该让整张图重排。
        const kind = shape === 'random' ? POOL[Math.floor(rnd() * POOL.length)]! : shape;
        const ex = r * (EXT[kind] ?? 1);
        // 夹进盒内：边缘格的抖动 + 半径会越界，越界会撑大包围盒。
        const c = pt(
          clamp((x + 0.5) * cw + jx, ex + 0.5, 100 - ex - 0.5),
          clamp((y + 0.5) * ch + jy, ex + 0.5, 100 - ex - 0.5),
        );
        if (kind === 'square') {
          prims.push({ t: 'poly', pts: polygonPoints(c, r * 1.25, 4, -45), close: true });
        } else if (kind === 'diamond') {
          prims.push({ t: 'poly', pts: polygonPoints(c, r * 1.35, 4, -90), close: true });
        } else if (kind === 'triangle') {
          prims.push({ t: 'poly', pts: polygonPoints(c, r * 1.45, 3, -90), close: true });
        } else if (kind === 'cross') {
          prims.push({ t: 'poly', pts: crossPoints(c, r * 1.2, crossArm), close: true });
        } else {
          prims.push({ t: 'circle', c, r });
        }
      }
    }
    const { d, commands } = serializePrims(prims);
    return { d, commands };
  },
};

const pixelgrid: SvgGenSpec = {
  id: 'pixelgrid',
  labelKey: 'gen.pixelgrid',
  group: 'grid',
  defaultSeed: 7,
  params: [
    range('cols', 'gen.p.cols', 6, 24, 1, 14),
    range('rows', 'gen.p.rows', 6, 24, 1, 14),
    select('mode', 'gen.p.mode', 'random', [
      { labelKey: 'gen.opt.random', value: 'random' },
      { labelKey: 'gen.opt.checker', value: 'checker' },
    ]),
    range('fill', 'gen.p.fill', 0, 1, 0.05, 0.55),
    range('gap', 'gen.p.gap', 0, 0.45, 0.01, 0.12),
  ],
  build(p, seed) {
    const rnd = rngOf(seed);
    const cols = clamp(Math.round(num(p, 'cols', 14)), 2, 24);
    const rows = clamp(Math.round(num(p, 'rows', 14)), 2, 24);
    const fill = clamp(num(p, 'fill', 0.55), 0, 1);
    const gap = clamp(num(p, 'gap', 0.12), 0, 0.45);
    const checker = str(p, 'mode', 'random') === 'checker';
    const cw = 100 / cols;
    const ch = 100 / rows;
    const w = cw * (1 - gap);
    const h = ch * (1 - gap);
    const gx = (cw - w) / 2;
    const gy = (ch - h) / 2;
    const prims: Prim[] = [];
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        const on = checker ? (x + y) % 2 === 0 : rnd() < fill;
        if (!on) continue;
        prims.push({ t: 'poly', pts: rectPoints(x * cw + gx, y * ch + gy, w, h), close: true });
      }
    }
    const { d, commands } = serializePrims(prims);
    return { d, commands };
  },
};

const honeycomb: SvgGenSpec = {
  id: 'honeycomb',
  labelKey: 'gen.honeycomb',
  group: 'grid',
  defaultSeed: 33,
  params: [
    range('cols', 'gen.p.cols', 3, 18, 1, 8),
    range('rows', 'gen.p.rows', 3, 18, 1, 8),
    range('size', 'gen.p.size', 0.5, 1, 0.02, 0.9),
    check('stagger', 'gen.p.stagger', true),
  ],
  build(p) {
    const cols = clamp(Math.round(num(p, 'cols', 8)), 2, 18);
    const rows = clamp(Math.round(num(p, 'rows', 8)), 2, 18);
    const size = clamp(num(p, 'size', 0.9), 0.2, 1);
    const stagger = flag(p, 'stagger');
    /*
     * 外接圆半径由**两个方向里更紧的那个**决定，否则列数小、行数大时图形会
     * 从上下溢出方盒（溢出会撑大包围盒，选中框与光栅化区域跟着错）。
     *
     * 平顶六边形：宽 2r、高 √3r，列距 1.5r、行距 √3r，奇数列下沉半行。
     */
    const fitW = 100 / (1.5 * (cols - 1) + 2);
    const fitH = 100 / (Math.sqrt(3) * (rows + 0.5 + (stagger ? 0.5 : 0)));
    const rrFit = Math.min(fitW, fitH);
    /*
     * **格距按 rrFit 算、六边形按 size 缩**。若格距也跟着 size 缩，整张图会
     * 自相似地缩小，六边形永远严丝合缝地贴在一起 —— 画出来是一块黑饼，
     * 完全看不出「蜂窝」。
     */
    const rr = rrFit * size;
    const stepX = 1.5 * rrFit;
    const stepY = Math.sqrt(3) * rrFit;
    const totalW = stepX * (cols - 1) + 2 * rrFit;
    const totalH = stepY * (rows - 1) + (stagger ? stepY / 2 : 0) + stepY;
    const ox = (100 - totalW) / 2 + rrFit;
    const oy = (100 - totalH) / 2 + stepY / 2;
    const prims: Prim[] = [];
    for (let col = 0; col < cols; col++) {
      for (let row = 0; row < rows; row++) {
        const c = pt(ox + col * stepX, oy + row * stepY + (stagger && col % 2 ? stepY / 2 : 0));
        // 平顶六边形：顶点从 0° 起，每 60° 一个。
        prims.push({ t: 'poly', pts: polygonPoints(c, rr, 6, 0), close: true });
      }
    }
    const { d, commands } = serializePrims(prims);
    return { d, commands };
  },
};

export const GRID_GENERATORS: SvgGenSpec[] = [tenprint, dotgrid, pixelgrid, honeycomb];

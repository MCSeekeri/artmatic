/**
 * defs/iso.ts — 伪 3D 族（报告 §7.6 / §6 的 E1–E3）。
 *
 * 三个都只是**投影到平面**，没有任何深度缓冲：
 *  - 等距：`(x−y)·cos30, (x+y)·sin30 − z`，立方体由三块菱形拼出；
 *  - 透视：消失点 + 逐层缩放，层与层之间是 evenodd 环带；
 *  - 经纬球：正交投影，经线是椭圆、纬线是水平椭圆。
 *
 * 立方体的三个面共用**一份填充**，所以靠 `gap` 把三块菱形各自向心收一点，
 * 让接缝露出来读出「三个面」—— 单色填充下这是唯一的体感来源。
 */

import { CENTER, TAU, check, clamp, flag, lerp, num, rad, range, select, str } from '../shared';
import { pt, serializePrims, type Prim } from '../prims';
import type { SvgGenSpec } from '../types';

const COS30 = Math.cos(Math.PI / 6);
const SIN30 = 0.5;

/** 把一组点按质心收缩 `gap`（0..0.5）—— 等距立方体的接缝来源。 */
function shrink(pts: { x: number; y: number }[], gap: number): { x: number; y: number }[] {
  if (gap <= 0) return pts;
  let cx = 0;
  let cy = 0;
  for (const p of pts) {
    cx += p.x;
    cy += p.y;
  }
  cx /= pts.length;
  cy /= pts.length;
  return pts.map((p) => ({ x: lerp(cx, p.x, 1 - gap), y: lerp(cy, p.y, 1 - gap) }));
}

const isoGrid: SvgGenSpec = {
  id: 'iso-grid',
  labelKey: 'gen.isoGrid',
  group: 'iso',
  defaultSeed: 17,
  params: [
    range('cols', 'gen.p.cols', 3, 12, 1, 6),
    range('rows', 'gen.p.rows', 3, 12, 1, 6),
    range('size', 'gen.p.size', 0.3, 1, 0.02, 0.86),
    range('height', 'gen.p.height', 0.2, 1.4, 0.05, 0.62),
    range('gap', 'gen.p.gap', 0, 0.3, 0.01, 0.07),
    select('mode', 'gen.p.mode', 'cube', [
      { labelKey: 'gen.opt.cube', value: 'cube' },
      { labelKey: 'gen.opt.top', value: 'top' },
    ]),
  ],
  build(p) {
    const cols = clamp(Math.round(num(p, 'cols', 6)), 1, 12);
    const rows = clamp(Math.round(num(p, 'rows', 6)), 1, 12);
    const size = clamp(num(p, 'size', 0.86), 0.1, 1);
    const height = clamp(num(p, 'height', 0.62), 0.05, 1.4);
    const gap = clamp(num(p, 'gap', 0.07), 0, 0.3);
    const cube = String(p['mode'] ?? 'cube') !== 'top';

    const fitW = 100 / ((cols + rows) * COS30);
    const fitH = 100 / ((cols + rows) * SIN30 + height);
    const s = Math.min(fitW, fitH) * size;
    const ox = CENTER - ((cols - rows) * COS30 * s) / 2;
    const oy = CENTER - (((cols + rows) * SIN30 * s - height * s) / 2);

    /** 世界坐标（格点 + 抬升）→ 屏幕。 */
    const proj = (gx: number, gy: number, z: number): { x: number; y: number } => ({
      x: ox + (gx - gy) * COS30 * s,
      y: oy + (gx + gy) * SIN30 * s - z * s,
    });

    const prims: Prim[] = [];
    for (let i = 0; i < cols; i++) {
      for (let j = 0; j < rows; j++) {
        const x0 = i;
        const y0 = j;
        const x1 = i + 1;
        const y1 = j + 1;
        const top = [
          proj(x0, y0, height),
          proj(x1, y0, height),
          proj(x1, y1, height),
          proj(x0, y1, height),
        ];
        prims.push({ t: 'poly', pts: shrink(top, gap), close: true });
        if (!cube) continue;
        // 右面与左面：各自从底边向上抬 height。
        const right = [
          proj(x1, y0, 0),
          proj(x1, y1, 0),
          proj(x1, y1, height),
          proj(x1, y0, height),
        ];
        const left = [
          proj(x0, y1, 0),
          proj(x1, y1, 0),
          proj(x1, y1, height),
          proj(x0, y1, height),
        ];
        prims.push({ t: 'poly', pts: shrink(right, gap), close: true });
        prims.push({ t: 'poly', pts: shrink(left, gap), close: true });
      }
    }
    const { d, commands } = serializePrims(prims);
    return { d, commands };
  },
};

/**
 * 等距图案（fffuel `mmmotif`）：「模板 + 变换」范式。
 *
 * 一块 motif = 等距积木的可见面（顶面 + 左右面，或只有顶面）；按 `cols×rows`
 * 平铺成图案后，对**整体**做斜切 + 旋转，最后按包围盒缩放居中 —— 任何参数
 * 组合都不会出盒，这比「把角度写进每个顶点」可靠得多。
 *
 * 与 `iso-grid` 的分工：那个是「一片立方体组成的地形」（行列 × 抬升 × 缝隙），
 * 这个是「一个 motif 的重复纹理」，参数只有形状 / 数量 / 斜切 / 角度。
 */
const motif: SvgGenSpec = {
  id: 'motif',
  labelKey: 'gen.motif',
  group: 'iso',
  defaultSeed: 71,
  params: [
    select('shape', 'gen.p.shape', 'cube', [
      { labelKey: 'gen.opt.cube', value: 'cube' },
      { labelKey: 'gen.opt.prism', value: 'prism' },
      { labelKey: 'gen.opt.stair', value: 'stair' },
      { labelKey: 'gen.opt.diamond', value: 'diamond' },
    ]),
    range('cols', 'gen.p.cols', 1, 6, 1, 3),
    range('rows', 'gen.p.rows', 1, 6, 1, 3),
    range('gap', 'gen.p.gap', 0, 0.3, 0.01, 0.06),
    range('angle', 'gen.p.angle', -180, 180, 5, 0),
    range('slant', 'gen.p.slant', -0.6, 0.6, 0.02, 0),
  ],
  build(p) {
    const shape = str(p, 'shape', 'cube');
    const cols = clamp(Math.round(num(p, 'cols', 3)), 1, 6);
    const rows = clamp(Math.round(num(p, 'rows', 3)), 1, 6);
    const gap = clamp(num(p, 'gap', 0.06), 0, 0.3);
    const angle = rad(num(p, 'angle', 0));
    const slant = clamp(num(p, 'slant', 0), -0.6, 0.6);

    /** 局部单位空间的等距投影（z 向上）。 */
    const proj = (x: number, y: number, z: number): { x: number; y: number } => ({
      x: (x - y) * COS30,
      y: (x + y) * SIN30 - z,
    });

    /** 一块积木的可见面；`topOnly` 只要顶面（菱形平铺）。 */
    const block = (
      x0: number,
      y0: number,
      sx: number,
      sy: number,
      h: number,
      topOnly: boolean,
    ): { x: number; y: number }[][] => {
      const out = [
        shrink(
          [proj(x0, y0, h), proj(x0 + sx, y0, h), proj(x0 + sx, y0 + sy, h), proj(x0, y0 + sy, h)],
          gap,
        ),
      ];
      if (!topOnly) {
        out.push(
          shrink(
            [
              proj(x0 + sx, y0, 0),
              proj(x0 + sx, y0 + sy, 0),
              proj(x0 + sx, y0 + sy, h),
              proj(x0 + sx, y0, h),
            ],
            gap,
          ),
          shrink(
            [
              proj(x0, y0 + sy, 0),
              proj(x0 + sx, y0 + sy, 0),
              proj(x0 + sx, y0 + sy, h),
              proj(x0, y0 + sy, h),
            ],
            gap,
          ),
        );
      }
      return out;
    };

    const faces: { x: number; y: number }[][] = [];
    // 平铺步长：立方体的水平投影是 `2·cos30 × 1.5`，取得比它略大一点点，
    // 让相邻积木的侧面贴上（单色填充下就是一张连续图案）。
    const dx = 1.75;
    const dy = 1.55;
    for (let c = 0; c < cols; c++) {
      for (let r = 0; r < rows; r++) {
        const ox = c * dx;
        const oy = r * dy;
        if (shape === 'prism') {
          faces.push(...block(ox, oy, 2, 1, 0.8, false));
        } else if (shape === 'stair') {
          // 两级台阶：左高右低（同一底边，只是顶面高度不同）。
          faces.push(...block(ox, oy, 1, 1, 1.15, false));
          faces.push(...block(ox + 1, oy, 1, 1, 0.55, false));
        } else if (shape === 'diamond') {
          faces.push(...block(ox, oy, 1.4, 1.4, 0, true));
        } else {
          faces.push(...block(ox, oy, 1, 1, 1, false));
        }
      }
    }

    // 斜切 → 旋转（都绕原点，最后再按包围盒归位，所以顺序不影响出盒）。
    const sheared = faces.map((f) => f.map((q) => ({ x: q.x + slant * q.y, y: q.y })));
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const moved = sheared.map((f) =>
      f.map((q) => ({ x: q.x * cos - q.y * sin, y: q.x * sin + q.y * cos })),
    );

    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const f of moved) {
      for (const q of f) {
        if (q.x < minX) minX = q.x;
        if (q.x > maxX) maxX = q.x;
        if (q.y < minY) minY = q.y;
        if (q.y > maxY) maxY = q.y;
      }
    }
    // 96 的可用宽度（留 2 的边距），等比缩放居中。
    const k = 96 / Math.max(1e-6, maxX - minX, maxY - minY);
    const ox = 50 - ((minX + maxX) / 2) * k;
    const oy = 50 - ((minY + maxY) / 2) * k;
    const prims: Prim[] = moved.map((f) => ({
      t: 'poly',
      pts: f.map((q) => pt(q.x * k + ox, q.y * k + oy)),
      close: true,
    }));
    const { d, commands } = serializePrims(prims);
    return { d, commands };
  },
};

const perspective: SvgGenSpec = {
  id: 'perspective',
  labelKey: 'gen.perspective',
  group: 'iso',
  defaultSeed: 61,
  params: [
    range('layers', 'gen.p.layers', 2, 20, 1, 8),
    range('vpX', 'gen.p.vpX', 0.2, 0.8, 0.01, 0.5),
    range('vpY', 'gen.p.vpY', 0.1, 0.7, 0.01, 0.3),
    range('depth', 'gen.p.depth', 0.4, 4, 0.1, 2.2),
    range('gap', 'gen.p.gap', 0, 0.7, 0.05, 0.35),
    range('inset', 'gen.p.inset', 0, 0.25, 0.01, 0.04),
  ],
  build(p) {
    const layers = clamp(Math.round(num(p, 'layers', 8)), 1, 20);
    const vpX = clamp(num(p, 'vpX', 0.5), 0, 1) * 100;
    const vpY = clamp(num(p, 'vpY', 0.3), 0, 1) * 100;
    const depth = clamp(num(p, 'depth', 2.2), 0.2, 4);
    const gap = clamp(num(p, 'gap', 0.35), 0, 0.7);
    const inset = clamp(num(p, 'inset', 0.04), 0, 0.25) * 100;
    const vp = pt(vpX, vpY);
    const outer: { x: number; y: number }[] = [
      pt(inset, inset),
      pt(100 - inset, inset),
      pt(100 - inset, 100 - inset),
      pt(inset, 100 - inset),
    ];
    /** 朝着消失点缩 `t`（0 = 原样，1 = 收到一点）。 */
    const rectAt = (t: number): { x: number; y: number }[] =>
      outer.map((q) => ({ x: lerp(vp.x, q.x, t), y: lerp(vp.y, q.y, t) }));
    const prims: Prim[] = [];
    for (let i = 0; i < layers; i++) {
      /*
       * `s` 是「朝消失点走了多远」（0 = 外框，1 = 收成一点）。
       * 每一层只画 `s0..s1` 这一段，**层与层之间留 `gap`** ——
       * 不留缝的话 20 段首尾相接正好铺满整个方框，画面是一块纯黑。
       */
      const s0 = Math.pow(i / layers, depth);
      const s1 = Math.pow((i + (1 - gap)) / layers, depth);
      /*
       * 必须是**两条子路径**（外框一条、内框一条），不能把内框顶点接在外框
       * 顶点后面：后者是一个自交多边形，evenodd 会在连接线段之间涂出蝴蝶结。
       */
      prims.push({ t: 'poly', pts: rectAt(1 - s0), close: true });
      prims.push({ t: 'poly', pts: rectAt(1 - s1), close: true });
    }
    const { d, commands } = serializePrims(prims);
    return { d, evenOdd: true, commands };
  },
};

const globe: SvgGenSpec = {
  id: 'globe',
  labelKey: 'gen.globe',
  group: 'iso',
  defaultSeed: 44,
  params: [
    range('meridians', 'gen.p.meridians', 4, 36, 1, 12),
    range('parallels', 'gen.p.parallels', 2, 18, 1, 7),
    range('tilt', 'gen.p.tilt', -60, 60, 1, 23),
    range('radius', 'gen.p.radius', 0.25, 0.48, 0.01, 0.42),
    /** 外接圆（球的轮廓线）。正交投影下球的剪影永远是半径 R 的圆。 */
    check('outline', 'gen.p.outline', false),
  ],
  build(p) {
    const meridians = clamp(Math.round(num(p, 'meridians', 12)), 3, 36);
    const parallels = clamp(Math.round(num(p, 'parallels', 7)), 1, 18);
    const tilt = rad(clamp(num(p, 'tilt', 23), -80, 80));
    const R = clamp(num(p, 'radius', 0.42), 0.1, 0.48) * 100;
    const c = pt(CENTER, CENTER);
    const sinT = Math.sin(tilt);
    const cosT = Math.cos(tilt);
    /** 正交投影：λ 经度、φ 纬度（弧度）。 */
    const project = (lat: number, lon: number): { x: number; y: number } => {
      const cl = Math.cos(lat);
      const x = cl * Math.sin(lon);
      const y = cl * Math.cos(lon);
      const z = Math.sin(lat);
      // 绕 X 轴倾斜：屏幕 y 向下，所以取负。
      return { x: c.x + x * R, y: c.y - (y * sinT + z * cosT) * R };
    };
    const steps = 36;
    const prims: Prim[] = [];
    // 外接圆：正交投影下球的剪影就是半径 R 的圆，与倾角无关。
    if (flag(p, 'outline')) prims.push({ t: 'circle', c, r: R });
    for (let m = 0; m < meridians; m++) {
      const lon = (TAU * m) / meridians;
      const pts: { x: number; y: number }[] = [];
      for (let i = 0; i <= steps; i++) {
        const lat = -Math.PI / 2 + (Math.PI * i) / steps;
        pts.push(project(lat, lon));
      }
      prims.push({ t: 'spline', pts });
    }
    for (let r = 1; r < parallels; r++) {
      const lat = -Math.PI / 2 + (Math.PI * r) / parallels;
      const pts: { x: number; y: number }[] = [];
      for (let i = 0; i <= steps; i++) {
        pts.push(project(lat, (TAU * i) / steps));
      }
      prims.push({ t: 'spline', pts });
    }
    const { d, commands } = serializePrims(prims);
    return { d, strokeOnly: true, commands };
  },
};

export const ISO_GENERATORS: SvgGenSpec[] = [isoGrid, motif, perspective, globe];

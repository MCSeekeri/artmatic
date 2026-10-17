/**
 * prims.ts — 极薄几何 IR + **唯一**的 `d` 序列化出口。
 *
 * 为什么不许各个生成器自己拼字符串（报告 §9.2 / `src/typography/AGENTS.md`
 * 第 60-76 行记过的坑）：
 *
 *  1. **相对命令的当前点会串味** —— 多条 `d` 拼在一起时，`m` / `l` 的起点
 *     从「上一条子路径的终点」算起，图元整体错位。
 *  2. **闭合带的第二沿必须 `L` 接上**，不能另起 `M` —— 否则 evenodd 会把
 *     带子算成两片互相抵消的形状，画面是空白。
 *  3. **`A` 命令的两个 flag 是单字符**，与相邻数字粘在一起时（`011.412`）
 *     下游解析会少读一个参数、整条弧被丢掉。这里一律输出 `C`（弧→贝塞尔），
 *     与现有 `icon-shapes.ts` / `path-nodes.ts` 的口径一致。
 *
 * 坐标一律 round 到 **2 位小数**（与 `shapes.ts::n()` 同源）：路径字符串不稳定
 * 会让 `docHash` 每次不同，光栅化缓存全部失效。
 */

export interface Pt {
  x: number;
  y: number;
}

/**
 * 图元。全部以「能表达面积」为准：
 *  - `line`  开放线段（只在描边类里用；填充里等于不存在）
 *  - `poly`  折线 / 多边形
 *  - `circle` / `ellipse` → 4 段三次贝塞尔
 *  - `band`  环带（内外半径 + 起止角），整圈时退化成两条同心圆
 *  - `spline` Catmull-Rom 样条（闭合 / 开放 / 用 `L` 接上前一点）
 */
export type Prim =
  | { t: 'line'; a: Pt; b: Pt }
  | { t: 'poly'; pts: Pt[]; close?: boolean }
  | { t: 'circle'; c: Pt; r: number }
  | { t: 'ellipse'; c: Pt; rx: number; ry: number }
  | { t: 'band'; c: Pt; r0: number; r1: number; a0: number; a1: number }
  | { t: 'spline'; pts: Pt[]; close?: boolean; connect?: boolean }
  /** 只发一个 `Z`。闭合带（两沿样条 + 平口）靠它收尾。 */
  | { t: 'close' };

/** 圆的四段贝塞尔常数。 */
export const KAPPA = 0.5522847498307936;

const TAU = Math.PI * 2;

/** 2 位小数（与 `shapes.ts::n()` 同一口径）。 */
export function n(v: number): string {
  return String(Math.round(v * 100) / 100);
}

export function pt(x: number, y: number): Pt {
  return { x, y };
}

/** 圆上一点（角度按弧度；y 轴向下，所以正角在屏幕上顺时针）。 */
export function polar(c: Pt, r: number, a: number): Pt {
  return { x: c.x + r * Math.cos(a), y: c.y + r * Math.sin(a) };
}

export interface SerializedPath {
  d: string;
  commands: number;
}

/**
 * 图元 → 一条 `d`。
 *
 * `commands` 是**真实发出**的命令数（`M` / `L` / `C` / `Z` 各算一条），
 * 不是按图元估的 —— UI 的预算守卫与单测都靠它。
 */
export function serializePrims(prims: readonly Prim[]): SerializedPath {
  const out: string[] = [];
  let commands = 0;

  const M = (p: Pt): void => {
    out.push(`M${n(p.x)},${n(p.y)}`);
    commands++;
  };
  const L = (p: Pt): void => {
    out.push(`L${n(p.x)},${n(p.y)}`);
    commands++;
  };
  const CPC = (a: Pt, b: Pt, p: Pt): void => {
    out.push(`C${n(a.x)},${n(a.y)} ${n(b.x)},${n(b.y)} ${n(p.x)},${n(p.y)}`);
    commands++;
  };
  const Z = (): void => {
    out.push('Z');
    commands++;
  };

  /** 圆弧 → 若干段三次贝塞尔（每段 ≤ 90°），**不移动当前点**（起点已就位）。 */
  const arcTo = (c: Pt, r: number, a0: number, a1: number): void => {
    const sweep = a1 - a0;
    const steps = Math.max(1, Math.ceil(Math.abs(sweep) / (Math.PI / 2)));
    const step = sweep / steps;
    let a = a0;
    for (let i = 0; i < steps; i++) {
      const b = a + step;
      const k = (4 / 3) * Math.tan(step / 4) * r;
      const p0 = polar(c, r, a);
      const p1 = polar(c, r, b);
      const t0 = { x: -Math.sin(a), y: Math.cos(a) };
      const t1 = { x: -Math.sin(b), y: Math.cos(b) };
      CPC(
        { x: p0.x + t0.x * k, y: p0.y + t0.y * k },
        { x: p1.x - t1.x * k, y: p1.y - t1.y * k },
        p1,
      );
      a = b;
    }
  };

  /**
   * 圆 → 4 段贝塞尔（顺时针，与 `shapes.ts::ellipse` 同向）。
   *
   * `reverse` 发逆时针。**环带的内圈必须逆时针**：nonzero 下「外圈顺时针 +
   * 内圈逆时针」才是一个环，否则是实心圆盘。evenodd 不受影响（奇偶与方向无关）。
   */
  const ring = (c: Pt, rx: number, ry: number, reverse = false): void => {
    const kx = rx * KAPPA;
    const ky = ry * KAPPA;
    M({ x: c.x + rx, y: c.y });
    if (reverse) {
      CPC({ x: c.x + rx, y: c.y - ky }, { x: c.x + kx, y: c.y - ry }, { x: c.x, y: c.y - ry });
      CPC({ x: c.x - kx, y: c.y - ry }, { x: c.x - rx, y: c.y - ky }, { x: c.x - rx, y: c.y });
      CPC({ x: c.x - rx, y: c.y + ky }, { x: c.x - kx, y: c.y + ry }, { x: c.x, y: c.y + ry });
      CPC({ x: c.x + kx, y: c.y + ry }, { x: c.x + rx, y: c.y + ky }, { x: c.x + rx, y: c.y });
    } else {
      CPC({ x: c.x + rx, y: c.y + ky }, { x: c.x + kx, y: c.y + ry }, { x: c.x, y: c.y + ry });
      CPC({ x: c.x - kx, y: c.y + ry }, { x: c.x - rx, y: c.y + ky }, { x: c.x - rx, y: c.y });
      CPC({ x: c.x - rx, y: c.y - ky }, { x: c.x - kx, y: c.y - ry }, { x: c.x, y: c.y - ry });
      CPC({ x: c.x + kx, y: c.y - ry }, { x: c.x + rx, y: c.y - ky }, { x: c.x + rx, y: c.y });
    }
    Z();
  };

  /** Catmull-Rom（张力 1/6）→ 三次贝塞尔。 */
  const spline = (pts: readonly Pt[], close: boolean, connect: boolean): void => {
    const count = pts.length;
    if (count < 2) return;
    if (connect) L(pts[0]!);
    else M(pts[0]!);
    const last = close ? count : count - 1;
    /*
     * 闭合曲线按环形取邻点；**开放曲线必须夹取**，不能取模 ——
     * 取模会让首点的「前一个控制点」变成末点、末点的「后一个」变成首点，
     * 于是两端的切线完全错向，曲线在端部甩出盒外一大截（实测 -15，盒是 0..100）。
     */
    const at = (k: number): Pt => pts[close ? (k + count) % count : Math.min(count - 1, Math.max(0, k))]!;
    for (let i = 0; i < last; i++) {
      const p0 = at(i - 1);
      const p1 = at(i);
      const p2 = at(i + 1);
      const p3 = at(i + 2);
      CPC(
        { x: p1.x + (p2.x - p0.x) / 6, y: p1.y + (p2.y - p0.y) / 6 },
        { x: p2.x - (p3.x - p1.x) / 6, y: p2.y - (p3.y - p1.y) / 6 },
        p2,
      );
    }
    if (close) Z();
  };

  for (const p of prims) {
    switch (p.t) {
      case 'line':
        M(p.a);
        L(p.b);
        break;

      case 'poly': {
        const pts = p.pts;
        if (pts.length < 2) break;
        M(pts[0]!);
        for (let i = 1; i < pts.length; i++) L(pts[i]!);
        if (p.close) Z();
        break;
      }

      case 'circle':
        if (p.r > 0) ring(p.c, p.r, p.r);
        break;

      case 'ellipse':
        if (p.rx > 0 && p.ry > 0) ring(p.c, p.rx, p.ry);
        break;

      case 'band': {
        const r0 = Math.min(p.r0, p.r1);
        const r1 = Math.max(p.r0, p.r1);
        if (r1 <= 0) break;
        const sweep = p.a1 - p.a0;
        /*
         * 整圈：两条同心闭合圆。内圈**反向**发 —— evenodd 下一样是环带，
         * 而 nonzero 下这才是一个环（同向的话外圈会盖住内圈的空洞）。
         * 「环 + 与环相交的刻度」这类图形必须走 nonzero 才能把交集填上。
         */
        if (Math.abs(sweep) >= TAU - 1e-6) {
          ring(p.c, r1, r1);
          if (r0 > 0) ring(p.c, r0, r0, true);
          break;
        }
        if (r0 <= 0) {
          // 扇形：圆心 → 外弧 → 回圆心。
          M(p.c);
          L(polar(p.c, r1, p.a0));
          arcTo(p.c, r1, p.a0, p.a1);
          Z();
          break;
        }
        M(polar(p.c, r1, p.a0));
        arcTo(p.c, r1, p.a0, p.a1);
        L(polar(p.c, r0, p.a1));
        arcTo(p.c, r0, p.a1, p.a0);
        Z();
        break;
      }

      case 'spline':
        spline(p.pts, p.close === true, p.connect === true);
        break;

      case 'close':
        Z();
        break;
    }
  }

  return { d: out.join(''), commands };
}

/** 正多边形顶点（从正上方起画，与 `shapes.ts::polygonPoints` 同款）。 */
export function polygonPoints(c: Pt, r: number, sides: number, rotDeg = -90): Pt[] {
  const count = Math.max(3, Math.round(sides));
  const rot = (rotDeg * Math.PI) / 180;
  const out: Pt[] = [];
  for (let i = 0; i < count; i++) {
    const a = rot + (TAU * i) / count;
    out.push(polar(c, r, a));
  }
  return out;
}

/** 矩形 → 闭合折线（fill 与 evenodd 都认的形态）。 */
export function rectPoints(x: number, y: number, w: number, h: number): Pt[] {
  return [
    { x, y },
    { x: x + w, y },
    { x: x + w, y: y + h },
    { x, y: y + h },
  ];
}

/**
 * 十字（加号）的 12 个顶点，外接于半径 `r` 的圆，臂厚 = `r * arm`（臂半宽）。
 *
 * 必须是多边形而不是两条线：点阵是填充型生成器，开放线段在填充里等于不存在
 * （刻度盘的刻度踩过同一个坑）。`arm` 是**粗细微调**，取值 0.05..0.6。
 */
export function crossPoints(c: Pt, r: number, arm: number): Pt[] {
  const t = Math.max(0.02, Math.min(0.95, arm)) * r;
  return [
    { x: c.x - t, y: c.y - r },
    { x: c.x + t, y: c.y - r },
    { x: c.x + t, y: c.y - t },
    { x: c.x + r, y: c.y - t },
    { x: c.x + r, y: c.y + t },
    { x: c.x + t, y: c.y + t },
    { x: c.x + t, y: c.y + r },
    { x: c.x - t, y: c.y + r },
    { x: c.x - t, y: c.y + t },
    { x: c.x - r, y: c.y + t },
    { x: c.x - r, y: c.y - t },
    { x: c.x - t, y: c.y - t },
  ];
}

/**
 * 轴对齐盒裁剪一条无限直线（`c + u·t`），返回 `[t0, t1]`；不相交返回 null。
 *
 * 斜纹 / 线族用它把线收进 0..100，而不是让端点飞到盒外几百个单位 ——
 * 坐标越界的 `d` 会撑大包围盒（选中框、布尔运算、光栅化区域全都跟着错）。
 */
export function clipLineToBox(
  c: Pt,
  u: Pt,
  box: { x0: number; y0: number; x1: number; y1: number },
): [number, number] | null {
  let t0 = -Infinity;
  let t1 = Infinity;
  const axes: [number, number, number, number][] = [
    [c.x, u.x, box.x0, box.x1],
    [c.y, u.y, box.y0, box.y1],
  ];
  for (const [p, d, lo, hi] of axes) {
    if (Math.abs(d) < 1e-9) {
      if (p < lo || p > hi) return null;
      continue;
    }
    const a = (lo - p) / d;
    const b = (hi - p) / d;
    t0 = Math.max(t0, Math.min(a, b));
    t1 = Math.min(t1, Math.max(a, b));
  }
  return t0 <= t1 ? [t0, t1] : null;
}

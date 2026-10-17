/**
 * defs/contour.ts — 等高线（报告 §6 的 F1，二期）。
 *
 * 等高线 = **CPU 高度场 + marching squares**，不是 GLSL、不是滤镜。
 * 报告（§9.6 二期 / `rahoo.md` §3.10）的结论很清楚：rahoo 里能导出 SVG 的
 * 那条路径是纯 CPU 的，three.js 那条只有 PNG。所以这里与 WebGL 完全无关，
 * 输出就是可编辑的折线。
 *
 * 与 rahoo 的三处差异（都是它没做好的地方）：
 *  1. **种子化**：它的置换表用 `Math.random()` 打乱，刷新一次地形就换样；
 *     这里噪声完全由 `seed` 决定（`noise.ts`），同参同种子必然复现。
 *  2. **高度场归一化**：按采样结果的 min/max 归到 0..1 再取等值线，
 *     于是「层数」滑杆在任何噪声配置下都真的给出那么多层（它的阈值是写死的
 *     比例，换个缩放就整片空白）。
 *  3. **散段先串成折线**：不然每个格子边界都会露出一个描边圆头。
 */

import { clamp, num, range } from '../shared';
import { fbm2D, makeNoise2D } from '../noise';
import { pt, serializePrims, type Prim, type Pt } from '../prims';
import type { SvgGenSpec } from '../types';

/**
 * marching squares 的 16 种局面 → 边对。
 *
 * 角位：bit3=左上(0)、bit2=右上(1)、bit1=右下(2)、bit0=左下(3)。
 * 边号：0=上、1=右、2=下、3=左。
 *
 * `5` / `10` 是鞍点（对角线上的两角同时在上方），输出两段；**不做中心值判定** ——
 * 那会让相邻两层在同一个格子里给出不一致的连接，视觉上是「线头对不上」。
 */
const CASES: readonly (readonly (readonly [number, number])[])[] = [
  [], // 0
  [[3, 2]], // 1  左下
  [[2, 1]], // 2  右下
  [[3, 1]], // 3  下排
  [[0, 1]], // 4  右上
  // 5 是鞍点：TR(4)+BL(1) 在上方 ⇒ 线段各自绕着**单个角**走。
  // 写成 [[0,3],[1,2]] 会连到对角线方向 —— 与邻格的接点对不上，等高线断成一截截。
  [
    [0, 1],
    [2, 3],
  ],
  [[0, 2]], // 6  右列
  [[0, 3]], // 7  只有左上在下
  [[0, 3]], // 8  左上
  [[0, 2]], // 9  左列
  // 10 是鞍点：TL(8)+BR(2) 在上方 ⇒ 绕 TL 与 BR 各一段。
  [
    [0, 3],
    [1, 2],
  ],
  // 11 = TL+BR+BL 在上 ⇒ **TR 在下**（孤立角是右上）→ 上 + 右。
  [[0, 1]], // 11
  [[3, 1]], // 12 上排
  // 13 = TL+TR+BL 在上 ⇒ **BR 在下**（孤立角是右下）→ 下 + 右。
  [[1, 2]], // 13
  [[3, 2]], // 14 左下
  [], // 15
];

interface Seg {
  a: Pt;
  b: Pt;
  /** 端点所在的**网格边编号**（不是坐标）—— 串线的唯一依据，见 stitchSegments。 */
  ka: string;
  kb: string;
}

/** 单层等值线的散段（导出供单测用：串线是这一族最容易错的一步）。 */
export function marchLevel(field: Float32Array, n: number, step: number, level: number): Seg[] {
  const out: Seg[] = [];
  const at = (i: number, j: number): number => field[j * n + i]!;

  for (let j = 0; j < n - 1; j++) {
    for (let i = 0; i < n - 1; i++) {
      const v00 = at(i, j);
      const v10 = at(i + 1, j);
      const v11 = at(i + 1, j + 1);
      const v01 = at(i, j + 1);
      let idx = 0;
      if (v00 >= level) idx |= 8;
      if (v10 >= level) idx |= 4;
      if (v11 >= level) idx |= 2;
      if (v01 >= level) idx |= 1;
      const pairs = CASES[idx]!;
      if (!pairs.length) continue;

      const x0 = i * step;
      const y0 = j * step;
      /**
       * 某条边上的插值交点 + 这条网格边的编号。
       *
       * 编号的两种形态：`h:i:j`（(i,j)→(i+1,j) 的水平边）、`v:i:j`（(i,j)→(i,j+1)
       * 的竖直边）。相邻格子算出的同一条边共用同一个编号 —— 这比「按坐标
       * 量化」可靠：0.005 的边界上，两次计算差 1e-15 就会落到不同的桶里，
       * 表现是等高线在缓坡上断成一截一截（踩过）。
       */
      const edge = (e: number): { p: Pt; k: string } => {
        const t = (a: number, b: number): number => {
          const d = b - a;
          // 同值边不可能被这个 case 选中；`|| 1` 只是防御除零。
          return clamp((level - a) / (Math.abs(d) < 1e-9 ? 1 : d), 0, 1);
        };
        switch (e) {
          case 0:
            return { p: pt(x0 + t(v00, v10) * step, y0), k: `h:${i}:${j}` };
          case 1:
            return { p: pt(x0 + step, y0 + t(v10, v11) * step), k: `v:${i + 1}:${j}` };
          case 2:
            return { p: pt(x0 + t(v01, v11) * step, y0 + step), k: `h:${i}:${j + 1}` };
          default:
            return { p: pt(x0, y0 + t(v00, v01) * step), k: `v:${i}:${j}` };
        }
      };

      for (const [e1, e2] of pairs) {
        const p1 = edge(e1);
        const p2 = edge(e2);
        out.push({ a: p1.p, b: p2.p, ka: p1.k, kb: p2.k });
      }
    }
  }
  return out;
}

/**
 * 散段 → 折线：按**网格边编号**建邻接表，两头接起来。
 *
 * 为什么不用坐标量化：两条相邻格子算出的同一点在浮点上只差 1e-15，但只要它
 * 正好落在量化边界（`x*100 = 312.5`）两侧，`Math.round` 就会给出 312 与 313
 * 两个不同的 key，于是那条线在缓坡上断掉。网格边编号是**结构**上的同一性，
 * 不存在舍入边界。
 */
export function stitchSegments(segs: readonly Seg[]): Pt[][] {
  const adj = new Map<string, number[]>();
  segs.forEach((s, i) => {
    for (const k of [s.ka, s.kb]) {
      const list = adj.get(k);
      if (list) list.push(i);
      else adj.set(k, [i]);
    }
  });

  const used = new Uint8Array(segs.length);
  const chains: Pt[][] = [];

  /** 从 `start` 出发（当前段已用），沿 `other` 方向一路吃到没有未用段为止。 */
  const walk = (start: Pt, other: Pt, key: string): Pt[] => {
    const pts: Pt[] = [start, other];
    let cur = key;
    for (;;) {
      const list = adj.get(cur);
      if (!list) break;
      let next = -1;
      for (const si of list) {
        if (!used[si]) {
          next = si;
          break;
        }
      }
      if (next < 0) break;
      used[next] = 1;
      const s = segs[next]!;
      const atA = s.ka === cur;
      cur = atA ? s.kb : s.ka;
      pts.push(atA ? s.b : s.a);
    }
    return pts;
  };

  for (let i = 0; i < segs.length; i++) {
    if (used[i]) continue;
    used[i] = 1;
    const s = segs[i]!;
    const fwd = walk(s.a, s.b, s.kb);
    const back = walk(s.b, s.a, s.ka);
    // back 去掉起点 b 再反向，末尾那个点就是 fwd 的起点（去重）。
    const head = back.slice(1).reverse();
    head.pop();
    chains.push([...head, ...fwd]);
  }
  return chains;
}

/**
 * 折线简化：丢掉「落在前后两点连线附近」的中间点（误差 ≤ `eps`，authored 单位）。
 *
 * 等高线的点在数学上是密的，但一条曲率半径 10、步长 2 的弧上，中间点离弦
 * 只有 0.05 —— 全都发出去就是 3～4 倍的命令数，而画面上**看不出差别**。
 * 这是几何保真度上的取舍，不是偷偷改用户参数（参数该多少还是多少）。
 */
function simplify(pts: readonly Pt[], eps: number): Pt[] {
  if (pts.length < 3) return [...pts];
  const out: Pt[] = [pts[0]!];
  for (let i = 1; i < pts.length - 1; i++) {
    const a = out[out.length - 1]!;
    const b = pts[i]!;
    const c = pts[i + 1]!;
    const dx = c.x - a.x;
    const dy = c.y - a.y;
    const len = Math.hypot(dx, dy);
    if (len < 1e-9) continue;
    const dev = Math.abs((b.x - a.x) * dy - (b.y - a.y) * dx) / len;
    if (dev >= eps) out.push(b);
  }
  out.push(pts[pts.length - 1]!);
  return out;
}

const contour: SvgGenSpec = {
  id: 'contour',
  labelKey: 'gen.contour',
  group: 'outline',
  defaultSeed: 127,
  params: [
    /** 山峰数量：越多噪声基频越高、谷越平（与 rahoo 同一语义）。 */
    range('peaks', 'gen.p.peaks', 1, 6, 1, 2),
    range('noiseScale', 'gen.p.noiseScale', 0.6, 5, 0.1, 2.2),
    /*
     * 上限由命令预算倒推：`samples × levels` 决定折线点数，实测「全部参数取最大 +
     * 8 个不同种子」的最坏值在 32×10 时约 2600 条（预算 3000）。
     * 再多就不是「更精细」而是「一张几百 KB 的路径」了。
     */
    range('samples', 'gen.p.samples', 12, 32, 1, 30),
    range('levels', 'gen.p.levels', 3, 10, 1, 8),
    range('octaves', 'gen.p.octaves', 1, 5, 1, 2),
    range('roughness', 'gen.p.roughness', 0.15, 0.8, 0.05, 0.42),
  ],
  build(p, seed) {
    const peaks = clamp(Math.round(num(p, 'peaks', 2)), 1, 6);
    const scale = clamp(num(p, 'noiseScale', 2.2), 0.2, 6);
    const samples = clamp(Math.round(num(p, 'samples', 30)), 8, 32);
    const levels = clamp(Math.round(num(p, 'levels', 8)), 1, 10);
    const octaves = clamp(Math.round(num(p, 'octaves', 2)), 1, 5);
    const gain = clamp(num(p, 'roughness', 0.42), 0.1, 0.85);

    const noise = makeNoise2D(seed);
    const n = samples + 1;
    const step = 100 / samples;
    // 基频：山峰越多，单位长度里塞进越多的起伏。
    const freq = (scale * (0.5 + peaks * 0.2)) / 100;

    const field = new Float32Array(n * n);
    let lo = Infinity;
    let hi = -Infinity;
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const x = i * step;
        const y = j * step;
        // 山峰越多，谷越平（幂次 > 1）—— 否则高峰会把低层挤成一片。
        const v = Math.pow(fbm2D(noise, x, y, octaves, gain, freq), 1 + peaks * 0.12);
        field[j * n + i] = v;
        if (v < lo) lo = v;
        if (v > hi) hi = v;
      }
    }
    // 归一化：层数滑杆在任何噪声配置下都给出同样多的层。
    const span = hi - lo;
    if (span > 1e-6) {
      for (let k = 0; k < field.length; k++) field[k] = (field[k]! - lo) / span;
    }

    const prims: Prim[] = [];
    for (let l = 1; l <= levels; l++) {
      const level = l / (levels + 1);
      /*
       * 简化阈值跟着网格步长走：步长 3 个 authored 单位时，去几个 0.3 单位的
       * 摆动对画面没有意义（元素最终宽 160–600px，0.3 单位不到 2px），
       * 但命令数会翻倍。下限 0.25 防止高分辨率时把真拐角抹平。
       */
      const eps = Math.max(0.25, step * 0.3);
      for (const chain of stitchSegments(marchLevel(field, n, step, level))) {
        const pts = simplify(chain, eps);
        if (pts.length >= 2) prims.push({ t: 'poly', pts });
      }
    }

    const { d, commands } = serializePrims(prims);
    return { d, strokeOnly: true, commands };
  },
};

export const CONTOUR_GENERATORS: SvgGenSpec[] = [contour];

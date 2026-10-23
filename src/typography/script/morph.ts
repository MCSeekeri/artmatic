/**
 * script/morph.ts — 两条 SVG 路径之间的**等长化插值**（纯函数）。
 *
 * 「SVG 变形」的难点不是插值本身，而是两条路径的命令数通常不同：
 * 星形 10 个锚点、圆环 4 个，直接逐点插值会把第一个形状的边连到第二个
 * 形状的角上。这里先把两边**细分到相同的段数**（细分用 de Casteljau，
 * 形状逐点不变 —— 见 `path-nodes.ts::insertNodeOnSegment`），再逐节点插值。
 *
 * 三条契约：
 *  1. `k <= 0` 原样返回 `a`，`k >= 1` 原样返回 `b`（逐字符精确，不是「近似」）。
 *  2. 节点数超上限（`SCRIPT_LIMITS.maxMorphNodes`）时退回最近的端点，
 *     不做可能把一条路径炸成几万点的细分 —— 宁可跳变，不要卡死一帧。
 *  3. 闭合状态不一致时按「任一闭合」处理：给开放那侧补一段闭合边，
 *     比「一半路径凭空消失」接近用户预期。
 */

import {
  insertNodeOnSegment,
  parsePathNodes,
  segmentCount,
  serializePathNodes,
  type PathNode,
  type SubPath,
  type Vec,
} from '../path-nodes';
import { SCRIPT_LIMITS } from './model';

function lerp(a: number, b: number, k: number): number {
  return a + (b - a) * k;
}

function lerpVec(a: Vec, b: Vec, k: number): Vec {
  return { x: lerp(a.x, b.x, k), y: lerp(a.y, b.y, k) };
}

/** 三次贝塞尔在 t 处的点（直线段 = 控制点与端点重合）。 */
function pointAt(a: PathNode, b: PathNode, t: number): Vec {
  const p0 = { x: a.x, y: a.y };
  const p3 = { x: b.x, y: b.y };
  const p1 = a.out ?? p0;
  const p2 = b.in ?? p3;
  const u = 1 - t;
  return {
    x: u * u * u * p0.x + 3 * u * u * t * p1.x + 3 * u * t * t * p2.x + t * t * t * p3.x,
    y: u * u * u * p0.y + 3 * u * u * t * p1.y + 3 * u * t * t * p2.y + t * t * t * p3.y,
  };
}

/** 段长的折线近似（8 段采样）。只用于挑「最长的那一段」细分。 */
function segmentLength(a: PathNode, b: PathNode): number {
  let len = 0;
  let prev = pointAt(a, b, 0);
  for (let i = 1; i <= 8; i++) {
    const p = pointAt(a, b, i / 8);
    len += Math.hypot(p.x - prev.x, p.y - prev.y);
    prev = p;
  }
  return len;
}

function nodeCount(sp: SubPath): number {
  return sp.closed ? sp.nodes.length : Math.max(0, sp.nodes.length - 1);
}

function centroid(sp: SubPath): Vec {
  if (!sp.nodes.length) return { x: 0, y: 0 };
  let x = 0;
  let y = 0;
  for (const n of sp.nodes) {
    x += n.x;
    y += n.y;
  }
  return { x: x / sp.nodes.length, y: y / sp.nodes.length };
}

/** 细分到指定节点数：每次挑最长的一段，在中点插一个节点（形状不变）。 */
function resample(sp: SubPath, wantNodes: number): SubPath {
  let out = sp;
  let guard = 0;
  while (out.nodes.length < wantNodes && guard < SCRIPT_LIMITS.maxMorphNodes) {
    const count = nodeCount(out);
    if (count <= 0) break;
    let best = 0;
    let bestLen = -1;
    for (let i = 0; i < count; i++) {
      const len = segmentLength(out.nodes[i]!, out.nodes[(i + 1) % out.nodes.length]!);
      if (len > bestLen) {
        bestLen = len;
        best = i;
      }
    }
    out = insertNodeOnSegment(out, best, 0.5);
    guard++;
  }
  return out;
}

function padSubPath(at: Vec): SubPath {
  return { closed: false, nodes: [{ x: at.x, y: at.y, in: null, out: null }] };
}

/**
 * 把两组子路径对齐到相同的数量与每条的节点数。
 *
 * 少的一侧用「重心点」补子路径（序列化出来是 `M x,y`，不画任何线），
 * 或按最长边细分节点。补出来的点会随插值从重心滑向对侧的形状 ——
 * 比「对不上的部分直接消失」更接近「变形」的观感。
 */
function align(a: SubPath[], b: SubPath[]): { a: SubPath[]; b: SubPath[] } {
  const outA = a.map((sp) => ({ ...sp, nodes: sp.nodes.map((n) => ({ ...n })) }));
  const outB = b.map((sp) => ({ ...sp, nodes: sp.nodes.map((n) => ({ ...n })) }));

  while (outA.length < outB.length) {
    const ref = outB[outA.length]!;
    outA.push(padSubPath(centroid(ref)));
  }
  while (outB.length < outA.length) {
    const ref = outA[outB.length]!;
    outB.push(padSubPath(centroid(ref)));
  }

  let total = 0;
  for (let i = 0; i < outA.length; i++) {
    const ca = outA[i]!;
    const cb = outB[i]!;
    const want = Math.max(ca.nodes.length, cb.nodes.length, 2);
    total += want;
    if (total > SCRIPT_LIMITS.maxMorphNodes) {
      // 超预算：不再细分，按原样插值（形状会错，但不会卡住一帧）。
      break;
    }
    if (ca.nodes.length < want) outA[i] = resample(ca, want);
    if (cb.nodes.length < want) outB[i] = resample(cb, want);
  }
  return { a: outA, b: outB };
}

function lerpNode(a: PathNode, b: PathNode, k: number): PathNode {
  const inA = a.in ?? { x: a.x, y: a.y };
  const inB = b.in ?? { x: b.x, y: b.y };
  const outA = a.out ?? { x: a.x, y: a.y };
  const outB = b.out ?? { x: b.x, y: b.y };
  return {
    x: lerp(a.x, b.x, k),
    y: lerp(a.y, b.y, k),
    in: a.in || b.in ? lerpVec(inA, inB, k) : null,
    out: a.out || b.out ? lerpVec(outA, outB, k) : null,
  };
}

/**
 * 两条路径在 `k ∈ [0,1]` 处的中间形态。
 *
 * 输入坐标系与 `ShapeElement.path` 一致（`pathUnit:'percent'` 是 0..100，
 * `'px'` 是元素像素盒）—— 脚本只需给它两条同坐标系的 `d`。
 */
export function morphPath(a: string, b: string, k: number): string {
  if (!Number.isFinite(k)) return a;
  if (k <= 0) return a;
  if (k >= 1) return b;
  if (a === b) return a;

  const subsA = parsePathNodes(a);
  const subsB = parsePathNodes(b);
  if (!subsA.length || !subsB.length) return k < 0.5 ? a : b;

  // 闭合状态对齐：一侧有闭合子路径、另一侧完全没有时，把开放那侧当闭合处理
  // （见文件头第 3 条）。两边都有开放与闭合混合时保持原样 —— 那多半是
  // 带洞的形状，逐条子路径各自插值才是对的。
  const anyClosedA = subsA.some((s) => s.closed);
  const anyClosedB = subsB.some((s) => s.closed);
  if (anyClosedA !== anyClosedB) {
    for (const sp of anyClosedA ? subsB : subsA) sp.closed = true;
  }

  const aligned = align(subsA, subsB);
  const totalNodes = aligned.a.reduce((n, sp) => n + sp.nodes.length, 0);
  if (totalNodes > SCRIPT_LIMITS.maxMorphNodes) return k < 0.5 ? a : b;

  const out: SubPath[] = [];
  for (let i = 0; i < aligned.a.length; i++) {
    const sa = aligned.a[i]!;
    const sb = aligned.b[i]!;
    const n = Math.min(sa.nodes.length, sb.nodes.length);
    if (n === 0) continue;
    const nodes: PathNode[] = [];
    for (let j = 0; j < n; j++) nodes.push(lerpNode(sa.nodes[j]!, sb.nodes[j]!, k));
    out.push({ closed: sa.closed || sb.closed, nodes });
  }
  return serializePathNodes(out);
}

/** 归一化后的段数（测试与预算诊断用）。 */
export function morphSegmentCount(d: string): number {
  return parsePathNodes(d).reduce((n, sp) => n + segmentCount(sp), 0);
}

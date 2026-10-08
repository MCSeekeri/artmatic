/**
 * path-nodes.ts — SVG 路径的**结构化编辑模型**（纯函数）。
 *
 * ## 为什么需要这一层
 *
 * `ShapeElement.path` 是一个字符串，直接对它做顶点编辑是不可能的：得先知道
 * 「有几个锚点、每个锚点的手柄在哪」。而路径里的 `Q` / `S` / `T` / `A` / `H` / `V`
 * 各有各的参数形态，随手改一个数字就会破坏语义（`A` 的半径不是一个坐标，
 * 改它不会移动端点）。
 *
 * 所以先把路径**归一化**成统一形态：
 *
 *   任意 d ──normalize──▶ 若干子路径，每条只有「锚点 + 两个控制点手柄」
 *                          （H/V → L，Q/T → C，S → C，A → 三次贝塞尔逼近）
 *
 * 归一化是**有损**的（弧变成贝塞尔、`Q` 变成 `C`），但视觉等价 —— 而编辑本来
 * 就要改动形状，用户不会期望「拖完一个顶点之后那段弧的方程还在」。
 *
 * ## 坐标
 *
 * 一律是 `svg` 图形的 **0..100 authored 坐标系**（见 shapes.ts 的 `scaleFrom100`）。
 * 与像素盒 / 文档坐标的换算由调用方负责（`geometry.ts` 的 `docToLocal`）。
 *
 * ## 手柄的「模式」不存
 *
 * Illustrator 有点的平滑 / 角点之分，pen-tool 那类库也带 `mirrorMode` 字段。
 * 这里**不存**：模式完全由「两侧手柄是否存在」决定 ——
 *
 *   - 两侧都有 ⇒ 平滑点，拖一侧镜像另一侧；
 *   - 只有一侧 ⇒ 角点，只动这一侧。
 *
 * 于是不需要往路径字符串里塞额外状态（也没有地方塞），而「断开」这个操作
 * 就是「按住 Alt 拖一次」。
 */

import { ARITY, tokenize } from './path-ops';

export interface Vec {
  x: number;
  y: number;
}

/**
 * 一个锚点。
 *
 * `in` / `out` 是**绝对坐标**（与 SVG `C` 命令的控制点语义一致，不是相对锚点的
 * 偏移量）。相对偏移在「拖动锚点时手柄要一起走」这条规则下会省一点代码，
 * 但在「镜像另一侧手柄」那条规则下又要来回换算 —— 而且序列化时必须变回绝对，
 * 记绝对就只差一次平移。
 */
export interface PathNode {
  x: number;
  y: number;
  /** 从上一节点进入本节点的控制点。null = 直线进入。 */
  in: Vec | null;
  /** 离开本节点去下一节点的控制点。null = 直线离开。 */
  out: Vec | null;
}

export interface SubPath {
  closed: boolean;
  nodes: PathNode[];
}

/** 锚点重合判定容差（authored 坐标是 0..100，千分之一已经很紧了）。 */
const EPS = 1e-3;

const node = (x: number, y: number, inPt: Vec | null = null): PathNode => ({
  x,
  y,
  in: inPt,
  out: null,
});

/* ------------------------------------------------------------ 解析 */

/**
 * 路径 `d` → 结构化子路径。
 *
 * 输出保证只有「直线段」与「三次贝塞尔段」两种形态，且每条子路径的第一个节点
 * 一定是起点（`Z` 造成的重复点会被合并掉）。
 */
export function parsePathNodes(d: string): SubPath[] {
  const out: SubPath[] = [];
  let nodes: PathNode[] = [];
  let closed = false;

  const cur: Vec = { x: 0, y: 0 };
  /** `Z` 之后当前点回到子路径起点，这个得单独记。 */
  let subStart: Vec = { x: 0, y: 0 };
  /** 上一段三次 / 二次贝塞尔的控制点，供 `S` / `T` 的反射用。 */
  let prevCubicCtrl: Vec | null = null;
  let prevQuadCtrl: Vec | null = null;
  let lastCmd = '';

  const flush = (): void => {
    if (nodes.length) out.push({ closed, nodes });
    nodes = [];
    closed = false;
  };
  /** 非 `M` 命令允许省略开头的 `M`（规范上是畸形路径）；补一个起点，不至于整条丢掉。 */
  const ensureStart = (): void => {
    if (!nodes.length) nodes.push(node(cur.x, cur.y));
  };
  /** 把当前（最后 push 的那个）节点的**离开**手柄设好。 */
  const setOut = (p: Vec | null): void => {
    const n = nodes[nodes.length - 1];
    if (n) n.out = p;
  };
  const last = (): PathNode | null => (nodes.length ? nodes[nodes.length - 1]! : null);

  for (const { cmd, args } of tokenize(d)) {
    const upper = cmd.toUpperCase();
    const rel = cmd !== upper;
    const arity = ARITY[upper] ?? 2;
    const groups = arity === 0 ? 1 : Math.max(1, Math.floor(args.length / arity));

    for (let g = 0; g < groups; g++) {
      // `M` 之后的多组参数按 `L` 处理（SVG 规范）。
      const eff = g > 0 && upper === 'M' ? 'L' : upper;
      const a = args.slice(g * arity, g * arity + arity);
      if (arity > 0 && a.length < arity) break;
      const ax = (i: number): number => (rel ? cur.x : 0) + a[i]!;
      const ay = (i: number): number => (rel ? cur.y : 0) + a[i]!;

      if (eff !== 'M') ensureStart();

      switch (eff) {
        case 'M': {
          flush();
          cur.x = ax(0);
          cur.y = ay(1);
          subStart = { x: cur.x, y: cur.y };
          nodes.push(node(cur.x, cur.y));
          prevCubicCtrl = null;
          prevQuadCtrl = null;
          break;
        }
        case 'L': {
          cur.x = ax(0);
          cur.y = ay(1);
          nodes.push(node(cur.x, cur.y));
          break;
        }
        case 'H': {
          cur.x = rel ? cur.x + a[0]! : a[0]!;
          nodes.push(node(cur.x, cur.y));
          break;
        }
        case 'V': {
          cur.y = rel ? cur.y + a[0]! : a[0]!;
          nodes.push(node(cur.x, cur.y));
          break;
        }
        case 'C': {
          const c1 = { x: ax(0), y: ay(1) };
          const c2 = { x: ax(2), y: ay(3) };
          cur.x = ax(4);
          cur.y = ay(5);
          setOut(c1);
          nodes.push(node(cur.x, cur.y, c2));
          prevCubicCtrl = c2;
          prevQuadCtrl = null;
          break;
        }
        case 'S': {
          // 上一段是 C/S 才反射；否则反射点就是当前点（规范）。
          const c1 =
            (lastCmd === 'C' || lastCmd === 'S') && prevCubicCtrl
              ? { x: 2 * cur.x - prevCubicCtrl.x, y: 2 * cur.y - prevCubicCtrl.y }
              : { x: cur.x, y: cur.y };
          const c2 = { x: ax(0), y: ay(1) };
          cur.x = ax(2);
          cur.y = ay(3);
          setOut(c1);
          nodes.push(node(cur.x, cur.y, c2));
          prevCubicCtrl = c2;
          prevQuadCtrl = null;
          break;
        }
        case 'Q': {
          const q = { x: ax(0), y: ay(1) };
          const p = { x: ax(2), y: ay(3) };
          const c1 = { x: cur.x + (2 / 3) * (q.x - cur.x), y: cur.y + (2 / 3) * (q.y - cur.y) };
          const c2 = { x: p.x + (2 / 3) * (q.x - p.x), y: p.y + (2 / 3) * (q.y - p.y) };
          setOut(c1);
          nodes.push(node(p.x, p.y, c2));
          prevQuadCtrl = q;
          prevCubicCtrl = null;
          cur.x = p.x;
          cur.y = p.y;
          break;
        }
        case 'T': {
          // 显式标注：`prevQuadCtrl` 会被下面赋成 `q`，不标的话 TS 报
          // 「'q' 的推断引用了它自己的初始化」（循环推断）。
          const q: Vec =
            (lastCmd === 'Q' || lastCmd === 'T') && prevQuadCtrl
              ? { x: 2 * cur.x - prevQuadCtrl.x, y: 2 * cur.y - prevQuadCtrl.y }
              : { x: cur.x, y: cur.y };
          const p = { x: ax(0), y: ay(1) };
          const c1 = { x: cur.x + (2 / 3) * (q.x - cur.x), y: cur.y + (2 / 3) * (q.y - cur.y) };
          const c2 = { x: p.x + (2 / 3) * (q.x - p.x), y: p.y + (2 / 3) * (q.y - p.y) };
          setOut(c1);
          nodes.push(node(p.x, p.y, c2));
          prevQuadCtrl = q;
          prevCubicCtrl = null;
          cur.x = p.x;
          cur.y = p.y;
          break;
        }
        case 'A': {
          const p = { x: ax(5), y: ay(6) };
          const ok = arcToCubics(
            cur,
            a[0]!,
            a[1]!,
            a[2]!,
            a[3]! === 1,
            a[4]! === 1,
            p,
            (c1, c2, end) => {
              setOut(c1);
              nodes.push(node(end.x, end.y, c2));
            },
          );
          // 半径 0 ⇒ 规范要求退化成直线；起终点重合 ⇒ 规范要求整段忽略。
          if (!ok && Math.hypot(p.x - cur.x, p.y - cur.y) > EPS) {
            nodes.push(node(p.x, p.y));
          }
          cur.x = p.x;
          cur.y = p.y;
          break;
        }
        case 'Z': {
          closed = true;
          closeSubPath(nodes);
          flush();
          cur.x = subStart.x;
          cur.y = subStart.y;
          prevCubicCtrl = null;
          prevQuadCtrl = null;
          lastCmd = '';
          continue;
        }
        default:
          break;
      }
      lastCmd = eff;
    }
  }
  flush();
  return out;
}

/**
 * 收尾一条闭合子路径。
 *
 * 两种情形必须分开处理：
 *  - 最后一个锚点与起点**重合** ⇒ 合并（起点继承它的进入手柄）。`Z` 之前显式
 *    回到起点的写法很常见（`ellipse` 与 `frame` 都是），不合并的话每闭合一次
 *    就多出一个零长度段，拖起来会「有一个点在原地不动」。
 *  - **不重合** ⇒ `Z` 画的是从末点回起点的直线，所以两侧手柄都是 null。
 *    `roundPolygonPath` 生成的路径正是这一类（最后一段是边的剩余部分）。
 */
function closeSubPath(nodes: PathNode[]): void {
  const first = nodes[0];
  const last = nodes[nodes.length - 1];
  if (!first || !last) return;
  if (nodes.length > 1 && Math.hypot(last.x - first.x, last.y - first.y) < EPS) {
    first.in = last.in;
    nodes.pop();
  } else {
    last.out = null;
    first.in = null;
  }
}

/* ------------------------------------------------------------ 弧 → 三次贝塞尔 */

interface ArcEmit {
  (c1: Vec, c2: Vec, end: Vec): void;
}

/**
 * 椭圆弧 → 若干段三次贝塞尔（SVG 规范 F.6.5 的端点参数化 → 中心参数化）。
 *
 * 每段弧按 **≤ 90°** 切分：三次贝塞尔对圆的逼近误差随张角迅速变大，
 * 90° 时约 0.03%，180° 就会肉眼可见地「扁」下去。
 *
 * 返回值表示**是否真的产生了曲线段**。三段特例必须先挡掉，否则下面会算出 NaN：
 *  - 起终点重合 ⇒ 规范要求整段忽略（调用方也不该补直线，靠距离判断）；
 *  - `rx` / `ry` 为 0 ⇒ 退化成直线（调用方补）；
 *  - 半径过小 ⇒ 按规范等比放大到刚好容下弦长。
 */
function arcToCubics(
  from: Vec,
  rxIn: number,
  ryIn: number,
  rotDeg: number,
  largeArc: boolean,
  sweep: boolean,
  to: Vec,
  emit: ArcEmit,
): boolean {
  if (Math.hypot(to.x - from.x, to.y - from.y) < EPS) return false;

  let rx = Math.abs(rxIn);
  let ry = Math.abs(ryIn);
  if (rx === 0 || ry === 0) return false;

  const phi = (rotDeg * Math.PI) / 180;
  const cosP = Math.cos(phi);
  const sinP = Math.sin(phi);

  const dx2 = (from.x - to.x) / 2;
  const dy2 = (from.y - to.y) / 2;
  const x1p = cosP * dx2 + sinP * dy2;
  const y1p = -sinP * dx2 + cosP * dy2;

  const lambda = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry);
  if (lambda > 1) {
    const k = Math.sqrt(lambda);
    rx *= k;
    ry *= k;
  }

  const num = rx * rx * ry * ry - rx * rx * y1p * y1p - ry * ry * x1p * x1p;
  const den = rx * rx * y1p * y1p + ry * ry * x1p * x1p;
  const coef = (largeArc !== sweep ? 1 : -1) * Math.sqrt(Math.max(0, num / den));
  const cxp = (coef * rx * y1p) / ry;
  const cyp = (-coef * ry * x1p) / rx;
  const cx = cosP * cxp - sinP * cyp + (from.x + to.x) / 2;
  const cy = sinP * cxp + cosP * cyp + (from.y + to.y) / 2;

  const angle = (ux: number, uy: number, vx: number, vy: number): number => {
    const dot = ux * vx + uy * vy;
    const len = Math.hypot(ux, uy) * Math.hypot(vx, vy);
    let v = Math.acos(Math.max(-1, Math.min(1, dot / (len || 1))));
    if (ux * vy - uy * vx < 0) v = -v;
    return v;
  };

  const theta1 = angle(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry);
  let dTheta = angle(
    (x1p - cxp) / rx,
    (y1p - cyp) / ry,
    (-x1p - cxp) / rx,
    (-y1p - cyp) / ry,
  );
  if (!sweep && dTheta > 0) dTheta -= 2 * Math.PI;
  if (sweep && dTheta < 0) dTheta += 2 * Math.PI;

  // 椭圆上的点（未旋转 → 旋转到世界）。
  const pt = (t: number): Vec => {
    const ex = cx + Math.cos(t) * rx;
    const ey = cy + Math.sin(t) * ry;
    return { x: cosP * (ex - cx) - sinP * (ey - cy) + cx, y: sinP * (ex - cx) + cosP * (ey - cy) + cy };
  };
  // 该点的切向量（同样要旋转）。
  const dpt = (t: number): Vec => {
    const dx = -Math.sin(t) * rx;
    const dy = Math.cos(t) * ry;
    return { x: cosP * dx - sinP * dy, y: sinP * dx + cosP * dy };
  };

  // 减一个极小量再做 ceil：`dTheta` 是算出来的，正好 90° 的弧常常给出
  // `π/2 + 1e-16`，于是 ceil 把它抬到 2 段 —— 每段圆弧凭空多出一倍的节点。
  const count = Math.max(1, Math.ceil(Math.abs(dTheta) / (Math.PI / 2) - 1e-9));
  const dt = dTheta / count;
  for (let i = 0; i < count; i++) {
    const t1 = theta1 + dt * i;
    const t2 = t1 + dt;
    const p1 = pt(t1);
    // 最后一段的终点**强制**取 `to`：浮点误差会让它差一丁点，而那个偏差会
    // 变成一个真实的、与下一段不重合的节点（拖起来「有一个点自己会跑」）。
    const p2 = i === count - 1 ? to : pt(t2);
    // 三次贝塞尔逼近圆弧的经典系数：k = 4/3·tan(Δθ/4)。
    const k = (4 / 3) * Math.tan(dt / 4);
    const d1 = dpt(t1);
    const d2 = dpt(t2);
    emit(
      { x: p1.x + k * d1.x, y: p1.y + k * d1.y },
      { x: p2.x - k * d2.x, y: p2.y - k * d2.y },
      p2,
    );
  }
  return true;
}

/* ------------------------------------------------------------ 序列化 */

function f(v: number): string {
  // 两位小数：路径字符串必须稳定，否则同一份几何会因为浮点尾数不同产出不同的
  // DOM 字符串，把光栅化缓存冲掉（与 shapes.ts 的 `n()` 同一口径）。
  return String(Math.round(v * 100) / 100);
}

/** 一段的 `d` 片段。两侧都没有手柄时用 `L`，否则用 `C`（缺的一侧退化成锚点本身）。 */
function segmentD(a: PathNode, b: PathNode): string {
  if (!a.out && !b.in) return `L${f(b.x)},${f(b.y)}`;
  const c1 = a.out ?? a;
  const c2 = b.in ?? b;
  return `C${f(c1.x)},${f(c1.y)} ${f(c2.x)},${f(c2.y)} ${f(b.x)},${f(b.y)}`;
}

export function serializePathNodes(subs: readonly SubPath[]): string {
  const parts: string[] = [];
  for (const sp of subs) {
    const ns = sp.nodes;
    if (!ns.length) continue;
    parts.push(`M${f(ns[0]!.x)},${f(ns[0]!.y)}`);
    const count = segmentCount(sp);
    for (let i = 0; i < count; i++) {
      parts.push(segmentD(ns[i]!, ns[(i + 1) % ns.length]!));
    }
    if (sp.closed) parts.push('Z');
  }
  return parts.join(' ');
}

/** 段数：闭合 = 节点数（最后一段回到起点），开放 = 节点数 − 1。 */
export function segmentCount(sp: SubPath): number {
  if (sp.nodes.length < 2) return 0;
  return sp.closed ? sp.nodes.length : sp.nodes.length - 1;
}

/* ------------------------------------------------------------ 编辑 */

function lerp(a: Vec, b: Vec, t: number): Vec {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

/**
 * 在第 `segIndex` 段上插入一个节点（`t ∈ (0,1)`），**形状完全不变**。
 *
 * 用 de Casteljau 细分：把这一段的控制多边形按 `t` 逐层取中点，得到的两个
 * 子段拼起来与原段逐点相同。直接「在曲线上取一个点，然后把两侧手柄指向它」
 * 会让曲线鼓出去 —— 那是最常见的「加点之后形状变了」。
 *
 * 返回新对象（不原地改）：调用方要拿它去开一次撤销事务，原地改会让「反正
 * 撤销栈里存的是同一份引用」这类 bug 悄悄成立。
 */
export function insertNodeOnSegment(sp: SubPath, segIndex: number, t: number): SubPath {
  const count = segmentCount(sp);
  if (segIndex < 0 || segIndex >= count) return sp;
  const a = sp.nodes[segIndex]!;
  const b = sp.nodes[(segIndex + 1) % sp.nodes.length]!;
  const tt = Math.max(0.001, Math.min(0.999, t));

  const nodes = sp.nodes.map((n) => ({ ...n, in: n.in ? { ...n.in } : null, out: n.out ? { ...n.out } : null }));
  const a2 = nodes[segIndex]!;
  const b2 = nodes[(segIndex + 1) % nodes.length]!;

  // 直线段：新节点就是中点，两侧都不该长出手柄。
  if (!a.out && !b.in) {
    const mid = lerp(a, b, tt);
    nodes.splice(segIndex + 1, 0, node(mid.x, mid.y));
    return { ...sp, nodes };
  }

  const p0: Vec = { x: a.x, y: a.y };
  const p1: Vec = a.out ?? p0;
  const p3: Vec = { x: b.x, y: b.y };
  const p2: Vec = b.in ?? p3;

  const q0 = lerp(p0, p1, tt);
  const q1 = lerp(p1, p2, tt);
  const q2 = lerp(p2, p3, tt);
  const r0 = lerp(q0, q1, tt);
  const r1 = lerp(q1, q2, tt);
  const s = lerp(r0, r1, tt);

  // 原来没有手柄的一侧保持没有（细分出的 Q0 恰好等于锚点本身，留着只是噪声）。
  a2.out = a.out ? q0 : null;
  b2.in = b.in ? q2 : null;
  nodes.splice(segIndex + 1, 0, { x: s.x, y: s.y, in: r0, out: r1 });
  return { ...sp, nodes };
}

/**
 * 删掉一个节点，相邻两段合并成一段。
 *
 * 合并后的控制点沿用**两侧原有的**（`prev.out` 与 `next.in`）—— 它们本来就是
 * 朝对方方向的，所以形状只是略微变化。精确做法是「用一条三次贝塞尔拟合原来
 * 两段」（最小二乘），代价大得多而收益只在两侧都很长时才看得出来；
 * 而且用户删点本来就是要改形状。
 */
export function removeNode(sp: SubPath, index: number): SubPath {
  const n = sp.nodes.length;
  // 少于 3 个节点的闭合路径删完只剩两个点，会退化成一条来回的线；
  // 开放路径保留 2 个点（一条直线段）是有意义的，所以门槛分开。
  if (n <= (sp.closed ? 3 : 2) || index < 0 || index >= n) return sp;
  const nodes = sp.nodes.map((x) => ({ ...x, in: x.in ? { ...x.in } : null, out: x.out ? { ...x.out } : null }));
  nodes.splice(index, 1);
  return { ...sp, nodes };
}

/**
 * 移动一个锚点，两侧手柄**一起平移**（保持相对形状）。
 *
 * 手柄存的是绝对坐标，所以这里必须显式平移 —— 漏掉的话表现是「拖锚点时
 * 曲线被拉成锥形」，而且只在有手柄的点上出现。
 */
export function moveNode(sp: SubPath, index: number, to: Vec): SubPath {
  const n = sp.nodes[index];
  if (!n) return sp;
  const dx = to.x - n.x;
  const dy = to.y - n.y;
  const nodes = sp.nodes.slice();
  nodes[index] = {
    x: to.x,
    y: to.y,
    in: n.in ? { x: n.in.x + dx, y: n.in.y + dy } : null,
    out: n.out ? { x: n.out.x + dx, y: n.out.y + dy } : null,
  };
  return { ...sp, nodes };
}

/**
 * 拖一侧手柄。`side` 是「被拖的那一侧」，另一侧的处置由 `mirror` 决定：
 *
 *  - `mirror: true` 且另一侧存在 ⇒ 镜像（方向相反、长度相同）—— 平滑点；
 *  - 否则只动这一侧 —— 角点。
 *
 * 「另一侧不存在」时**不**顺手创建一个：那会让「拖一条直线段的端点手柄」
 * 把相邻的直线段也变成曲线，而用户只是想给这一段加个弧度。
 */
export function setHandle(sp: SubPath, index: number, side: 'in' | 'out', at: Vec, mirror: boolean): SubPath {
  const n = sp.nodes[index];
  if (!n) return sp;
  const nodes = sp.nodes.slice();
  const other = side === 'in' ? 'out' : 'in';
  nodes[index] = {
    ...n,
    in: n.in ? { ...n.in } : null,
    out: n.out ? { ...n.out } : null,
    [side]: { x: at.x, y: at.y },
  } as PathNode;
  const updated = nodes[index]!;
  if (mirror && n[other]) {
    (updated[other] as Vec | null) = { x: 2 * n.x - at.x, y: 2 * n.y - at.y };
  }
  return { ...sp, nodes };
}

/* ------------------------------------------------------------ 查询 */

/** 某一段在参数 `t` 处的点。 */
export function cubicAt(a: PathNode, b: PathNode, t: number): Vec {
  const p0: Vec = { x: a.x, y: a.y };
  const p3: Vec = { x: b.x, y: b.y };
  /*
   * 直线段必须走**线性插值**，不能套贝塞尔公式。
   *
   * 直觉上「把缺失的控制点补成锚点本身」是等价的，实际不是：p1 = p0、p2 = p3
   * 得到的是**缓入缓出**的参数化 —— 同一条直线上 t 的取点位置完全不同
   * （t = 0.3 时落在 21.6% 处而不是 30%）。症状是「双击直线段，点在别处长出来」
   * 以及「最近的段判定错误」，而曲线段一切正常。
   */
  if (!a.out && !b.in) return lerp(p0, p3, t);
  const p1 = a.out ?? p0;
  const p2 = b.in ?? p3;
  const mt = 1 - t;
  const w0 = mt * mt * mt;
  const w1 = 3 * mt * mt * t;
  const w2 = 3 * mt * t * t;
  const w3 = t * t * t;
  return {
    x: w0 * p0.x + w1 * p1.x + w2 * p2.x + w3 * p3.x,
    y: w0 * p0.y + w1 * p1.y + w2 * p2.y + w3 * p3.y,
  };
}

export interface PathHit {
  sub: number;
  /** 段下标（段起点的锚点下标）。 */
  seg: number;
  /** 段内参数 0..1。 */
  t: number;
  dist: number;
}

/**
 * 路径上离给定点最近的位置。
 *
 * 三次贝塞尔的最近点没有解析解，所以走「粗采样 + 局部二分」：先按固定份数扫一遍
 * 找到最近的采样点，再在它两侧各一个步长里二分 12 次。对「双击加个点」这种
 * 用途，误差远小于一个像素就够了，而这一步每次双击才跑一次。
 */
export function nearestOnPath(
  subs: readonly SubPath[],
  pt: Vec,
  maxDist = Infinity,
): PathHit | null {
  let best: PathHit | null = null;
  const N = 24;
  const probe = (a: PathNode, b: PathNode, sub: number, seg: number, t: number): void => {
    const p = cubicAt(a, b, t);
    const d = Math.hypot(p.x - pt.x, p.y - pt.y);
    if (d < (best?.dist ?? maxDist) && d <= maxDist) best = { sub, seg, t, dist: d };
  };

  for (let sub = 0; sub < subs.length; sub++) {
    const sp = subs[sub]!;
    const count = segmentCount(sp);
    for (let seg = 0; seg < count; seg++) {
      const a = sp.nodes[seg]!;
      const b = sp.nodes[(seg + 1) % sp.nodes.length]!;
      if (!a.out && !b.in) {
        // 直线段有解析解，不需要采样（少一半噪声，也更快）。
        const vx = b.x - a.x;
        const vy = b.y - a.y;
        const len2 = vx * vx + vy * vy;
        const t = len2 > 0 ? Math.max(0, Math.min(1, ((pt.x - a.x) * vx + (pt.y - a.y) * vy) / len2)) : 0;
        probe(a, b, sub, seg, t);
        continue;
      }
      let localBest = 0;
      let localDist = Infinity;
      for (let i = 0; i <= N; i++) {
        const t = i / N;
        const p = cubicAt(a, b, t);
        const d = Math.hypot(p.x - pt.x, p.y - pt.y);
        if (d < localDist) {
          localDist = d;
          localBest = t;
        }
      }
      // 在最近采样点的两侧各一个步长内二分。
      let lo = Math.max(0, localBest - 1 / N);
      let hi = Math.min(1, localBest + 1 / N);
      for (let i = 0; i < 12; i++) {
        const m1 = lo + (hi - lo) / 3;
        const m2 = hi - (hi - lo) / 3;
        const p1 = cubicAt(a, b, m1);
        const p2 = cubicAt(a, b, m2);
        if (Math.hypot(p1.x - pt.x, p1.y - pt.y) < Math.hypot(p2.x - pt.x, p2.y - pt.y)) hi = m2;
        else lo = m1;
      }
      probe(a, b, sub, seg, (lo + hi) / 2);
    }
  }
  return best;
}

/** 每个坐标都过一遍 `f`。改坐标系（比如把像素盒路径归一化到 0..100）用。 */
export function mapNodes(subs: readonly SubPath[], f: (p: Vec) => Vec): SubPath[] {
  return subs.map((sp) => ({
    closed: sp.closed,
    nodes: sp.nodes.map((n) => ({
      ...f(n),
      in: n.in ? f(n.in) : null,
      out: n.out ? f(n.out) : null,
    })),
  }));
}

/** 锚点 + 控制点的外接框（用于「是否该显示控制点」这类判断）。 */
export function nodesBounds(subs: readonly SubPath[]): { x: number; y: number; w: number; h: number } | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const add = (p: Vec): void => {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  };
  for (const sp of subs) {
    for (const n of sp.nodes) {
      add(n);
      if (n.in) add(n.in);
      if (n.out) add(n.out);
    }
  }
  if (!Number.isFinite(minX)) return null;
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

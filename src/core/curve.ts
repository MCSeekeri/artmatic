/**
 * curve.ts — 关键帧曲线求值。
 *
 * AGENTS.md §5：beatAnchor 必须在 Curve 结构本身里，不是事后补。
 * 改了 BPM 或微调 offset 之后，所有卡点自动跟着走，不用重排。
 * → 实现红线：beatAnchor 只在求值入口处换算一次，禁止把「拍转秒」的结果
 *   物化回数据（否则改 BPM 不跟随，等于白做）。
 *
 * 三种 mode 全部是闭式解，天然 seek 安全——不需要逐帧推进状态：
 *   keyframe  段内插值（linear / step / smooth / bezier）
 *   impulse   keys 视为 hit 事件，指数衰减叠加（对应 angel-echo Impulse）
 *   follower  keys 视为阶跃目标，非对称攻放包络闭式递推（对应 angel-echo follower）
 */

import { timeAtBeat, type BeatGrid } from './time';

export type Interp = 'linear' | 'step' | 'smooth' | 'bezier';

/**
 * 一个关键帧。
 *
 * `interp` 是**出向**语义：它只决定「从本 key 到下一个 key」这一段怎么走。
 * 入向由前一个 key 的 `interp` 决定 —— 想同时改两侧就把相邻两个 key 都选上。
 * 这条约定是曲线编辑器的全部手势（选中一个 key 只出现它的出向手柄）的依据。
 */
export interface Key {
  /** 秒。曲线无 beatAnchor 时相对片段起点，有 beatAnchor 时相对锚定拍。 */
  t: number;
  v: number;
  /** 离开这个 key 进入下一段时使用的插值方式。 */
  interp: Interp;
  /**
   * **旧版**段级控制点 [x1,y1,x2,y2]，归一化在段内（y 为 0..1 段进度）。
   *
   * 只在 `hOut` / `hIn` 都不存在时参与求值（早期工程与手工 JSON 里只有它）。
   * 新写入一律用 `hOut` / `hIn` —— 归一化坐标没法表达「手柄被拖过段的边界」，
   * 而值域归一化在 `dv = 0` 时还会把纵向拖动吃掉。
   */
  handles?: [number, number, number, number];
  /**
   * 出向控制点偏移：相对**本 key** 的 `[秒, 值]`。本 key 的 `interp === 'bezier'`
   * 时，它与下一个 key 的 `hIn` 一起构成该段的两个控制点。
   */
  hOut?: [number, number];
  /**
   * 入向控制点偏移：相对**本 key** 的 `[秒, 值]`（秒为负）。前一个 key 的
   * `interp === 'bezier'` 时参与求值。
   */
  hIn?: [number, number];
}

export type CurveMode = 'keyframe' | 'impulse' | 'follower';

export interface Curve {
  keys: Key[];
  mode?: CurveMode;
  /** 整条曲线锚在拍上：数据的 t=0 对齐到 beatAnchor.beat 这一拍。 */
  beatAnchor?: { beat: number } | null;
  /** impulse 模式：指数衰减时间常数（秒），默认 0.3。 */
  impulse?: { decay: number };
  /** follower 模式：attack / release 半衰期（秒），默认 0.05 / 0.3。 */
  follower?: { attack: number; release: number };
}

export interface EvalCtx {
  grid?: BeatGrid;
  /** 无 beatAnchor 的曲线是相对片段起点的，调用方传 clip.start。 */
  clipStart?: number;
}

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const smoothstep = (t: number) => t * t * (3 - 2 * t);

/**
 * 求曲线在绝对时刻 tSec 的值。纯函数——同一曲线同一 tSec 永远同结果，
 * 与调用次数、调用顺序无关（确定性的根基之一）。
 */
export function evalCurve(curve: Curve, tSec: number, ctx: EvalCtx = {}): number {
  if (curve.keys.length === 0) return 0;
  // beatAnchor 换算只发生在这里，全函数唯一一处。
  const t = curve.beatAnchor && ctx.grid
    ? tSec - timeAtBeat(curve.beatAnchor.beat, ctx.grid)
    : tSec - (ctx.clipStart ?? 0);
  const mode = curve.mode ?? 'keyframe';
  if (mode === 'impulse') return evalImpulse(curve, t);
  if (mode === 'follower') return evalFollower(curve, t);
  return evalKeyframes(curve.keys, t);
}

/* ------------------------------------------------------------ keyframe */

export function evalKeyframes(keys: Key[], t: number): number {
  const n = keys.length;
  if (n === 0) return 0;
  if (t <= keys[0]!.t) return keys[0]!.v;
  if (t >= keys[n - 1]!.t) return keys[n - 1]!.v;
  // keys 按 t 升序（插入时维护）。找 i 使 keys[i].t <= t < keys[i+1].t。
  let lo = 0;
  let hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (keys[mid]!.t <= t) lo = mid;
    else hi = mid;
  }
  const a = keys[lo]!;
  const b = keys[lo + 1]!;
  const span = b.t - a.t;
  const u = span <= 1e-9 ? 1 : clamp01((t - a.t) / span);
  switch (a.interp) {
    case 'step':
      return a.v;
    case 'smooth':
      return a.v + (b.v - a.v) * smoothstep(u);
    case 'bezier':
      return bezierSegmentValue(a, b, t);
    default:
      return a.v + (b.v - a.v) * u;
  }
}

/* ------------------------------------------------------- bezier 控制点 */

/** 段 `a → b` 的两个控制点，**各自相对所属 key** 的 `[秒, 值]` 偏移。 */
export interface SegmentHandles {
  /** 相对 `a`（出向）。 */
  out: [number, number];
  /** 相对 `b`（入向），秒为负。 */
  in: [number, number];
}

/** 段是否由贝塞尔描述（`smooth` 也是 —— 它就是水平手柄的贝塞尔）。 */
export function segmentHandles(a: Key, b: Key): SegmentHandles | null {
  if (a.interp !== 'bezier' && a.interp !== 'smooth') return null;
  const span = b.t - a.t;
  if (span <= 1e-9) return null;
  // smoothstep 恒等于「控制点在 1/3、2/3 处且水平」的贝塞尔，所以两者可以共用
  // 同一套手柄显示；从 smooth 拖一下手柄只是把同一形状物化成 hOut/hIn。
  if (a.interp === 'smooth') return { out: [span / 3, 0], in: [-span / 3, 0] };

  const dv = b.v - a.v;
  let out: [number, number];
  let inn: [number, number];
  if (a.hOut || b.hIn) {
    out = a.hOut ? [a.hOut[0], a.hOut[1]] : [span / 3, 0];
    inn = b.hIn ? [b.hIn[0], b.hIn[1]] : [-span / 3, 0];
  } else if (a.handles) {
    const [x1, y1, x2, y2] = a.handles;
    out = [x1 * span, y1 * dv];
    inn = [(x2 - 1) * span, (y2 - 1) * dv];
  } else {
    // 缺省 = 缓入缓出（水平手柄）。旧版注释说「缺省退化为线性」，但那是
    // 归一化坐标下的巧合；真要线性请用 `linear`，选 bezier 的人要的是缓动。
    out = [span / 3, 0];
    inn = [-span / 3, 0];
  }
  return clampHandles(out, inn, span);
}

/**
 * 把两个控制点钳进「x 单调」的合法域。
 *
 * 三次贝塞尔的 x(s) 只有在 `0 ≤ x1 ≤ x2 ≤ span` 时才单调；越界时 `x(s) = t`
 * 可能有多解，画面表现为「曲线在时间上回折」——而求值器只会取其中一个解，
 * 于是和编辑器里看到的形状对不上。值（y）不钳：允许过冲是贝塞尔的正常表达能力。
 */
function clampHandles(
  out: [number, number],
  inn: [number, number],
  span: number,
): SegmentHandles {
  const o: [number, number] = [Math.min(Math.max(out[0], 0), span), out[1]];
  const i: [number, number] = [Math.min(Math.max(inn[0], -span), 0), inn[1]];
  if (o[0] - i[0] > span) {
    // 两个手柄在时间上交叉了：保留入向手柄，把出向推到最左的合法位置。
    // `i[0] >= -span` 保证 `span + i[0]` 不会小于 0，不需要再兜一次。
    o[0] = span + i[0];
  }
  return { out: o, in: i };
}

/** 段 `a → b` 在绝对（同一时间基准）时刻 t 的贝塞尔值。 */
function bezierSegmentValue(a: Key, b: Key, t: number): number {
  const span = b.t - a.t;
  if (span <= 1e-9) return b.v;
  const h = segmentHandles(a, b);
  if (!h) return a.v + (b.v - a.v) * clamp01((t - a.t) / span);
  const s = solveBezierParam(
    clamp01((t - a.t) / span),
    h.out[0] / span,
    1 + h.in[0] / span,
  );
  return cubic(s, a.v, a.v + h.out[1], b.v + h.in[1], b.v);
}

/**
 * 已知 x 求贝塞尔参数 s（P0.x=0、P3.x=1）。牛顿为主，**越界或导数为零时
 * 退回二分** —— 只写牛顿时遇到近乎竖直的控制点会停在段外，求值结果会跳到
 * 相邻段去（表现为曲线在某帧突然塌陷，而不是报错）。
 */
function solveBezierParam(x: number, x1: number, x2: number): number {
  let s = x;
  for (let i = 0; i < 8; i++) {
    const err = cubic(s, 0, x1, x2, 1) - x;
    if (Math.abs(err) < 1e-7) return s;
    const d = cubicDeriv(s, 0, x1, x2, 1);
    if (Math.abs(d) < 1e-6) break;
    const next = s - err / d;
    if (!(next >= 0 && next <= 1)) break;
    s = next;
  }
  let lo = 0;
  let hi = 1;
  s = x;
  for (let i = 0; i < 32; i++) {
    const v = cubic(s, 0, x1, x2, 1);
    if (Math.abs(v - x) < 1e-7) break;
    if (v < x) lo = s;
    else hi = s;
    s = (lo + hi) / 2;
  }
  return s;
}

function cubic(t: number, p0: number, p1: number, p2: number, p3: number): number {
  const mt = 1 - t;
  return mt * mt * mt * p0 + 3 * mt * mt * t * p1 + 3 * mt * t * t * p2 + t * t * t * p3;
}

function cubicDeriv(t: number, p0: number, p1: number, p2: number, p3: number): number {
  const mt = 1 - t;
  return 3 * mt * mt * (p1 - p0) + 6 * mt * t * (p2 - p1) + 3 * t * t * (p3 - p2);
}

/* ------------------------------------------------------------- impulse */

/**
 * impulse：keys 是 hit 事件。v(t) = Σ_{t_i≤t} v_i · exp(-(t-t_i)/decay)。
 * 对应 angel-echo 的 Impulse（hit + 指数衰减 + 1e-4 截断），闭式所以 seek 安全。
 */
function evalImpulse(curve: Curve, t: number): number {
  const decay = curve.impulse?.decay ?? 0.3;
  let v = 0;
  for (const k of curve.keys) {
    if (k.t > t) break;
    const c = k.v * Math.exp(-(t - k.t) / decay);
    if (Math.abs(c) < 1e-4) continue;
    v += c;
  }
  return v;
}

/* ------------------------------------------------------------ follower */

/**
 * follower：keys 是阶跃目标。每个段内是指数趋近的闭式：
 *   v(t) = target + (startSeg - target) · 2^(-(t-t_i)/halfLife)
 * halfLife 按上升/下降选 attack/release。startSeg 由前一段的终点闭式递推。
 * 与 angel-echo 的 follower(attack, release).push 数值上等价（步进极限）。
 */
function evalFollower(curve: Curve, t: number): number {
  const attack = curve.follower?.attack ?? 0.05;
  const release = curve.follower?.release ?? 0.3;
  const keys = curve.keys;
  if (t <= keys[0]!.t) return keys[0]!.v;
  let start = keys[0]!.v;
  let target = keys[0]!.v;
  let segStart = keys[0]!.t;
  for (let i = 1; i < keys.length; i++) {
    const next = keys[i]!;
    if (t < next.t) break;
    // 先把前一段走完：算 start 在 next.t 时刻的值
    start = followValue(start, target, segStart, next.t, attack, release);
    segStart = next.t;
    target = next.v;
  }
  return followValue(start, target, segStart, t, attack, release);
}

function followValue(
  start: number,
  target: number,
  from: number,
  at: number,
  attack: number,
  release: number,
): number {
  const halfLife = target > start ? attack : release;
  if (halfLife <= 1e-6) return target;
  return target + (start - target) * Math.pow(0.5, (at - from) / halfLife);
}

/* -------------------------------------------------------------- 工具 */

/** 往曲线里按 t 有序插入 / 覆盖一个 key（±1ms 内视为同一个 key）。返回新数组。 */
export function upsertKey(keys: Key[], key: Key): Key[] {
  const out = keys.filter((k) => Math.abs(k.t - key.t) > 1e-3);
  const at = out.findIndex((k) => k.t > key.t);
  if (at === -1) out.push(key);
  else out.splice(at, 0, key);
  return out;
}

export function removeKeyAt(keys: Key[], index: number): Key[] {
  return keys.filter((_, i) => i !== index);
}

/**
 * 把选中的 key 的出向插值改成 `interp`，返回**新数组**（不改入参）。
 *
 * 切到 `bezier` 时补齐两个控制点，否则用户会得到一条「选了贝塞尔但看不出
 * 任何变化」的曲线（旧版 `handles` 缺省在归一化坐标下恰好近似线性）：
 *   - 已有旧版 `handles` 且两端都没有新字段 → 换算成 `hOut` / `hIn`，形状不变；
 *   - 否则给水平手柄（缓入缓出）。
 *
 * 切到 `linear / step / smooth` 时**保留** `hOut` / `hIn`：它们不参与求值，
 * 但用户再切回 `bezier` 时手调过的形状还在。
 */
export function withInterp(keys: Key[], indices: readonly number[], interp: Interp): Key[] {
  const wanted = new Set(indices);
  const out = keys.map((k) => ({ ...k }));
  for (const i of wanted) {
    const k = out[i];
    if (!k) continue;
    k.interp = interp;
    if (interp !== 'bezier') continue;
    const next = out[i + 1];
    if (!next) continue;
    const span = next.t - k.t;
    if (span <= 1e-9) continue;
    if (!k.hOut) {
      if (k.handles && !next.hIn) {
        const [x1, y1, x2, y2] = k.handles;
        const dv = next.v - k.v;
        k.hOut = [x1 * span, y1 * dv];
        next.hIn = [(x2 - 1) * span, (y2 - 1) * dv];
      } else {
        k.hOut = [span / 3, 0];
      }
    }
    if (!next.hIn) next.hIn = [-span / 3, 0];
  }
  return out;
}

/**
 * 把选中 key 两侧的贝塞尔手柄重置为水平（缓入缓出）。
 *
 * 只重置与选中 key 相邻的段：一个段的手柄归它两端的 key 所有，越界重置会
 * 悄悄改掉别的段。
 */
export function autoHandles(keys: Key[], indices: readonly number[]): Key[] {
  const wanted = new Set(indices);
  const out = keys.map((k) => ({ ...k }));
  for (const i of wanted) {
    const k = out[i];
    if (!k) continue;
    const next = out[i + 1];
    if (next) {
      const span = next.t - k.t;
      if (span > 1e-9) {
        k.hOut = [span / 3, 0];
        next.hIn = [-span / 3, 0];
      }
    }
    const prev = out[i - 1];
    if (prev && prev.interp === 'bezier') {
      const span = k.t - prev.t;
      if (span > 1e-9) {
        prev.hOut = [span / 3, 0];
        k.hIn = [-span / 3, 0];
      }
    }
  }
  return out;
}

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

export interface Key {
  /** 秒。曲线无 beatAnchor 时相对片段起点，有 beatAnchor 时相对锚定拍。 */
  t: number;
  v: number;
  /** 离开这个 key 进入下一段时使用的插值方式。 */
  interp: Interp;
  /** bezier 段的两个控制点 [x1,y1,x2,y2]，归一化在段内（y 为 0..1 段进度）。 */
  handles?: [number, number, number, number];
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
      return a.v + (b.v - a.v) * bezierY(u, a.handles);
    default:
      return a.v + (b.v - a.v) * u;
  }
}

/**
 * 三次贝塞尔段的 y(u)：P0=(0,0)，P3=(1,1)，P1/P2 来自 handles（缺省 1/3、2/3，
 * 即退化为线性）。对 x 做牛顿迭代求参数，再取 y。
 */
function bezierY(u: number, handles?: [number, number, number, number]): number {
  const [x1, y1, x2, y2] = handles ?? [1 / 3, 1 / 3, 2 / 3, 2 / 3];
  let tt = u;
  for (let i = 0; i < 8; i++) {
    const x = cubic(tt, 0, x1, x2, 1) - u;
    const dx = cubicDeriv(tt, 0, x1, x2, 1);
    if (Math.abs(dx) < 1e-6) break;
    const next = tt - x / dx;
    if (Math.abs(next - tt) < 1e-6) { tt = next; break; }
    tt = clamp01(next);
  }
  return cubic(tt, 0, y1, y2, 1);
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

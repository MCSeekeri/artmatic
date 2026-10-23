/**
 * speed.ts — 视频片段的**变速**语义：速度曲线 → 素材内时间。
 *
 * ## 为什么需要一层（而不是继续 `srcIn + Δt × speed`）
 *
 * 一旦速度能打关键帧，`mediaT(t) = srcIn + ∫ speed` —— 乘法只对常速成立。
 * 这一层是那条映射的**唯一实现**：取帧器（`engine/video-source.ts`）、导出混流
 * 与预览播放（`core/audio-plan.ts` 的消费方）、trim / 切分（`core/clips.ts`、
 * `core/project-store.ts`）全部对着它。各处自己积一遍的形态是「画面按曲线走、
 * 声音按平均速度走」，对不上但谁也不会去逐帧比对。
 *
 * ## 两条约定
 *
 * 1. **速度曲线存在 `clip.curves.speed`**，基值是 `source.speed`（常速）。
 *    有曲线时基值**不参与**求值（曲线是唯一真源），这与 `opacity` /
 *    `transform.*` 完全同构。
 * 2. **允许负值**。负速度 = 倒放：媒体时间往回走，`srcIn` 是**起点处**的
 *    素材时间（不是最小值）。所以「可用素材」是 `srcIn` 之前那一段，而不是
 *    之后 —— 见 `sourceRangeOf` 与 `ProjectStore.setClipSpeed` 的钳制。
 *
 * 纯函数、无 DOM / WebGL，可单测。
 */

import { evalCurve, integralCurve, type Curve } from './curve';
import { timeAtBeat, type BeatGrid } from './time';

/** `clip.curves` 里速度曲线的键。 */
export const SPEED_CURVE_KEY = 'speed';

/**
 * 承载变速的最小片段形状（`SourceClip` 天然满足）。
 *
 * 刻意不 import `schema`：这一层要被 `core/clips.ts`（它反过来被 schema 的
 * 使用方依赖）与 engine 共同引用，结构类型是唯一不会绕成环的写法。
 */
export interface SpeedCarrier {
  start: number;
  end: number;
  curves: Record<string, Curve>;
  source: { type: string; speed?: number; srcIn?: number };
}

/**
 * 静态速度（无曲线时的基值）。非视频源恒为 1。
 *
 * 非正值按 1 处理，与 `core/clips.ts::trimInOf` 同一条口径：负速只走曲线
 * （静态字段是「常速」的旋钮，倒放是编排）。
 */
export function baseSpeedOf(clip: SpeedCarrier): number {
  if (clip.source.type !== 'video') return 1;
  const s = clip.source.speed ?? 1;
  return Number.isFinite(s) && s > 0 ? s : 1;
}

export function speedCurveOf(clip: SpeedCarrier): Curve | undefined {
  return clip.curves[SPEED_CURVE_KEY];
}

export function hasSpeedCurve(clip: SpeedCarrier): boolean {
  return speedCurveOf(clip) !== undefined;
}

/** 片段在绝对时刻 `tAbs` 的瞬时速度（1 = 原速，负值 = 倒放）。 */
export function speedAt(clip: SpeedCarrier, tAbs: number, grid?: BeatGrid): number {
  const curve = speedCurveOf(clip);
  if (!curve) return baseSpeedOf(clip);
  const v = evalCurve(curve, tAbs, { grid, clipStart: clip.start });
  return Number.isFinite(v) ? v : baseSpeedOf(clip);
}

/**
 * `[from, to]` 之间消耗的**素材秒数**（速度的定积分）。反向区间返回负值。
 *
 * 无曲线时是 `(to - from) × speed` —— 与改造前逐字节相同（常速是它的特例）。
 */
export function speedIntegralOf(
  clip: SpeedCarrier,
  from: number,
  to: number,
  grid?: BeatGrid,
): number {
  if (to === from) return 0;
  const curve = speedCurveOf(clip);
  if (!curve) return (to - from) * baseSpeedOf(clip);
  const v = integralCurve(curve, from, to, { grid, clipStart: clip.start });
  // 坏曲线（手改 JSON 写出 NaN key）会让整层的素材时间变成 NaN —— 那表现为
  // 「这一层整块消失」，不报错。退回常速，画面至少还在。
  return Number.isFinite(v) ? v : (to - from) * baseSpeedOf(clip);
}

/**
 * 片段起点 → `tAbs` 消耗的素材秒数。
 *
 * `tAbs < clip.start` 时返回 0：转场预热会把片段求值到它 start 之前，那里应当
 * 呈现首帧，而不是负时间（与 algo 的 `Math.max(0, …)` 同一规则）。
 */
export function mediaOffsetOf(clip: SpeedCarrier, tAbs: number, grid?: BeatGrid): number {
  const local = Math.max(0, tAbs - clip.start);
  if (local === 0) return 0;
  return speedIntegralOf(clip, clip.start, clip.start + local, grid);
}

/** 片段起点 → `tAbs` 的**素材内时间**（秒）。与播放器 / mixdown 的 `srcIn` 同口径。 */
export function mediaTimeOf(clip: SpeedCarrier, tAbs: number, grid?: BeatGrid): number {
  return (clip.source.srcIn ?? 0) + mediaOffsetOf(clip, tAbs, grid);
}

/**
 * 片段整段覆盖到的素材区间 `[from, to]`（`from ≤ to`）。
 *
 * 给两件事用：音频解码范围（`engine/video-audio.ts`）与「素材够不够长」的判定。
 * 负速度会让媒体时间**往回走**，所以不能只看首尾两点 —— 用固定步长采样，
 * 把折返点也扫进来（key 点一并采样，它们才是折返发生的地方）。
 */
export function sourceRangeOf(
  clip: SpeedCarrier,
  grid?: BeatGrid,
): { from: number; to: number } {
  const srcIn = clip.source.srcIn ?? 0;
  const dur = Math.max(0, clip.end - clip.start);
  const curve = speedCurveOf(clip);
  if (!curve) {
    const a = srcIn;
    const b = srcIn + dur * baseSpeedOf(clip);
    return { from: Math.min(a, b), to: Math.max(a, b) };
  }
  const times = sampleTimes(clip, dur, grid);
  let from = Infinity;
  let to = -Infinity;
  for (const dt of times) {
    const m = srcIn + speedIntegralOf(clip, clip.start, clip.start + dt, grid);
    if (m < from) from = m;
    if (m > to) to = m;
  }
  if (!Number.isFinite(from)) return { from: srcIn, to: srcIn };
  return { from, to };
}

/**
 * 片段区间内的**最小速度**（采样后的下界）。
 *
 * 音频侧用它决定「这条内嵌音轨能不能按正速播放」：WebAudio 的 `playbackRate`
 * 必须为正，含倒放区间的音轨一律静音（预览与导出同一条规则，见
 * `core/audio-plan.ts` 的注释）。
 */
export function minSpeedOf(clip: SpeedCarrier, grid?: BeatGrid): number {
  const curve = speedCurveOf(clip);
  if (!curve) return baseSpeedOf(clip);
  const dur = Math.max(0, clip.end - clip.start);
  let min = Infinity;
  for (const dt of sampleTimes(clip, dur, grid)) {
    const v = speedAt(clip, clip.start + dt, grid);
    if (v < min) min = v;
  }
  return Number.isFinite(min) ? min : baseSpeedOf(clip);
}

/**
 * 采样点（相对片段起点，秒）：固定 1/40 s 网格 + 两端 + 所有 key 的落点。
 *
 * 网格固定 ⇒ 结果与渲染帧率 / 调用次数无关（确定性）。key 点必须带上：
 * `step` 曲线的折返恰好发生在 key 上，只按网格采样会漏掉它。
 */
function sampleTimes(clip: SpeedCarrier, dur: number, grid?: BeatGrid): number[] {
  const out: number[] = [0, dur];
  const steps = Math.min(600, Math.max(8, Math.ceil(dur * 40)));
  for (let i = 1; i < steps; i++) out.push((dur * i) / steps);
  const curve = speedCurveOf(clip);
  if (curve) {
    // key.t 是相对片段起点（无锚）或相对锚定拍（有锚）的 —— 先换成相对
    // 片段起点的位置，否则锚定曲线的折返点会被扫在错误的地方。
    const origin = curve.beatAnchor && grid
      ? timeAtBeat(curve.beatAnchor.beat, grid) - clip.start
      : 0;
    for (const k of curve.keys) {
      const dt = origin + k.t;
      if (dt > 0 && dt < dur) out.push(dt);
    }
  }
  out.sort((a, b) => a - b);
  return out;
}

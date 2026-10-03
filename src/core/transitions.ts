/**
 * transitions.ts — 出画转场（`SourceClip.transitionOut`）的窗口解析。
 *
 * 纯逻辑，只依赖 schema：**没有 DOM / WebGL，必须可单测**（与 core/curve、
 * core/clips 同级）。渲染侧（engine/stack.ts）与 UI（检查器、时间轴）都从这里
 * 取窗口，不许任何一边自己再算一遍钳制。
 *
 * ## 窗口的几何
 *
 * 转场挂在**出画片段**上，剪切点 `cut = from.end`，窗口以剪切点为中心：
 *
 * ```
 *        from                    to
 *   |=============|--------------------------→ t
 *              [===|===]                      窗口 = [cut - d/2, cut + d/2)
 *                cut
 * ```
 *
 * 左半段吃 from 的尾巴，右半段吃 to 的头。`d` 被三件事钳制（见 `transitionCut`）：
 * from 的长度、to 的长度、以及**两侧相邻转场已经占掉的部分**——保证两个相邻转场的
 * 窗口永不重叠、且窗口永远落在 `[from.start, to.end]` 内（于是窗口内不可能命中
 * 同轨的第三个片段）。
 *
 * ## 两侧片段在窗口内被「超范围」求值
 *
 * 窗口内两个片段都会在自己 span 之外被求值一次：
 *
 * - **to 在 `t < to.start`**：`algos/runtime.ts` 用 `Math.max(0, t - clip.start)`
 *   推进，于是它**停在首帧**（不是负索引，安全）。
 * - **from 在 `t >= from.end`**：烘焙推进量继续走，**继续播放**；image / solid
 *   本来就与 t 无关。
 *
 * 换句话说：程序化的源自然延展，没有余量的素材冻结首/尾帧——这与
 * Premiere「居中于剪切点」的行为一致。
 *
 * ## 生效条件
 *
 * 同轨、**紧邻**（`|to.start - from.end| <= EPS`）的下一个片段必须是 SourceClip。
 * `overlapBehavior` 的 push / trim 都保持相邻；reject 可能留缝，留缝时转场
 * 静默失效（`transitionCut` 返回 `not-adjacent`，由检查器给出提示——**不允许
 * 静默什么都不发生**）。
 */

import type { SourceClip, VisualTrack } from './schema';

/** 相邻判定的容差。片段几何是浮点秒，`splitClipAt` 之类会产生 1e-9 级误差。 */
export const ADJACENT_EPS = 1e-6;

/**
 * 转场时长的下限。`schema.ts` 的校验要求 `duration > 0`，而滑杆/数字框在
 * 用户清空输入框时会给出 0 —— 这里给一个下限，免得工程因为一次误输入变非法。
 */
export const MIN_TRANSITION_DURATION = 0.05;

/**
 * 时长的**唯一**钳制入口（store 落库前与检查器共用一个）。
 *
 * `max <= 0` 表示这个剪切点当前落不了地（不相邻 / 太短）。这时**只保底、
 * 不求上限**：用户把片段拖开再拖回来，转场应该原样还在，而不是被静默改成
 * 0.05s。落不了地由检查器给提示，不由这里毁数据。
 */
export function clampTransitionDuration(requested: number, max: number): number {
  const d = Number.isFinite(requested)
    ? Math.max(requested, MIN_TRANSITION_DURATION)
    : MIN_TRANSITION_DURATION;
  return max > 0 ? Math.min(d, max) : d;
}

/** `ClipBase` 没有 duration 字段，长度一律现算。 */
function lengthOf(c: { start: number; end: number }): number {
  return c.end - c.start;
}

/** 剪切点几何：不看 `transitionOut`，只看这里能不能放转场。 */
export type CutResult =
  | {
      ok: true;
      from: SourceClip;
      to: SourceClip;
      /** 窗口总长的上限（秒）。`0` 时转场无法生效。 */
      max: number;
    }
  | {
      ok: false;
      /** 给检查器用的原因。`no-transition` 不在其中——那是调用方自己判的。 */
      reason: 'no-next' | 'next-not-source' | 'not-adjacent' | 'too-short';
    };

/**
 * 剪切点几何：`from = track.clips[clipIndex]`，`to` 是紧随其后的片段。
 *
 * 这是 `transitionMaxDuration` 与 `transitionAt` 的公共前半段，单独导出是为了让
 * 检查器能区分「没设转场（可以设）」与「设了但落不了地（要提示为什么）」。
 */
export function transitionCut(track: VisualTrack, clipIndex: number): CutResult {
  const from = track.clips[clipIndex];
  if (!from || from.kind !== 'source') return { ok: false, reason: 'no-next' };

  const next = track.clips[clipIndex + 1];
  if (!next) return { ok: false, reason: 'no-next' };
  if (next.kind !== 'source') return { ok: false, reason: 'next-not-source' };
  if (Math.abs(next.start - from.end) > ADJACENT_EPS) return { ok: false, reason: 'not-adjacent' };

  /*
   * 左半段的可用量：from 的长度，扣掉**上一个**转场已经占掉的右半。
   * 故意用上一个片段 `transitionOut.duration` 的**存储值**而不用它的生效值：
   * 存储值 ≥ 生效值，所以这里算出来的可用量偏小 —— 偏小是安全的
   * （窗口更短 = 更不可能与上一个窗口重叠），偏大才危险。
   */
  const prev = track.clips[clipIndex - 1];
  const prevTaken = prev && prev.kind === 'source' && prev.transitionOut
    ? prev.transitionOut.duration / 2
    : 0;
  const left = lengthOf(from) - prevTaken;

  // 右半段的可用量同理：扣掉 to 自己的出画转场将占掉的右半。
  const nextTaken = next.transitionOut ? next.transitionOut.duration / 2 : 0;
  const right = lengthOf(next) - nextTaken;

  const max = 2 * Math.min(left, right);
  if (!(max > 0)) return { ok: false, reason: 'too-short' };

  return { ok: true, from, to: next, max };
}

/**
 * 已生效的转场。`null` = 这一帧没有转场要做。
 *
 * `duration` 是**钳制后**的实际窗口长度，`requested` 是工程里写着的值；
 * 两者不等说明被两侧长度或相邻转场挤短了，UI 要显示提示。
 */
export interface ResolvedTransition {
  from: SourceClip;
  to: SourceClip;
  duration: number;
  requested: number;
}

/** 窗口 + 进度。`start <= t < end`（半开），所以 `progress ∈ [0, 1)`。 */
export interface TransitionWindow extends ResolvedTransition {
  start: number;
  end: number;
  progress: number;
}

/**
 * `duration` 的上限。`0` = 这个剪切点放不了转场。
 * store 落库前与检查器滑杆共用这一个数——**不许两边各写一套钳制**。
 */
export function transitionMaxDuration(track: VisualTrack, clipIndex: number): number {
  const cut = transitionCut(track, clipIndex);
  return cut.ok ? cut.max : 0;
}

/** 解析出钳制后的窗口长度。没设转场 / 落不了地 → null。 */
export function resolveTransition(
  track: VisualTrack,
  clipIndex: number,
): ResolvedTransition | null {
  const from = track.clips[clipIndex];
  if (!from || from.kind !== 'source') return null;
  const tr = from.transitionOut;
  if (!tr) return null;

  const cut = transitionCut(track, clipIndex);
  if (!cut.ok) return null;

  const duration = Math.min(tr.duration, cut.max);
  if (!(duration > 0)) return null;

  return { from, to: cut.to, duration, requested: tr.duration };
}

/**
 * 命中判断。`t` 落在 `[start, end)` 之外返回 null。
 *
 * 半开是刻意的：`t = end` 时应当只看到 `to`（进度 1 的极限），而 `to` 自己
 * 那个 op 在 `t >= to.start` 时本来就在画 —— 两边不会同时产出 op。
 */
export function transitionAt(
  track: VisualTrack,
  clipIndex: number,
  t: number,
): TransitionWindow | null {
  const r = resolveTransition(track, clipIndex);
  if (!r) return null;

  const half = r.duration / 2;
  const start = r.from.end - half;
  const end = r.from.end + half;
  if (t < start || t >= end) return null;

  return { ...r, start, end, progress: (t - start) / r.duration };
}

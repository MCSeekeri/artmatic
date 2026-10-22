/**
 * transitions.ts — 片段**两端**转场（`transitionIn` / `transitionOut`）的窗口解析。
 *
 * 纯逻辑，只依赖 schema：**没有 DOM / WebGL，必须可单测**（与 core/curve、
 * core/clips 同级）。渲染侧（engine/stack.ts）与 UI（检查器、时间轴）都从这里
 * 取窗口，不许任何一边自己再算一遍钳制。
 *
 * ## 窗口的几何
 *
 * 转场挂在片段的**边界**上，窗口以剪切点为中心、前后各 `d / 2`：
 *
 * ```
 *         入场（clip i）                        出场（clip i）
 *   prev? |============| clip ============| next?
 *     [===|===]                    [===|===]
 *      cut=clip.start               cut=clip.end
 * ```
 *
 * - **出场**（`transitionOut`）：左半段吃本片段尾巴，右半段吃下一个片段的头。
 * - **入场**（`transitionIn`）：左半段吃上一个片段的尾巴，右半段吃本片段的头。
 *
 * 两侧由几何自动取到「同轨紧邻的上 / 下一个 SourceClip」；**没有紧邻片段时那一侧
 * 为 `null` —— 全透明**（v13）。于是「轨道第一个片段的入场」「轨道最后一个片段的
 * 出场」都能生效，不需要往工程里塞占位片段。中间有缝隙 / 邻居是特效片段时同理：
 * 那一侧没有画面，按透明处理。
 *
 * ## 同一边界只能有一个转场
 *
 * 片段 i 的 `transitionIn` 与片段 i-1 的 `transitionOut` 落在同一个剪切点上。
 * 两边都设了时**以出场为准**（`transitionOut` 在数据上先出现、也是 NLE 的惯例），
 * 入场被标记为 `shadowed`，检查器给出原因 —— 不允许静默什么都不发生。
 *
 * ## 时长钳制
 *
 * 半窗不能越过片段边界：`inHalf + outHalf <= clipLength`（同一片段的两个转场），
 * 且邻侧存在时半窗不能超过邻居剩下的可用量。相邻转场的**存储值**用来算占用量
 * （存储值 ≥ 生效值，因此算出来的可用量偏小 —— 偏小是安全的）。
 *
 * 邻侧为 `null` 时那一半落在时间线外 / 空档里，不消耗任何片段长度；上限只由
 * 有内容的那一侧决定（用户要的「零片段转场由片段自身长度决定」）。
 *
 * 入场在轨道最开头（`cut = 0`）时额外要求 `半窗 <= cut`：窗口不早于 0，
 * 否则 t=0 会从「淡了一半」开始。
 */

import type { SourceClip, VisualTrack } from './schema';

/** 相邻判定的容差。片段几何是浮点秒，`splitClipAt` 之类会产生 1e-9 级误差。 */
export const ADJACENT_EPS = 1e-6;

/**
 * 转场时长的下限。`schema.ts` 的校验要求 `duration > 0`，而滑杆/数字框在
 * 用户清空输入框时会给出 0 —— 这里给一个下限，免得工程因为一次误输入变非法。
 */
export const MIN_TRANSITION_DURATION = 0.05;

export type TransitionSide = 'in' | 'out';

/**
 * 时长的**唯一**钳制入口（store 落库前与检查器共用一个）。
 *
 * `max <= 0` 表示这个边界当前落不了地（太短）。这时**只保底、不求上限**：
 * 用户把片段拖开再拖回来，转场应该原样还在，而不是被静默改成 0.05s。
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

function sourceAt(track: VisualTrack, index: number): SourceClip | null {
  const clip = track.clips[index];
  return clip && clip.kind === 'source' ? clip : null;
}

function refOf(clip: SourceClip, side: TransitionSide) {
  return side === 'out' ? clip.transitionOut : clip.transitionIn;
}

/**
 * 紧邻的上 / 下一个 SourceClip（不紧邻返回 null）。
 *
 * `null` 的语义是「那一侧没有画面」—— 渲染侧据此用全透明层。缝隙不算错误：
 * 落点策略 `reject` 本来就可能留缝，此时转场仍能作为「淡到空」使用。
 */
export function adjacentSource(track: VisualTrack, index: number, side: TransitionSide): SourceClip | null {
  const clip = sourceAt(track, index);
  if (!clip) return null;
  if (side === 'out') {
    const next = sourceAt(track, index + 1);
    if (!next || Math.abs(next.start - clip.end) > ADJACENT_EPS) return null;
    return next;
  }
  const prev = sourceAt(track, index - 1);
  if (!prev || Math.abs(clip.start - prev.end) > ADJACENT_EPS) return null;
  return prev;
}

/* ------------------------------------------------------- 时长上限 */

/** 本片段入场 / 出场已经占掉的半窗（存储值；被遮蔽的入场不算）。 */
function halfIn(track: VisualTrack, index: number): number {
  const clip = sourceAt(track, index);
  if (!clip || !clip.transitionIn) return 0;
  if (isTransitionInShadowed(track, index)) return 0;
  return clip.transitionIn.duration / 2;
}

function halfOut(clip: SourceClip | null): number {
  return clip?.transitionOut ? clip.transitionOut.duration / 2 : 0;
}

/**
 * 本片段**头部**已被占掉的半窗：自己的入场（未被遮蔽时）+ 前一段出场伸进来的右半。
 *
 * 只算自己的入场是不够的：`a.out` 的右半落在 `b` 的头上，`b.out` 的左半落在
 * `b` 的尾上，两者会在这个短片段里撞车。漏掉前一项的表现是「相邻两个转场
 * 的窗口重叠」——画面会在一帧里同时跑两次转场，通常只是花一下。
 */
function headUsed(track: VisualTrack, index: number): number {
  const clip = sourceAt(track, index);
  if (!clip) return 0;
  let used = halfIn(track, index);
  const prev = adjacentSource(track, index, 'in');
  if (prev?.transitionOut && outCut(track, index - 1).ok) used += prev.transitionOut.duration / 2;
  return used;
}

/**
 * 入场是否被前一段的出场接管（同一边界两个转场）。
 *
 * 只在**前一段的出场能落地**时才算遮蔽：前一段太短、出场本身放不下时，
 * 让入场继续工作比「两个都没有」好。
 */
export function isTransitionInShadowed(track: VisualTrack, index: number): boolean {
  const clip = sourceAt(track, index);
  if (!clip?.transitionIn) return false;
  const prev = adjacentSource(track, index, 'in');
  // 前一段**没有**出场转场 = 这个边界只有入场，谈不上遮蔽。
  if (!prev?.transitionOut) return false;
  return outCut(track, index - 1).ok;
}

/** `transitionOut` 的几何（不看遮蔽；入场遮蔽判定要用它）。 */
function outCut(track: VisualTrack, index: number): CutResult {
  return transitionCut(track, index, 'out');
}

/** 剪切点几何：不看转场本身能不能落地，只看这里放不放得下。 */
export type CutResult =
  | {
      ok: true;
      side: TransitionSide;
      index: number;
      /** 剪切点（工程秒）。 */
      cut: number;
      from: SourceClip | null;
      to: SourceClip | null;
      /** 窗口总长的上限（秒）。`0` 时转场无法生效。 */
      max: number;
    }
  | {
      ok: false;
      reason: 'no-transition' | 'shadowed' | 'too-short';
    };

/**
 * 边界几何：`side` 指定入场还是出场。
 *
 * 这是 `transitionMaxDuration` 与 `transitionAt` 的公共前半段，单独导出是为了让
 * 检查器能区分「没设转场」与「设了但落不了地（要提示为什么）」。
 */
export function transitionCut(track: VisualTrack, index: number, side: TransitionSide = 'out'): CutResult {
  const clip = sourceAt(track, index);
  if (!clip) return { ok: false, reason: 'no-transition' };
  if (side === 'in' && isTransitionInShadowed(track, index)) return { ok: false, reason: 'shadowed' };

  /*
   * ⚠️ 这里**不看转场引用存不存在**：控制平面要在「还没设」的时候先问一句
   * 「这个边界放不放得下」。要求 ref 存在的话，第一次设置永远得到
   * no-transition —— agent 会以为剪切点不合法。
   */
  const from = side === 'out' ? clip : adjacentSource(track, index, 'in');
  const to = side === 'out' ? adjacentSource(track, index, 'out') : clip;

  let max: number;
  if (side === 'out') {
    const left = lengthOf(clip) - headUsed(track, index);
    const right = to ? lengthOf(to) - halfOut(to) : Infinity;
    max = 2 * Math.min(left, right);
  } else {
    const right = lengthOf(clip) - halfOut(clip);
    /*
     * 邻侧存在 → 用邻居剩余的长度；邻侧为 null → 上限是「到 0 的距离」，
     * 保证窗口不早于 0（见文件头）。两者取小，再乘 2 得到窗口总长。
     */
    const left = from ? lengthOf(from) - headUsed(track, index - 1) : clip.start;
    max = 2 * Math.min(right, left);
  }
  if (!(max > 0)) return { ok: false, reason: 'too-short' };
  return {
    ok: true,
    side,
    index,
    cut: side === 'out' ? clip.end : clip.start,
    from,
    to,
    max,
  };
}

/** `duration` 的上限。`0` = 这个边界放不了转场。 */
export function transitionMaxDuration(
  track: VisualTrack,
  index: number,
  side: TransitionSide = 'out',
): number {
  const cut = transitionCut(track, index, side);
  return cut.ok ? cut.max : 0;
}

/**
 * 已生效的转场。`null` = 这一帧没有转场要做 / 设了但落不了地。
 *
 * `duration` 是**钳制后**的实际窗口长度，`requested` 是工程里写着的值；
 * 两者不等说明被两侧长度或相邻转场挤短了，UI 要显示提示。
 */
export interface ResolvedTransition {
  side: TransitionSide;
  index: number;
  /** 剪切点（工程秒）。出场 = `from.end`，入场 = `to.start`。 */
  cut: number;
  from: SourceClip | null;
  to: SourceClip | null;
  duration: number;
  requested: number;
}

/** 窗口 + 进度。`start <= t < end`（半开），所以 `progress ∈ [0, 1)`。 */
export interface TransitionWindow extends ResolvedTransition {
  start: number;
  end: number;
  progress: number;
}

/** 解析出钳制后的窗口长度。没设转场 / 落不了地 → null。 */
export function resolveTransition(
  track: VisualTrack,
  index: number,
  side: TransitionSide = 'out',
): ResolvedTransition | null {
  const cut = transitionCut(track, index, side);
  if (!cut.ok) return null;
  const clip = sourceAt(track, index);
  const ref = clip ? refOf(clip, side) : undefined;
  if (!ref) return null;

  const duration = Math.min(ref.duration, cut.max);
  if (!(duration > 0)) return null;

  return {
    side,
    index,
    cut: cut.cut,
    from: cut.from,
    to: cut.to,
    duration,
    requested: ref.duration,
  };
}

/**
 * 命中判断。`t` 落在 `[start, end)` 之外返回 null。
 *
 * 半开是刻意的：`t = end` 时应当只看到右侧片段（进度 1 的极限），而它自己
 * 那个 op 在 `t >= start` 时本来就在画 —— 两边不会同时产出 op。
 */
export function transitionAt(
  track: VisualTrack,
  index: number,
  side: TransitionSide,
  t: number,
): TransitionWindow | null {
  const r = resolveTransition(track, index, side);
  if (!r) return null;

  const half = r.duration / 2;
  const start = r.cut - half;
  const end = r.cut + half;
  if (t < start || t >= end) return null;

  return { ...r, start, end, progress: (t - start) / r.duration };
}

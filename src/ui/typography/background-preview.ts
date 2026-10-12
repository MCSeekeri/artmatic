/**
 * background-preview.ts — 排版「背景预览」的**纯逻辑**（无 runes / 无 DOM / 无 renderer）。
 *
 * 单独一份普通 `.ts` 而不是塞进 `.svelte.ts`：这几个函数要能被单测直接跑，
 * 而 `.svelte.ts` 那份会把 `appState`（一大串服务装配）拖进来。判据与
 * `ui/media-pool.ts` 一致：**纯函数 + 单测**，响应式那一半另放。
 *
 * 背景预览要回答的问题：「这个排版叠加层压到**它下面的画面**上是什么样」。
 * 所以这里最关键的一条是 `backgroundProject`：把**正在编辑的那个排版片段**
 * 从求值里拿掉，只留下它底下（以及它上面的调色/特效）的内容当底图。
 */

import type { Project, SourceClip, Track } from '../../core/schema';

/** 底图单帧的渲染宽度（像素）。半透明底图，够看清版式即可 —— 不必按工程分辨率重渲。 */
export const BG_FRAME_WIDTH = 480;

/** 播放中底图的刷新频率（Hz）。每 rAF 都重渲一帧会把主线程塞满，降频看不出来。 */
export const BG_PLAY_HZ = 12;

/**
 * 默认不透明度。
 *
 * **保守取 0.3**：底图是用来对齐版式的参照，不是画面本身。太实会盖住排版内容、
 * 也让人误以为「这就是最终样子」（最终合成里排版在**上**，底图在**下**）。
 * 30% 足以读出边界与运动，又不喧宾夺主。
 */
export const BG_DEFAULT_OPACITY = 0.3;

export const BG_MIN_OPACITY = 0;
export const BG_MAX_OPACITY = 1;

/** 把任意输入夹到合法不透明度。非有限值回落到默认值（滑杆清空时会给 NaN）。 */
export function clampBgOpacity(v: number): number {
  if (!Number.isFinite(v)) return BG_DEFAULT_OPACITY;
  return Math.min(BG_MAX_OPACITY, Math.max(BG_MIN_OPACITY, v));
}

/**
 * 底图取帧的尺寸：固定宽度、按工程宽高比换算高度。
 *
 * 用「固定宽度」而不是「固定比例系数」：底图只要看得清版式边界，480 宽在任何
 * 分辨率下都够，且渲染成本恒定 —— 工程是 4K 时也不会忽然慢八倍。
 */
export function bgFrameSize(
  res: { w: number; h: number },
  maxWidth: number = BG_FRAME_WIDTH,
): { w: number; h: number } {
  const w = Math.max(1, Math.round(maxWidth));
  const ratio = res && res.w > 0 && res.h > 0 ? res.h / res.w : 9 / 16;
  return { w, h: Math.max(1, Math.round(w * ratio)) };
}

/**
 * 把正在编辑的排版片段从「底图工程」里拿掉（其余原样）。
 *
 * 做法是**克隆**工程而不是改原对象：`renderer.renderFrame(project, t)` 收一个
 * project 参数，正好可以喂一份改过的副本，工程真相（store）一个字节都不动。
 *
 * 为什么不是「整条片段删掉」：同轨的转场靠**数组下标**找相邻片段
 * （`core/transitions.ts` 的 `transitionCut(track, clipIndex)`），抽掉一个片段会让
 * 后续下标整体前移，把别的转场指到错的邻居上。所以这里保留片段位置，只把它
 * 变成「不可见」。
 *
 * 为什么不是简单 `opacity = 0`：`resolveSource` 用
 * `paramWithCurve(clip, 'opacity', clip.opacity, ...)` —— 片段上只要有 opacity
 * **曲线**，它就盖过基值（demo 的标题片段正是带淡入淡出曲线的），文本照样画出来。
 * 所以必须**同时删掉 opacity 曲线**。
 *
 * 找不到该片段时原样返回同一个对象（不产生垃圾副本）。
 */
export function backgroundProject(project: Project, clipId: string): Project {
  let touched = false;
  const tracks: Track[] = project.tracks.map((track) => {
    if (track.kind !== 'visual') return track;
    if (!track.clips.some((c) => c.id === clipId)) return track;
    touched = true;
    return {
      ...track,
      clips: track.clips.map((c) => (c.id === clipId && c.kind === 'source' ? hideClip(c) : c)),
    };
  });
  return touched ? { ...project, tracks } : project;
}

/** 一份「不产生任何画面」的片段副本：opacity 基值归零 + 删掉会盖过它的曲线。 */
function hideClip(clip: SourceClip): SourceClip {
  const curves = { ...clip.curves };
  delete curves.opacity;
  return { ...clip, opacity: 0, curves };
}

/** `advancePreviewTime` 的结果。 */
export interface PreviewTick {
  /** 推进后的绝对时间（秒）。 */
  at: number;
  /** 是否仍在播放。false = 已到片段尾。 */
  playing: boolean;
  /** 是否刚好走到尾（用于调用方决定「停止并复原」）。 */
  ended: boolean;
}

/**
 * 推进预览时间的**唯一**一步（纯函数，可单测）。
 *
 * 两条语义：
 *  - **到片段尾就停，不回环**（`next >= clip.end` → `at = clip.end`、`playing = false`）。
 *  - 单步最大 0.25s：标签页切回来 / 长卡顿时 rAF 的 `dt` 可能是几秒，
 *    不夹住的话时间会一次跳过大半段。夹住只是慢一点，不影响正确性。
 */
export function advancePreviewTime(
  at: number,
  dt: number,
  clip: { start: number; end: number },
): PreviewTick {
  const step = Math.min(0.25, Math.max(0, dt));
  const next = at + step;
  if (next >= clip.end) return { at: clip.end, playing: false, ended: true };
  return { at: next, playing: true, ended: false };
}

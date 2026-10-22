/**
 * flashback.ts — 闪回：把**片段之前的画面**倒着放回来（`recall` 型生成器）。
 *
 * ## 一个生成器为什么需要新的 kind
 *
 * `bake` / `sim` / `realtime` 三者都只依赖 `(参数, t, seed)` —— 同一个 t 在哪台
 * 机器上都算出同一张图。闪回不是这类东西：它的内容**只存在于时间轴上**，是
 * 「此前渲染出来的那一帧」。所以它是第四种型 `recall`：运行时向宿主索取
 * 「时间轴上某个过去时刻的整帧」，自己不做任何像素计算（因此没有 fragment、
 * 没有 `intRes`、参数也不能打关键帧）。
 *
 * 求值链：`AlgoRuntime.resolve` → `RecallProvider`（`render/recall.ts`）→
 * 用一个**独立的合成器**把工程在过去的 t 上重渲一帧 → 当作源纹理返回。
 *
 * ## 速度是算出来的，不是参数
 *
 * 需求只有一句：「调整播放速度以便让片段的时长正好播完之前的内容」。
 * 于是速度 = 回放窗口长度 / 片段时长，**完全由几何决定**，没有 speed 参数：
 * 有一个可以由别的东西推出来的旋钮，就会有两个互相矛盾的真源。
 *
 * 帧号量化在 `recall.ts`（要 project.fps）；这里只给连续时间的映射，才能纯测。
 *
 * ## 回放窗口永远在片段头之前
 *
 * `recallWindowOf` 把窗口夹在 `[0, 片段头]` 上。这不只是「倒放之前的画面」的
 * 语义 —— 它同时**保证递归是良基的**：回放帧里的闪回只会去更早的时刻，
 * 不可能指回自己（或形成环）。破坏这条会让 render 栈无限展开。
 *
 * ## 两个参数
 *
 * - `back`（回溯）：往回取多少秒。`0` = 一直回到时间轴开头（出厂默认）。
 * - `gap`（间隔）：回放窗口的末端离片段头多远。`0` = 紧接片段之前。
 *
 * 两者都按**相对片段头**给，于是拖片段时回放内容跟着走 —— 与「片段内容是
 * 相对素材的」这条 NLE 常识一致。
 */

import type { ParamDef } from '../effects/types';
import type { GeneratorDef } from './types';

export const FLASHBACK_ID = 'flashback';

/** 回溯窗口，单位是**绝对时间轴秒**。 */
export interface RecallWindow {
  from: number;
  to: number;
}

/** 参数缺失 / 手改坏的工程文件时的兜底（= 出厂默认，见 def）。 */
const BACK_FALLBACK = 0;
const GAP_FALLBACK = 0;

/** 窗口短于这一秒数就当作「没有过去可放」—— 半帧以下的重复没有意义。 */
const MIN_WINDOW_SEC = 1 / 240;

function num(v: unknown, fallback: number): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * 由片段头 + 参数算出回放窗口；`null` = 没有「之前」可以倒放。
 *
 * 三条边界都是刻意的：
 *  - 窗口末端 **不能越过片段头**（`gap` 为负时也要挡住）；
 *  - `back <= 0` 表示「一直到头」而不是「0 秒」—— 0 秒窗口本身是无意义的，
 *    拿它当哨兵不会与任何真实用法冲突，而出厂默认值只能是静态数字；
 *  - 片段头在时间轴 0 处时窗口为空 → 返回 null，那一层这帧缺席（透明），
 *    而不是画一张黑图。
 */
export function recallWindowOf(
  clipStart: number,
  params: Record<string, number | string> | undefined,
): RecallWindow | null {
  const back = Math.max(0, num(params?.['back'], BACK_FALLBACK));
  const gap = Math.max(0, num(params?.['gap'], GAP_FALLBACK));
  const to = Math.max(0, clipStart - gap);
  const from = back > 0 ? Math.max(0, to - back) : 0;
  return to - from >= MIN_WINDOW_SEC ? { from, to } : null;
}

/**
 * 时刻 `t` 应该回放**哪个源时间**（秒）—— 进度 0 取窗口末端，进度 1 取窗口开头。
 *
 * 越界求值（转场会把片段求到它 start 之前）夹到端点：那时应当看到窗口末端
 * 的那一帧，而不是负进度算出来的「未来」。
 */
export function recallTimeOf(
  clipStart: number,
  clipEnd: number,
  win: RecallWindow,
  t: number,
): number {
  const dur = clipEnd - clipStart;
  const u = dur > 1e-9 ? Math.min(1, Math.max(0, (t - clipStart) / dur)) : 0;
  return win.to - u * (win.to - win.from);
}

/** 把秒量化到工程帧号上（回放走的是**一帧一帧**的视频，不是连续时间采样）。 */
export function recallFrameOf(sec: number, fps: number): number {
  const rate = Number.isFinite(fps) && fps > 0 ? fps : 1;
  const s = Number.isFinite(sec) ? sec : 0;
  return Math.max(0, Math.round(s * rate));
}

const PARAMS: ParamDef[] = [
  { key: 'back', labelKey: 'algo.flashback.back', type: 'range', min: 0, max: 120, step: 0.1, defaultValue: 0 },
  { key: 'gap', labelKey: 'algo.flashback.gap', type: 'range', min: 0, max: 120, step: 0.1, defaultValue: 0 },
];

export const flashbackDef: GeneratorDef = {
  id: FLASHBACK_ID,
  nameKey: 'algo.flashback',
  kind: 'recall',
  params: PARAMS,
};

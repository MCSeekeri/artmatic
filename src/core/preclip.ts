/**
 * preclip.ts — 视频预剪辑范围（In/Out 对）的纯逻辑。
 *
 * 一件事：把「用户在第 N 帧打了入点」翻译成工程里存得住的秒值，并且**只有这一份**
 * 取整规则。UI 的拖柄、I/O 快捷键、插入片段、工程校验全都调这里 —— 各处各写一遍
 * `Math.round(t * fps) / fps` 的形态是「界面显示第 12 帧、片段实际从 12.4 帧开始」，
 * 而那种偏差在时间轴上根本看不出来。
 *
 * 为什么落库是**秒**而不是帧：`AssetTrimRange` 随工程走，工程 fps 改了呢？
 * 存帧号会把所有范围静默重算成不同的时间点；存秒则只有显示变了，切点不动。
 *
 * 纯函数、无 DOM / WebGL，可单测（`tests/unit/preclip.test.ts`）。
 */

import { newId, type AssetTrimRange } from './schema';

/** 一个范围至少 1 帧 —— 0 帧的片段在 schema 里是非法的（`end > start`）。 */
export const MIN_RANGE_FRAMES = 1;

/** 秒 → 帧号（就近取整）。负值归 0：素材没有负时间。 */
export function frameOfSec(sec: number, fps: number): number {
  const rate = Math.max(1, fps);
  if (!Number.isFinite(sec)) return 0;
  return Math.max(0, Math.round(sec * rate));
}

/** 帧号 → 秒。与 `core/time.ts::timeAtFrame` 同一定义域。 */
export function secOfFrame(frame: number, fps: number): number {
  return Math.max(0, Math.floor(frame)) / Math.max(1, fps);
}

/** 把秒对齐到最近的帧边界。写入范围 / 建片段前都要过这一道。 */
export function snapSecToFrame(sec: number, fps: number): number {
  return secOfFrame(frameOfSec(sec, fps), fps);
}

/** 范围覆盖多少帧（四舍五入到整帧；范围本身已按帧对齐）。 */
export function rangeFrames(range: Pick<AssetTrimRange, 'inSec' | 'outSec'>, fps: number): number {
  return Math.max(0, frameOfSec(range.outSec, fps) - frameOfSec(range.inSec, fps));
}

/** 范围的时长（秒）= 帧数 / fps。插入片段时用它，保证与显示一致。 */
export function rangeDurationSec(range: Pick<AssetTrimRange, 'inSec' | 'outSec'>, fps: number): number {
  return rangeFrames(range, fps) / Math.max(1, fps);
}

/**
 * 归一化一个范围：按帧取整、至少 1 帧、不越出素材时长。
 *
 * 返回 `null` = 这个范围在这条素材上根本立不住（素材短于一帧，或入点在末尾）。
 * 调用方（UI / 校验）遇到 null 应当丢弃这一条，而不是把它改成 0 长片段。
 */
export function normalizeRange(
  input: { inSec: number; outSec: number },
  assetDurationSec: number,
  fps: number,
): { inSec: number; outSec: number } | null {
  const rate = Math.max(1, fps);
  const totalFrames = Math.max(0, Math.floor(assetDurationSec * rate + 1e-6));
  if (totalFrames < MIN_RANGE_FRAMES) return null;

  const inFrame = Math.min(Math.max(0, Math.round(input.inSec * rate)), totalFrames - MIN_RANGE_FRAMES);
  const outFrame = Math.min(Math.max(inFrame + MIN_RANGE_FRAMES, Math.round(input.outSec * rate)), totalFrames);
  if (!(outFrame > inFrame)) return null;
  return { inSec: inFrame / rate, outSec: outFrame / rate };
}

/** 视频片段在工程时间轴上的落点：`start` / `end` / `srcIn`。 */
export interface RangeSpan {
  start: number;
  end: number;
  srcIn: number;
}

/**
 * 把范围落在时间轴 `at` 处。
 *
 * `length` 用帧数算，不用 `outSec - inSec` 直接减：两者在已对齐的数据上相等，
 * 但手改 JSON 带进来的 1e-9 误差会累积成「片段比范围长半帧」。
 */
export function spanFromRange(
  range: Pick<AssetTrimRange, 'inSec' | 'outSec'>,
  at: number,
  fps: number,
): RangeSpan {
  const start = Math.max(0, at);
  return {
    start,
    end: start + rangeDurationSec(range, fps),
    srcIn: snapSecToFrame(range.inSec, fps),
  };
}

/**
 * 下一个范围的名字：`范围 N`，N 取已用编号的最大值 +1。
 *
 * 名字是**生成那一刻就固定**的数据（随工程保存），所以模板由调用方传进来 ——
 * 切语言不重命名已有范围，与「片段 label 是用户数据」同一条纪律。
 */
export function nextRangeName(existing: readonly Pick<AssetTrimRange, 'name'>[], template: (n: number) => string): string {
  let max = 0;
  for (const r of existing) {
    const m = /(\d+)\s*$/.exec(r.name);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return template(max + 1);
}

/** 新建一个范围（id 与名字都现生成）。 */
export function newRange(
  inSec: number,
  outSec: number,
  name: string,
): AssetTrimRange {
  return { id: newId(), name, inSec, outSec };
}

/** 素材上按 id 找范围。`activeId` 失效时返回第一个（双击插入不该变成「整段」）。 */
export function activeRangeOf(
  asset: { ranges?: AssetTrimRange[]; activeRangeId?: string },
): AssetTrimRange | null {
  const ranges = asset.ranges ?? [];
  if (!ranges.length) return null;
  return ranges.find((r) => r.id === asset.activeRangeId) ?? ranges[0] ?? null;
}

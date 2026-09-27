/**
 * clips.ts — 片段几何：移动 / 缩放 / 切分 / 三种重叠策略。
 *
 * 移植自 openmosh timeline/clips.ts（MIT，见 CREDITS.md）的钳制算法，
 * 在此基础上实现用户定死的可配置重叠策略（AGENTS.md §5「MVP 里定死一个」
 * 已被用户升级为「可配置项」）：
 *   reject  拒绝落点——拖到哪算哪，钳到邻居边界（openmosh 的原语义）
 *   push    挤开邻居——落点重叠时把邻居连同后面的片段一起顺移
 *   trim    吃掉邻居重叠部分——邻居被裁，不足 MIN_CLIP_LENGTH 就删
 *
 * 全部是不可变纯函数：lane 进，新 lane 出。UI 只在拖拽结束时调一次，
 * 对策略零感知。
 */

import type { OverlapBehavior } from './schema';

/** 最短片段长度（秒）：拖动 / 裁切都不会留下比这更短的碎片。 */
export const MIN_CLIP_LENGTH = 0.05;

export interface Span {
  id: string;
  start: number;
  end: number;
}

export function sortSpans<C extends Span>(clips: C[]): C[] {
  return [...clips].sort((a, b) => a.start - b.start);
}

/** 覆盖 time 的片段（半开区间 [start, end)）。 */
export function spanAt<C extends Span>(clips: C[], time: number): C | null {
  for (const c of clips) if (time >= c.start && time < c.end) return c;
  return null;
}

/** time 所在的空档，被邻居与 [0, duration] 夹住；time 在片段上返回 null。 */
export function freeRangeAt(
  clips: Span[],
  time: number,
  duration: number,
): { start: number; end: number } | null {
  if (spanAt(clips, time)) return null;
  let start = 0;
  let end = duration;
  for (const c of clips) {
    if (c.end <= time) start = Math.max(start, c.end);
    if (c.start > time) end = Math.min(end, c.start);
  }
  return end - start >= MIN_CLIP_LENGTH ? { start, end } : null;
}

/* ----------------------------------------------------------------- 移动 */

/**
 * 把 id 片段滑到 newStart（保持长度），按 behavior 解决重叠。
 * duration 是工程总长（片段不许越界）。
 */
export function moveSpan<C extends Span>(
  clips: C[],
  id: string,
  newStart: number,
  duration: number,
  behavior: OverlapBehavior,
): C[] {
  const clip = clips.find((c) => c.id === id);
  if (!clip) return clips;
  const len = clip.end - clip.start;
  switch (behavior) {
    case 'reject':
      return moveReject(clips, clip, newStart, duration);
    case 'push':
      return movePush(clips, clip, newStart, duration);
    case 'trim':
      return moveTrim(clips, clip, newStart, duration);
  }
}

/**
 * reject：落点非法就整次不动——用户定死的语义是「拒绝落点」，
 * 不是「钳在当前空档里」（openmosh 的语义拖不过邻居，这里不采用）。
 * 拖拽交互由 UI 配合：候选位置非法时显示 not-allowed 并保持上一个合法位置。
 */
function moveReject<C extends Span>(clips: C[], clip: C, newStart: number, duration: number): C[] {
  const len = clip.end - clip.start;
  const start = Math.max(0, Math.min(newStart, duration - len));
  const end = start + len;
  const blocked = clips.some((o) => o.id !== clip.id && o.start < end - 1e-9 && o.end > start + 1e-9);
  if (blocked) return clips;
  return replaceSpan(clips, { ...clip, start, end });
}

/**
 * push：落点就位后做一次从左到右的扫掠，凡是重叠都把右边的片段顺移到
 * 前一个片段的 end。级联只向右传播；移出工程末尾的片段被钳回
 * （此时整次移动保持合法，因为扫掠会把它前面的空隙让出来）。
 */
function movePush<C extends Span>(clips: C[], clip: C, newStart: number, duration: number): C[] {
  const len = clip.end - clip.start;
  const start = Math.max(0, Math.min(newStart, duration - len));
  const placed: C[] = clips.map((c) =>
    c.id === clip.id ? { ...c, start, end: start + len } : c,
  );
  const sorted = sortSpans(placed);
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1]!;
    const cur = sorted[i]!;
    if (cur.start < prev.end - 1e-9) {
      const shift = prev.end - cur.start;
      sorted[i] = { ...cur, start: cur.start + shift, end: cur.end + shift };
    }
  }
  // 扫掠可能把尾巴推出工程末尾：整体向左回吸到合法（保持相对位置）。
  const overflow = Math.max(0, sorted[sorted.length - 1]!.end - duration);
  if (overflow > 0) {
    // 回吸受 0 与彼此不重叠约束；若连被拖片段本身都无处可去，放弃本次移动。
    const minStart = start - overflow;
    if (minStart < 0) return clips;
    const pulled = sorted.map((c) => ({ ...c, start: c.start - overflow, end: c.end - overflow }));
    if (hasOverlap(pulled)) return clips;
    return sortSpans(pulled);
  }
  return sorted;
}

/** trim：落点就位，邻居被吃掉重叠部分；被完全盖住的删除，被从中间盖住的裂成两段。 */
function moveTrim<C extends Span>(clips: C[], clip: C, newStart: number, duration: number): C[] {
  const len = clip.end - clip.start;
  const start = Math.max(0, Math.min(newStart, duration - len));
  const end = start + len;
  const out: C[] = [];
  for (const o of clips) {
    if (o.id === clip.id) continue;
    if (o.end <= start || o.start >= end) { out.push(o); continue; }
    const hasLeft = o.start < start - 1e-9 && start - o.start >= MIN_CLIP_LENGTH;
    const hasRight = o.end > end + 1e-9 && o.end - end >= MIN_CLIP_LENGTH;
    if (hasLeft && hasRight) {
      // 从中间被吃掉：左段保留原 id，右段裂出新片段。
      // 几何层给右段一个稳定派生 id，调用方（project-store）负责换成真正的 newId。
      out.push({ ...o, end: start });
      out.push({ ...o, id: `${o.id}#r`, start: end });
    } else if (hasLeft) {
      out.push({ ...o, end: start });
    } else if (hasRight) {
      // 只被裁头：仍是同一个片段，保留原 id。
      out.push({ ...o, start: end });
    }
    // 两段都立不住（完全被盖住）：删除。
  }
  out.push({ ...clip, start, end });
  return sortSpans(out);
}

/* ----------------------------------------------------------------- 缩放 */

/**
 * 拖片段的一条边。缩放永远用 reject 语义（钳到邻居边界）：
 * 缩放触发 push/trim 的级联是交互灾难——拖一条边把整轨推走或吃掉，
 * 用户没法预判。移动才有策略，缩放只做钳制。
 */
export function resizeSpan<C extends Span>(
  clips: C[],
  id: string,
  edge: 'start' | 'end',
  time: number,
  duration: number,
): C[] {
  const clip = clips.find((c) => c.id === id);
  if (!clip) return clips;
  const others = clips.filter((c) => c.id !== id);
  if (edge === 'start') {
    let lower = 0;
    for (const o of others) if (o.end <= clip.start) lower = Math.max(lower, o.end);
    const start = Math.min(Math.max(time, lower), clip.end - MIN_CLIP_LENGTH);
    return replaceSpan(clips, { ...clip, start });
  }
  let upper = duration;
  for (const o of others) if (o.start >= clip.end) upper = Math.min(upper, o.start);
  const end = Math.max(Math.min(time, upper), clip.start + MIN_CLIP_LENGTH);
  return replaceSpan(clips, { ...clip, end });
}

/* ----------------------------------------------------------------- 切分 */

/** 在 at 处把片段切成两段（纯几何；曲线的拆分在 project-store 里做）。 */
export function splitSpan<C extends Span>(clips: C[], id: string, at: number, makeId: () => string): C[] | null {
  const clip = clips.find((c) => c.id === id);
  if (!clip) return null;
  if (at <= clip.start + MIN_CLIP_LENGTH || at >= clip.end - MIN_CLIP_LENGTH) return null;
  const left: C = { ...clip, end: at };
  const right: C = { ...clip, id: makeId(), start: at };
  return sortSpans([...clips.filter((c) => c.id !== id), left, right]);
}

/* ----------------------------------------------------------------- 其他 */

export function replaceSpan<C extends Span>(clips: C[], clip: C): C[] {
  return sortSpans(clips.map((c) => (c.id === clip.id ? clip : c)));
}

export function hasOverlap(clips: Span[]): boolean {
  const s = sortSpans(clips);
  for (let i = 1; i < s.length; i++) {
    if (s[i]!.start < s[i - 1]!.end - 1e-9) return true;
  }
  return false;
}

/**
 * 片段在 time 的强度：fadeSec 淡入淡出斜坡（移植 openmosh clipFadeWeight）。
 * 渲染侧把它乘进 opacity——GLSL 不需要知道 fade 的存在。
 */
export function fadeWeight(clip: Span, fadeSec: number, time: number): number {
  if (fadeSec <= 0) return 1;
  const ramp = Math.min(fadeSec, (clip.end - clip.start) / 2);
  if (ramp <= 0) return 1;
  const inW = (time - clip.start) / ramp;
  const outW = (clip.end - time) / ramp;
  return Math.max(0, Math.min(1, inW, outW));
}

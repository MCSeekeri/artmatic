/**
 * clips.ts — 片段几何：移动 / 缩放 / 切分 / 三种重叠策略。
 *
 * 移植自 openmosh timeline/clips.ts（MIT，见 CREDITS.md）的钳制算法，
 * 在此基础上实现用户定死的可配置重叠策略（AGENTS.md §5「MVP 里定死一个」
 * 已被用户升级为「可配置项」）：
 *   reject  拒绝落点——落点非法整次不动（openmosh 的原语义是「钳在当前空档」，
 *           那会导致永远拖不过邻居，与 NLE 直觉不符，这里不采用）
 *   push    挤开邻居——被落点压到的片段整体让位，更远处的片段级联跟着走
 *   trim    吃掉邻居重叠部分——邻居被裁，不足 MIN_CLIP_LENGTH 就删
 *
 * 全部是不可变纯函数：lane 进，新 lane 出，对策略零感知。
 *
 * 【时序约定 · 2026-09-27 用户反馈后确立】
 * 拖拽期间的实时预览**不套用策略**（timeline/drag.ts 只做 clamp 级别的自由移动，
 * 允许视觉重叠），策略一律在**松手时**结算一次。理由：trim 在拖动过程中就吃掉
 * 邻居是不可逆的破坏（拖过去再拖回来，邻居回不来）。
 * 例外是 resize 的 reject——单边钳制、非破坏性，实时生效反馈更好。
 *
 * 因此策略函数一律按「干净 lane + 候选几何的片段」入参（placeSpan 的签名刻意如此）：
 * 拖拽期间被拖片段可能已经压在邻居身上，若把脏 lane 直接丢进来，push 的扫掠
 * 会把锚点自己推走。
 */

import type { OverlapBehavior } from './schema';

/** 最短片段长度（秒）：拖动 / 裁切都不会留下比这更短的碎片。 */
export const MIN_CLIP_LENGTH = 0.05;

/** 浮点比较容差（秒）。半开区间下贴边不算重叠。 */
const EPS = 1e-9;

/** 纯区间（无 id）：push 扫掠时的位移结果表用。 */
interface Range {
  start: number;
  end: number;
}

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

function overlaps(a: Span, b: Span): boolean {
  return a.start < b.end - EPS && a.end > b.start + EPS;
}

/* ----------------------------------------------------------------- 落位 */

/**
 * 把一个**候选几何**的片段落进 lane（lane 里那一个同 id 的旧几何会被换掉，
 * 允许 lane 处于「已重叠」的实时预览脏状态）。策略拒绝落点时返回 null。
 */
export function placeSpan<C extends Span>(
  lane: C[],
  clip: C,
  duration: number,
  behavior: OverlapBehavior,
): C[] | null {
  const others = lane.filter((c) => c.id !== clip.id);
  switch (behavior) {
    case 'reject':
      return others.some((o) => overlaps(o, clip)) ? null : sortSpans([...others, clip]);
    case 'push':
      return pushRight(others, clip, duration);
    case 'trim':
      return trimAround(others, clip);
  }
}

/**
 * push：被候选片段压到的邻居整体右移（长度不变），级联向右传播。
 * 候选片段是锚点，任何情况下都不被推走。顶出工程末尾时返回 null
 * （调用方按「拒绝落点」处理）。
 */
function pushRight<C extends Span>(others: C[], clip: C, duration: number): C[] | null {
  let boundary = clip.end;
  const moved = new Map<string, Range>();
  for (const o of sortSpans(others)) {
    if (o.end <= clip.start + EPS) continue; // 完全在锚点左侧，不受影响
    if (o.start >= boundary - EPS) {
      boundary = Math.max(boundary, o.end);
      continue;
    }
    const shift = boundary - o.start;
    moved.set(o.id, { start: boundary, end: o.end + shift });
    boundary = o.end + shift;
  }
  if (boundary > duration + EPS) return null;
  return sortSpans(others.map((c) => applyMove(c, moved)).concat(clip));
}

/** push 的左向镜像：拖左边时被压到的左侧邻居整体左移，级联向左。 */
function pushLeft<C extends Span>(others: C[], clip: C): C[] | null {
  let boundary = clip.start;
  const moved = new Map<string, Range>();
  const rightToLeft = sortSpans(others).reverse();
  for (const o of rightToLeft) {
    if (o.start >= clip.end - EPS) continue; // 完全在锚点右侧，不受影响
    if (o.end <= boundary + EPS) {
      boundary = Math.min(boundary, o.start);
      continue;
    }
    const shift = o.end - boundary;
    const next = { start: o.start - shift, end: boundary };
    moved.set(o.id, next);
    boundary = next.start;
  }
  if (boundary < -EPS) return null;
  return sortSpans(others.map((c) => applyMove(c, moved)).concat(clip));
}

function applyMove<C extends Span>(c: C, moved: Map<string, Range>): C {
  const m = moved.get(c.id);
  return m ? ({ ...c, start: m.start, end: m.end } as C) : c;
}

/** trim：被候选片段压到的邻居裁掉重叠部分，剩余不足 MIN_CLIP_LENGTH 就丢弃。 */
function trimAround<C extends Span>(others: C[], clip: C): C[] {
  const out: C[] = [];
  for (const o of others) {
    if (!overlaps(o, clip)) {
      out.push(o);
      continue;
    }
    const keepLeft = o.start < clip.start - EPS && clip.start - o.start >= MIN_CLIP_LENGTH;
    const keepRight = o.end > clip.end + EPS && o.end - clip.end >= MIN_CLIP_LENGTH;
    if (keepLeft && keepRight) {
      // 从中间被吃掉：左段保留原 id，右段裂出新片段（store 负责换真 id）
      out.push({ ...o, end: clip.start });
      out.push({ ...o, id: `${o.id}#r`, start: clip.end });
    } else if (keepLeft) {
      out.push({ ...o, end: clip.start });
    } else if (keepRight) {
      out.push({ ...o, start: clip.end });
    }
    // 两段都立不住（完全被盖住）：丢弃
  }
  out.push(clip);
  return sortSpans(out);
}

/* ----------------------------------------------------------------- 移动 */

/**
 * 把 id 片段滑到 newStart（保持长度），按 behavior 解决重叠。
 * duration 是工程总长（片段不许越界）。
 *
 * 落点被拒绝时返回**入参数组本身**——调用方靠这个引用判等识别「整次不动」。
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
  const start = Math.max(0, Math.min(newStart, duration - len));
  return placeSpan(clips, { ...clip, start, end: start + len }, duration, behavior) ?? clips;
}

/* ----------------------------------------------------------------- 缩放 */

/**
 * 拖片段的一条边。三种策略：
 *   reject  钳到邻居边界（单边钳制非破坏性，实时生效）
 *   push    把被压到的邻居往同方向顺移，级联顶到工程两端时退回钳制
 *   trim    吃掉被压到的邻居
 *
 * 与 move 的差别：有一条「锚定边」不动，扫掠时被拖片段自身绝不被推走。
 */
export function resizeSpan<C extends Span>(
  clips: C[],
  id: string,
  edge: 'start' | 'end',
  time: number,
  duration: number,
  behavior: OverlapBehavior = 'reject',
): C[] {
  const clip = clips.find((c) => c.id === id);
  if (!clip) return clips;
  const cand = clampResize(clip, edge, time, duration);
  if (behavior === 'reject') return clampAgainstNeighbors(clips, clip, edge, time, duration);
  const others = clips.filter((c) => c.id !== id);
  if (behavior === 'trim') return trimAround(others, cand);
  const pushed = edge === 'end' ? pushRight(others, cand, duration) : pushLeft(others, cand);
  return pushed ?? clampAgainstNeighbors(clips, clip, edge, time, duration);
}

/** 单边缩放不受邻居影响的部分：不许越 0 / duration，也不许短于 MIN_CLIP_LENGTH。 */
function clampResize<C extends Span>(
  clip: C,
  edge: 'start' | 'end',
  time: number,
  duration: number,
): C {
  if (edge === 'start') {
    return { ...clip, start: Math.max(0, Math.min(time, clip.end - MIN_CLIP_LENGTH)) };
  }
  return { ...clip, end: Math.max(Math.min(time, duration), clip.start + MIN_CLIP_LENGTH) };
}

/**
 * 钳到邻居边界（reject 语义，也是 push/trim 顶到边界的退路）。
 *
 * 判「谁在左边」用的是**被拖片段不动的另一条边**，不是被拖的那条：
 * 实时预览期间被拖的边可能已经压在邻居身上了，用动过的边做判据会把
 * 已经重叠的邻居认成「不在这一侧」，于是钳不住。
 *   edge=start → end 不动，凡 start < end 的都在它的左半边
 *   edge=end   → start 不动，凡 end > start 的都在它的右半边
 */
function clampAgainstNeighbors<C extends Span>(
  clips: C[],
  clip: C,
  edge: 'start' | 'end',
  time: number,
  duration: number,
): C[] {
  const others = clips.filter((c) => c.id !== clip.id);
  if (edge === 'start') {
    let lower = 0;
    for (const o of others) if (o.start < clip.end - EPS) lower = Math.max(lower, o.end);
    return replaceSpan(clips, {
      ...clip,
      start: Math.min(Math.max(time, lower), clip.end - MIN_CLIP_LENGTH),
    });
  }
  let upper = duration;
  for (const o of others) if (o.end > clip.start + EPS) upper = Math.min(upper, o.start);
  return replaceSpan(clips, {
    ...clip,
    end: Math.max(Math.min(time, upper), clip.start + MIN_CLIP_LENGTH),
  });
}

/**
 * 实时预览用的合法性判定：这个候选落点会不会被策略拒绝。
 * 只对 reject 有意义（push/trim 总能把落点解决掉），drag.ts 拿它决定
 * 是否给被拖片段加「不可落」样式。
 */
export function placeAccepted<C extends Span>(
  lane: C[],
  clip: C,
  duration: number,
  behavior: OverlapBehavior,
): boolean {
  return placeSpan(lane, clip, duration, behavior) !== null;
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
    if (s[i]!.start < s[i - 1]!.end - EPS) return true;
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

/**
 * animation-insert.ts — 把一段「待插入」的动画轨道并进元素已有的动画里（纯函数）。
 *
 * 为什么不是「按 (prop, target) 替换」（旧行为）：那会把用户在播放头之前排好的
 * 关键帧整条删掉。为什么也不是「同一属性再挂一条动画」：同一元素的同一层里两条
 * 动画动同一个属性会互相覆盖（`transform` 只有最后一条生效），跨层则是矩阵相乘
 * —— 两种语义都不可预期，见 `src/typography/AGENTS.md`。
 *
 * 所以「再加一个动画」= **往同一条轨道里接一段关键帧**，插入点由调用方（播放头）
 * 给出：
 *
 *  - 新动画的关键帧整体平移到 `at`（`t` 是绝对秒，相对片段起点）；
 *  - 插入点之前的帧一帧不动；之后的帧整体右移「新动画的时长」（插入语义：
 *    不删、不覆盖，只把它们往后推）；
 *  - 插入点与前一帧的值不同时，给前一帧补一个 `steps(1, end)` 出向缓动，让旧值
 *    **保持到插入点、到点才换**。不补的话浏览器会把这段空隙按线性插值补成一次
 *    渐变 —— 表现是「加了个淡入，元素先自己慢慢淡出一下」。用户显式设过缓动的
 *    那一帧不动：那就是他想要的曲线。
 *
 * 一条轨道一个属性（`animation-tracks.ts` 的模型约定），所以「插入一条动画」
 * 对每个属性各算一次，互不影响。本模块不碰 DOM、不读时钟。
 */

import { animTargetOf, type ElementAnimation } from './animation';
import {
  applyTrackTiming,
  normalizeKeys,
  sampleKeys,
  type TracksAnimation,
} from './animation-tracks';

/** 同一时刻的判定容差（与 `normalizeKeys` 的去重阈值同源）。 */
const EPS = 1e-6;
/** 平移后与既有帧撞在同一刻时的让位量（秒）。1ms 在成片上看不出来。 */
const NUDGE = 1e-3;

export interface InsertResult {
  /** 合并后的动画条目（命中的轨道**换了引用**，模板才会更新）。 */
  animations: ElementAnimation[];
  /** 被写入的轨道 id：新建的是新 id，合并的是原轨道 id。 */
  trackIds: string[];
  /** 实际插入点（秒，相对片段起点）。 */
  at: number;
}

/** 一组待插入轨道的时长（取最长的那条，0 = 全是单帧）。 */
export function insertionSpan(incoming: readonly TracksAnimation[]): number {
  let span = 0;
  for (const a of incoming) {
    const keys = normalizeKeys(a.keys);
    if (keys.length < 2) continue;
    span = Math.max(span, keys[keys.length - 1]!.t - keys[0]!.t);
  }
  return span;
}

/**
 * 插入：`animations` 原样不动（返回新数组），`incoming` 的每个属性轨道
 * 在 `atSec` 处接一段关键帧。
 *
 * 传入的 `incoming` 一般来自 `presetToTracks(createPresetAnimation(id))` ——
 * 关键帧从 0 起算，这里按「第一条帧落到 `at`」平移，所以调用方不必先改 delay。
 */
export function insertAnimationsAt(
  animations: readonly ElementAnimation[],
  incoming: readonly TracksAnimation[],
  atSec: number,
): InsertResult {
  const at = Math.max(0, atSec);
  const span = insertionSpan(incoming);
  const out: ElementAnimation[] = [...animations];
  const trackIds: string[] = [];

  for (const inc of incoming) {
    const incKeys = normalizeKeys(inc.keys);
    if (incKeys.length === 0) continue;
    const start = incKeys[0]!.t;
    const keys = incKeys.map((k) => ({ ...k, t: at + (k.t - start) }));

    const idx = out.findIndex(
      (a) =>
        a.kind === 'tracks' &&
        a.prop === inc.prop &&
        animTargetOf(a) === animTargetOf(inc),
    );

    if (idx < 0) {
      const fresh = applyTrackTiming<TracksAnimation>({ ...inc, keys });
      out.push(fresh);
      trackIds.push(fresh.id);
      continue;
    }

    const hit = out[idx] as TracksAnimation;
    const keep = hit.keys.filter((k) => k.t < at - EPS).map((k) => ({ ...k }));
    const held = keep.length ? sampleKeys(hit.keys, at) : null;
    const prev = keep[keep.length - 1];
    if (prev && held !== null && prev.ease == null && String(held) !== String(keys[0]!.v)) {
      prev.ease = { steps: 1, jump: 'end' };
    }

    /*
     * 右移的既有帧：严格单调，且不许压到新动画的末帧上 —— `normalizeKeys`
     * 同刻只留一个（后者胜出），压上去丢的会是**新动画的末帧**，那条动画的
     * 落点值就没了（比如淡入的最后不是 1）。
     */
    let floor = keys[keys.length - 1]!.t;
    const pushed = hit.keys
      .filter((k) => k.t >= at - EPS)
      .map((k) => ({ ...k }))
      .sort((a, b) => a.t - b.t)
      .map((k) => {
        const t = k.t + span;
        const next = t > floor + EPS ? t : floor + NUDGE;
        floor = next;
        return { ...k, t: next };
      });

    const merged = applyTrackTiming<TracksAnimation>({
      ...hit,
      keys: [...keep, ...keys, ...pushed],
    });
    out[idx] = merged;
    trackIds.push(merged.id);
  }

  return { animations: out, trackIds, at };
}

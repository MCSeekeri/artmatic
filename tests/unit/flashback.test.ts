import { describe, expect, it } from 'vitest';
import {
  FLASHBACK_ID,
  recallFrameOf,
  recallTimeOf,
  recallWindowOf,
  type RecallWindow,
} from '../../src/algos/flashback';
import { getGenerator } from '../../src/algos/registry';

/**
 * 闪回（`recall` 型）的**纯函数层**：回放窗口与时间映射。
 *
 * 这里钉住的四条，任何一条坏了都是静默的画面错误：
 *  1. 默认 = 「片段之前的一切」；
 *  2. 窗口**永远不越过片段头** —— 这不只是语义，它同时是递归良基的前提
 *     （越过就会指回自己，渲染栈无限展开）；
 *  3. 速度由几何推出（进度 0 → 窗口末端，进度 1 → 窗口开头）；
 *  4. 越界求值（转场会把片段求到它 start 之前）夹到端点。
 */

const CLIP = { start: 12, end: 15 };

function at(t: number, win: RecallWindow): number {
  return recallTimeOf(CLIP.start, CLIP.end, win, t);
}

describe('闪回：回放窗口', () => {
  it('出厂默认 = 片段之前的一切', () => {
    expect(recallWindowOf(CLIP.start, {})).toEqual({ from: 0, to: 12 });
    expect(recallWindowOf(CLIP.start, undefined)).toEqual({ from: 0, to: 12 });
    // 缺键与写了 0 同义（0 是「一直到头」的哨兵）
    expect(recallWindowOf(CLIP.start, { back: 0, gap: 0 })).toEqual({ from: 0, to: 12 });
  });

  it('回溯长度限定窗口起点', () => {
    expect(recallWindowOf(CLIP.start, { back: 5 })).toEqual({ from: 7, to: 12 });
  });

  it('间隔把窗口末端往前推（不改变起点语义）', () => {
    expect(recallWindowOf(CLIP.start, { gap: 2 })).toEqual({ from: 0, to: 10 });
    expect(recallWindowOf(CLIP.start, { back: 4, gap: 2 })).toEqual({ from: 6, to: 10 });
  });

  it('回溯超过过去的长度时夹到时间轴开头', () => {
    expect(recallWindowOf(CLIP.start, { back: 9999 })).toEqual({ from: 0, to: 12 });
  });

  it('片段头在时间轴 0 处 → 没有过去可放', () => {
    expect(recallWindowOf(0, {})).toBeNull();
    // 间隔把末端也推到 0 时同样是空窗口
    expect(recallWindowOf(3, { gap: 9 })).toBeNull();
  });

  it('窗口末端永远不越过片段头（手改坏的参数也一样）', () => {
    // `??` 兜不住的负数 / NaN 都可能出现在手改过的 project.json 里
    for (const params of [{ gap: -5 }, { gap: Number.NaN }, { back: -3 }, { back: 4, gap: -1 }]) {
      const win = recallWindowOf(CLIP.start, params as Record<string, number>);
      expect(win, JSON.stringify(params)).not.toBeNull();
      expect(win!.to, JSON.stringify(params)).toBeLessThanOrEqual(CLIP.start);
      expect(win!.from, JSON.stringify(params)).toBeGreaterThanOrEqual(0);
      expect(win!.from, JSON.stringify(params)).toBeLessThan(win!.to);
    }
  });
});

describe('闪回：时间映射', () => {
  const win: RecallWindow = { from: 4, to: 12 };

  it('进度 0 取窗口末端（最近的那一帧），进度 1 取窗口开头', () => {
    expect(at(CLIP.start, win)).toBeCloseTo(12, 9);
    expect(at(CLIP.end, win)).toBeCloseTo(4, 9);
    // 中点：片段 3 秒、窗口 8 秒 ⇒ 中点回放到窗口正中
    expect(at(CLIP.start + 1.5, win)).toBeCloseTo(8, 9);
  });

  it('速度由几何推出：窗口越长，同样的进度跨得越远', () => {
    const slow = at(CLIP.start + 1, win) - at(CLIP.start, win);
    const fast = at(CLIP.start + 1, { from: 0, to: 12 }) - at(CLIP.start, { from: 0, to: 12 });
    expect(fast).toBeCloseTo(slow * 1.5, 9);
  });

  it('越界求值夹到端点（转场会把片段求到它 start 之前 / end 之后）', () => {
    expect(at(CLIP.start - 5, win)).toBeCloseTo(12, 9);
    expect(at(CLIP.end + 5, win)).toBeCloseTo(4, 9);
  });

  it('零长片段不产生 NaN', () => {
    const v = recallTimeOf(5, 5, win, 5);
    expect(Number.isFinite(v)).toBe(true);
    expect(v).toBeCloseTo(12, 9);
  });

  it('帧号量化：整帧落点、不为负、fps 退化时也不炸', () => {
    expect(recallFrameOf(12, 30)).toBe(360);
    expect(recallFrameOf(1 / 60, 30)).toBe(1);
    expect(recallFrameOf(-3, 30)).toBe(0);
    // fps 退化（0 / NaN）时按 1 fps 兜底，而不是算出 NaN / Infinity
    expect(recallFrameOf(2, 0)).toBe(2);
    expect(recallFrameOf(2, Number.NaN)).toBe(2);
  });
});

describe('闪回：接线', () => {
  it('注册表里有它，而且是唯一的 recall 型', () => {
    const def = getGenerator(FLASHBACK_ID);
    expect(def?.kind).toBe('recall');
    expect(def?.params.map((p) => p.key)).toEqual(['back', 'gap']);
    // 出厂默认必须是「片段之前的一切」——两个 0（见 recallWindowOf 的哨兵）
    expect(def?.params.map((p) => p.defaultValue)).toEqual([0, 0]);
  });
});

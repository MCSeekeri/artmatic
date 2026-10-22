import { describe, expect, it } from 'vitest';
import {
  ADJACENT_EPS,
  MIN_TRANSITION_DURATION,
  clampTransitionDuration,
  resolveTransition,
  transitionAt,
  transitionCut,
  transitionMaxDuration,
} from '../../src/core/transitions';
import type { SourceClip, VisualTrack } from '../../src/core/schema';

/**
 * core/transitions.ts 的窗口解析。
 *
 * 这个文件是纯几何，**所有钳制规则都在这里**，所以测试必须把边界全钉死：
 * 渲染侧（stack/compositor）与 UI 都不许再算一遍，一旦这里的规则松了，
 * 「两个相邻转场的窗口重叠」这种 bug 只会表现成画面偶尔花一下。
 */

let seq = 0;

function sourceClip(start: number, end: number, opts: Partial<SourceClip> = {}): SourceClip {
  seq += 1;
  return {
    kind: 'source',
    id: `c${seq}`,
    start,
    end,
    label: `c${seq}`,
    fadeSec: 0,
    curves: {},
    source: { type: 'solid', color: '#000000' },
    blend: 'normal',
    opacity: 1,
    transform: { x: 0.5, y: 0.5, sx: 1, sy: 1, rot: 0 },
    fit: 'stretch',
    ...opts,
  };
}

function effectClip(start: number, end: number): VisualTrack['clips'][number] {
  seq += 1;
  return {
    kind: 'effect',
    id: `e${seq}`,
    start,
    end,
    label: `e${seq}`,
    fadeSec: 0,
    curves: {},
    chain: [],
  };
}

function track(clips: VisualTrack['clips']): VisualTrack {
  return { kind: 'visual', id: 't', name: 't', enabled: true, clips };
}

/** 出画转场的简写：`tr(1)` = duration 1。 */
function tr(duration: number) {
  return { defId: 'fade', duration, values: {} };
}

describe('transitionCut：剪切点几何', () => {
  it('紧邻的两个 source 片段 → ok，上限 = 2×min(两者长度)', () => {
    const t = track([sourceClip(0, 4, { transitionOut: tr(1) }), sourceClip(4, 8)]);
    const cut = transitionCut(t, 0);
    expect(cut.ok).toBe(true);
    if (!cut.ok) return;
    expect(cut.max).toBe(8); // 两侧各 4s
    expect(cut.to!.id).toBe(t.clips[1]!.id);
  });

  it('上限由较短的一侧决定（from 只有 1s → max 2）', () => {
    const t = track([sourceClip(0, 1, { transitionOut: tr(1) }), sourceClip(1, 5)]);
    expect(transitionMaxDuration(t, 0)).toBe(2);
  });

  it('留缝 → 另一侧为 null（透明），转场仍然成立', () => {
    const t = track([sourceClip(0, 4, { transitionOut: tr(1) }), sourceClip(4.5, 8)]);
    const cut = transitionCut(t, 0);
    expect(cut.ok).toBe(true);
    if (!cut.ok) return;
    expect(cut.to).toBeNull();
    // 只有左侧有内容 → 上限由本片段自身长度决定（窗口另一半落在缝里）。
    expect(cut.max).toBe(8);
    expect(resolveTransition(t, 0)?.duration).toBe(1);
  });

  it('容差内的浮点误差仍算相邻', () => {
    const t = track([sourceClip(0, 4, { transitionOut: tr(1) }), sourceClip(4 + ADJACENT_EPS / 2, 8)]);
    expect(transitionCut(t, 0).ok).toBe(true);
  });

  it('末片段 / 下一个是特效片段 → to = null（v13 零片段转场）', () => {
    const last = track([sourceClip(0, 4, { transitionOut: tr(1) })]);
    const lastCut = transitionCut(last, 0);
    expect(lastCut.ok).toBe(true);
    if (lastCut.ok) expect(lastCut.to).toBeNull();

    const withEffect = track([sourceClip(0, 4, { transitionOut: tr(1) }), effectClip(4, 8)]);
    const fxCut = transitionCut(withEffect, 0);
    expect(fxCut.ok).toBe(true);
    if (fxCut.ok) expect(fxCut.to).toBeNull();
  });

  it('没设转场 → 几何上仍可放（控制平面靠它判断首次设置），解析结果是 null', () => {
    const t = track([sourceClip(0, 4), sourceClip(4, 8)]);
    expect(transitionCut(t, 0).ok).toBe(true);
    expect(resolveTransition(t, 0)).toBeNull();
  });

  it('上一个转场占掉的右半会挤短本转场的左半', () => {
    // 三段：a[0,4] 转场 d=2 → b[4,8] 转场 ? → c[8,12]
    // b 的左侧只剩 4 - 1 = 3；右侧 c 无转场 → 4
    const t = track([
      sourceClip(0, 4, { transitionOut: tr(2) }),
      sourceClip(4, 8, { transitionOut: tr(1) }),
      sourceClip(8, 12),
    ]);
    expect(transitionMaxDuration(t, 1)).toBe(3 * 2);
  });

  it('下一个片段自己的出画转场也会挤短本转场的右半', () => {
    // b[4,8] 自己带 d=2 的出画转场 → 其左半可用 = 4 - 1 = 3
    const t = track([
      sourceClip(0, 4, { transitionOut: tr(1) }),
      sourceClip(4, 8, { transitionOut: tr(2) }),
      sourceClip(8, 12),
    ]);
    expect(transitionMaxDuration(t, 0)).toBe(6);
  });

  it('两侧都太短 → too-short（上限不是正数）', () => {
    const t = track([sourceClip(0, 0.01, { transitionOut: tr(1) }), sourceClip(0.01, 0.02)]);
    // 上一个/下一个都没有转场，所以还撑得住；这里用「负可用量」的构造：
    const t2 = track([
      sourceClip(0, 1, { transitionOut: tr(2) }),
      sourceClip(1, 2, { transitionOut: tr(0.5) }),
      sourceClip(2, 3),
    ]);
    // b 的左半被 a 的 2s 占掉 1s → left = 1 - 1 = 0
    expect(transitionMaxDuration(t2, 1)).toBe(0);
    expect(transitionCut(t2, 1)).toEqual({ ok: false, reason: 'too-short' });
    expect(t.clips.length).toBe(2);
  });
});

describe('resolveTransition：钳制', () => {
  it('requested 超过上限时生效值被钳到 max，且原始值保留在 requested', () => {
    const t = track([sourceClip(0, 1, { transitionOut: tr(10) }), sourceClip(1, 5)]);
    const r = resolveTransition(t, 0);
    expect(r).not.toBeNull();
    expect(r!.requested).toBe(10);
    expect(r!.duration).toBe(2);
  });

  it('没有 transitionOut → null', () => {
    const t = track([sourceClip(0, 4), sourceClip(4, 8)]);
    expect(resolveTransition(t, 0)).toBeNull();
  });

  it('下标越界 / 非 source 片段 → null（不许抛）', () => {
    const t = track([sourceClip(0, 4, { transitionOut: tr(1) }), sourceClip(4, 8)]);
    expect(resolveTransition(t, 5)).toBeNull();
    const fx = track([effectClip(0, 4), sourceClip(4, 8)]);
    expect(resolveTransition(fx, 0)).toBeNull();
  });
});

describe('transitionAt：窗口与进度（半开）', () => {
  // from[0,2] + to[2,4]，d=1 → 窗口 [1.5, 2.5)
  const t = track([sourceClip(0, 2, { transitionOut: tr(1) }), sourceClip(2, 4)]);

  it('窗口内命中，progress 线性', () => {
    const w0 = transitionAt(t, 0, 'out', 1.5)!;
    expect(w0.start).toBeCloseTo(1.5, 9);
    expect(w0.end).toBeCloseTo(2.5, 9);
    expect(w0.progress).toBeCloseTo(0, 9);

    expect(transitionAt(t, 0, 'out', 2)!.progress).toBeCloseTo(0.5, 9);
    expect(transitionAt(t, 0, 'out', 2.4999)!.progress).toBeGreaterThan(0.99);
  });

  it('半开区间：t = end 不命中，t = start 命中（端点归属不重叠）', () => {
    expect(transitionAt(t, 0, 'out', 2.5)).toBeNull();
    expect(transitionAt(t, 0, 'out', 1.5)).not.toBeNull();
  });

  it('窗口外 → null', () => {
    expect(transitionAt(t, 0, 'out', 1.4999)).toBeNull();
    expect(transitionAt(t, 0, 'out', 3)).toBeNull();
  });

  it('from 在窗口后半段已出界，但窗口依然命中（这是 stack 必须早点判的原因）', () => {
    // t = 2.2 > from.end(2)，若先做 span 过滤就会漏掉整个右半窗口
    const w = transitionAt(t, 0, 'out', 2.2);
    expect(w).not.toBeNull();
    expect(w!.progress).toBeCloseTo(0.7, 9);
  });

  it('首片段的窗口不越过 t = 0（左半受片段自身长度钳制）', () => {
    const head = track([sourceClip(0, 1, { transitionOut: tr(2) }), sourceClip(1, 3)]);
    const w = transitionAt(head, 0, 'out', 0)!;
    expect(w.start).toBe(0);
    expect(w.progress).toBe(0);
  });

  it('窗口完全落在 [from.start, to.end] 内 —— 于是不可能命中第三个片段', () => {
    const three = track([
      sourceClip(0, 3, { transitionOut: tr(2) }),
      sourceClip(3, 6),
      sourceClip(6, 9),
    ]);
    // 从窗口起点到终点的每一步都只应命中 from/to 两个片段（同轨不重叠）
    for (let x = 1.0001; x < 3.9999; x += 0.1) {
      const w = transitionAt(three, 0, 'out', x);
      if (!w) continue;
      expect(w.start).toBeGreaterThanOrEqual(w.from!.start);
      expect(w.end).toBeLessThanOrEqual(w.to!.end);
      expect(three.clips.some((c) => c.start > w.start && c.start < w.end && c !== w.to && c !== w.from)).toBe(false);
    }
  });
});

describe('clampTransitionDuration：唯一钳制入口', () => {
  it('正常钳到上限', () => {
    expect(clampTransitionDuration(3, 2)).toBe(2);
    expect(clampTransitionDuration(1, 2)).toBe(1);
  });

  it('max <= 0（落不了地）时只保底、不求上限 —— 拖开再拖回来不该毁数据', () => {
    expect(clampTransitionDuration(1.5, 0)).toBe(1.5);
  });

  it('低于下限 / 非法值都抬到下限', () => {
    expect(clampTransitionDuration(0, 2)).toBe(MIN_TRANSITION_DURATION);
    expect(clampTransitionDuration(Number.NaN, 2)).toBe(MIN_TRANSITION_DURATION);
  });
});

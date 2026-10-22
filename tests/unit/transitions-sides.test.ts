import { describe, expect, it } from 'vitest';
import {
  isTransitionInShadowed,
  resolveTransition,
  transitionAt,
  transitionCut,
  transitionMaxDuration,
} from '../../src/core/transitions';
import type { SourceClip, VisualTrack } from '../../src/core/schema';

/**
 * 双侧转场（v13）：入场 / 出场，以及「另一侧没有片段 = 全透明」。
 *
 * 与 `transitions.test.ts` 的分工：那边守出画的窗口几何与钳制；这里守**两端**
 * 的边界规则（遮蔽、透明侧、同一片段两端的半窗不重叠）。
 */

let seq = 0;

function clip(start: number, end: number, over: Partial<SourceClip> = {}): SourceClip {
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
    ...over,
  };
}

function track(clips: VisualTrack['clips']): VisualTrack {
  return { kind: 'visual', id: 't', name: 't', enabled: true, clips };
}

const tr = (duration: number) => ({ defId: 'fade', duration, values: {} });

describe('入场转场：窗口以 clip.start 为中心', () => {
  it('有紧邻前片段：from = 前一个片段，窗口前半段吃掉它的尾巴', () => {
    const a = clip(0, 2);
    const b = clip(2, 4, { transitionIn: tr(1) });
    const t = track([a, b]);
    const r = resolveTransition(t, 1, 'in')!;
    expect(r.from?.id).toBe(a.id);
    expect(r.to?.id).toBe(b.id);
    const w = transitionAt(t, 1, 'in', 2)!;
    expect(w.start).toBeCloseTo(1.5, 9);
    expect(w.end).toBeCloseTo(2.5, 9);
    expect(w.progress).toBeCloseTo(0.5, 9);
  });

  it('前面没有片段：from = null（全透明），仍然可以设', () => {
    const b = clip(2, 4, { transitionIn: tr(1) });
    const t = track([b]);
    const cut = transitionCut(t, 0, 'in');
    expect(cut.ok).toBe(true);
    if (!cut.ok) return;
    expect(cut.from).toBeNull();
    // 窗口左半落在 0 之前，所以上限受 cut = 2s 钳制：2 × min(2, 2) = 4。
    expect(cut.max).toBe(4);
    expect(resolveTransition(t, 0, 'in')?.from).toBeNull();
  });

  it('t = 0 的入场：窗口放不下左半 → too-short（而不是静默不生效）', () => {
    const b = clip(0, 2, { transitionIn: tr(1) });
    const t = track([b]);
    expect(transitionCut(t, 0, 'in')).toEqual({ ok: false, reason: 'too-short' });
  });

  it('与前一片段留缝：from = null（缝里是空的）', () => {
    const t = track([clip(0, 2), clip(2.5, 4, { transitionIn: tr(1) })]);
    const cut = transitionCut(t, 1, 'in');
    expect(cut.ok).toBe(true);
    if (cut.ok) expect(cut.from).toBeNull();
  });
});

describe('出场转场：另一侧没有片段 = 透明', () => {
  it('末片段：to = null，上限由自身长度决定', () => {
    const a = clip(0, 2, { transitionOut: tr(1) });
    const t = track([a]);
    const cut = transitionCut(t, 0, 'out');
    expect(cut.ok).toBe(true);
    if (!cut.ok) return;
    expect(cut.to).toBeNull();
    expect(cut.max).toBe(4);
  });
});

describe('同一边界：出场优先，入场被遮蔽', () => {
  it('前一段有出场 → 本段入场 shadowed', () => {
    const a = clip(0, 2, { transitionOut: tr(1) });
    const b = clip(2, 4, { transitionIn: tr(1) });
    const t = track([a, b]);
    expect(isTransitionInShadowed(t, 1)).toBe(true);
    expect(transitionCut(t, 1, 'in')).toEqual({ ok: false, reason: 'shadowed' });
    expect(resolveTransition(t, 1, 'in')).toBeNull();
    // 出场本身照常
    expect(resolveTransition(t, 0, 'out')).not.toBeNull();
  });

  it('前一段的出场本身放不下 → 不报遮蔽（几何上两边都太短）', () => {
    // a 只有 0.1s，却被一个 2s 的入场吃掉头部 → a 的出场 left 为负（too-short）。
    const lead = clip(0, 1);
    const a = clip(1, 1.1, { transitionIn: tr(2), transitionOut: tr(2) });
    const b = clip(1.1, 3, { transitionIn: tr(0.2) });
    const t = track([lead, a, b]);
    expect(transitionCut(t, 1, 'out')).toEqual({ ok: false, reason: 'too-short' });
    expect(isTransitionInShadowed(t, 2)).toBe(false);
    // 同一段几何既是 a 出场的左半、也是 b 入场的左半 —— 所以两者一起放不下，
    // 但原因必须是 too-short（可解释），不是 shadowed（会让人以为换个转场就能解）。
    expect(transitionCut(t, 2, 'in')).toEqual({ ok: false, reason: 'too-short' });
  });
});

describe('同一片段两端：半窗不重叠', () => {
  it('出去场半窗 + 入场半窗 ≤ 片段长度', () => {
    // clip[2,4]（长 2）同时带 in d=1 与 out d=1：半窗各 0.5，合计 1 ≤ 2 —— 可以。
    const a = clip(0, 2);
    const b = clip(2, 4, { transitionIn: tr(1), transitionOut: tr(1) });
    const c = clip(4, 6);
    const t = track([a, b, c]);
    expect(resolveTransition(t, 1, 'in')!.duration).toBe(1);
    expect(resolveTransition(t, 1, 'out')!.duration).toBe(1);

    // 两端各要 1.5s（半窗 0.75，合计 1.5）仍然可以；各要 3s（半窗 1.5，合计 3 > 2）就会被钳。
    b.transitionIn = tr(3);
    b.transitionOut = tr(3);
    const inMax = transitionMaxDuration(t, 1, 'in');
    const outMax = transitionMaxDuration(t, 1, 'out');
    expect(inMax).toBeLessThan(3);
    expect(outMax).toBeLessThan(3);
    expect(resolveTransition(t, 1, 'in')!.duration).toBeLessThan(3);
  });

  it('相邻两个转场的窗口不重叠（短片段上的三方挤压）', () => {
    // a[0,4] out d=2 的右半占 b 的整个头；b 只有 1s，自己的出场就放不下了。
    const a = clip(0, 4, { transitionOut: tr(2) });
    const b = clip(4, 5, { transitionOut: tr(0.1) });
    const c = clip(5, 9);
    const t = track([a, b, c]);
    expect(resolveTransition(t, 0, 'out')).not.toBeNull();
    expect(transitionCut(t, 1, 'out')).toEqual({ ok: false, reason: 'too-short' });
  });
});

describe('transitionCut 不要求转场已存在（控制平面首次设置要用）', () => {
  it('没设转场的相邻边界仍然返回 ok', () => {
    const t = track([clip(0, 2), clip(2, 4)]);
    expect(transitionCut(t, 0, 'out').ok).toBe(true);
    expect(transitionCut(t, 1, 'in').ok).toBe(true);
    // 但解析（真正生效）必须是 null
    expect(resolveTransition(t, 0, 'out')).toBeNull();
    expect(resolveTransition(t, 1, 'in')).toBeNull();
  });
});

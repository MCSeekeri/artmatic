import { describe, expect, it } from 'vitest';
import { insertAnimationsAt, insertionSpan } from '../../src/typography/animation-insert';
import { presetToTracks } from '../../src/typography/animation-migrate';
import { createPresetAnimation, createTracksAnimation } from '../../src/typography/animation';
import type { TracksAnimation, TrackKey } from '../../src/typography/animation-tracks';

/** 预设 → 轨道（关键帧从 0 起算，和编辑器 Ribbon 走的是同一条路）。 */
function preset(id: Parameters<typeof createPresetAnimation>[0], key = 'a'): TracksAnimation[] {
  return presetToTracks(createPresetAnimation(id, key), { dropAnimations: [], dropProps: [] });
}

const opacityTrack = (keys: TrackKey[], id = 't1'): TracksAnimation =>
  createTracksAnimation(id, 'opacity', keys);

describe('insertionSpan', () => {
  it('取最长的那条轨道', () => {
    const tracks = [
      createTracksAnimation('x', 'opacity', [
        { t: 0, v: 0 },
        { t: 0.5, v: 1 },
      ]),
      createTracksAnimation('y', 'x', [
        { t: 1, v: 0 },
        { t: 2, v: 40 },
      ]),
    ];
    expect(insertionSpan(tracks)).toBeCloseTo(1, 6);
  });

  it('单帧轨道跨度为 0', () => {
    expect(insertionSpan([opacityTrack([{ t: 2, v: 1 }])])).toBe(0);
  });
});

describe('insertAnimationsAt', () => {
  it('没有同属性轨道时新建一条，关键帧整体平移到插入点', () => {
    const res = insertAnimationsAt([], preset('fade-in'), 2);
    expect(res.animations).toHaveLength(1);
    expect(res.trackIds).toEqual([res.animations[0]!.id]);

    const a = res.animations[0] as TracksAnimation;
    expect(a.prop).toBe('opacity');
    expect(a.keys.map((k) => k.t)).toEqual([2, 2.6]);
    expect(a.delay).toBeCloseTo(2, 6);
    expect(a.duration).toBeCloseTo(0.6, 6);
  });

  it('播放头在既有轨道之后时**追加**，既有帧一帧不少', () => {
    const base = [opacityTrack([{ t: 0, v: 0 }, { t: 0.6, v: 1 }])];
    const res = insertAnimationsAt(base, preset('fade-out'), 2);

    expect(res.animations).toHaveLength(1);
    const keys = (res.animations[0] as TracksAnimation).keys;
    expect(keys.map((k) => k.t)).toEqual([0, 0.6, 2, 2.6]);
    expect(keys.map((k) => k.v)).toEqual([0, 1, 1, 0]);
  });

  it('插入点处的值与被接上的新帧不同时，前一帧补 steps 保持（不凭空淡出）', () => {
    // 既有：0 → 1（淡入完成）。插一段「淡入」（从 0 起）到 2s。
    const base = [opacityTrack([{ t: 0, v: 0 }, { t: 0.6, v: 1 }])];
    const res = insertAnimationsAt(base, preset('fade-in'), 2);
    const keys = (res.animations[0] as TracksAnimation).keys;

    // 0.6s 那帧的值是 1，而 2s 处的新帧是 0 —— 不保持的话 0.6→2 会插值出一次淡出。
    expect(keys[1]!.ease).toEqual({ steps: 1, jump: 'end' });
  });

  it('插入点两侧的值本来就相等时不改既有缓动', () => {
    // 既有：1 → 0（淡出完成）。新插一段从 0 起的淡入，衔接处两边都是 0。
    const base = [opacityTrack([{ t: 0, v: 1 }, { t: 0.6, v: 0 }])];
    const res = insertAnimationsAt(base, preset('fade-in'), 2);
    const keys = (res.animations[0] as TracksAnimation).keys;
    expect(keys[1]!.ease).toBeUndefined();
  });

  it('用户显式设过缓动的帧不动（那是他想要的曲线）', () => {
    const base = [
      opacityTrack([
        { t: 0, v: 0, ease: [0.1, 0.2, 0.3, 0.4] },
        { t: 0.6, v: 1, ease: [0.4, 0.3, 0.2, 0.1] },
      ]),
    ];
    const res = insertAnimationsAt(base, preset('fade-in'), 2);
    const keys = (res.animations[0] as TracksAnimation).keys;
    expect(keys[1]!.ease).toEqual([0.4, 0.3, 0.2, 0.1]);
  });

  it('插入点落在既有动画中间时把后半段整体右移，一帧不丢', () => {
    const base = [opacityTrack([{ t: 0, v: 0 }, { t: 3, v: 1 }])];
    const res = insertAnimationsAt(base, preset('fade-out'), 1);
    const keys = (res.animations[0] as TracksAnimation).keys;

    // 0（原样）、1/1.6（新动画，0.6s）、3.6（原来的 3s 帧右移 0.6）
    expect(keys.map((k) => k.t)).toEqual([0, 1, 1.6, 3.6]);
    expect(keys.map((k) => k.v)).toEqual([0, 1, 0, 1]);
  });

  it('既有帧正好落在插入点上时右移，不与新动画的末帧重合', () => {
    const base = [opacityTrack([{ t: 0, v: 0 }, { t: 1, v: 1 }, { t: 2, v: 0.5 }])];
    const res = insertAnimationsAt(base, preset('fade-out'), 1);
    const keys = (res.animations[0] as TracksAnimation).keys;
    const times = keys.map((k) => k.t);

    // 严格单调，且新动画的末帧（1.6）一定在
    for (let i = 1; i < times.length; i++) expect(times[i]!).toBeGreaterThan(times[i - 1]!);
    expect(times).toContain(1.6);
    expect(times).toContain(2.6);
  });

  it('不修改入参（返回新数组、命中轨道换引用）', () => {
    const base = [opacityTrack([{ t: 0, v: 0 }, { t: 0.6, v: 1 }])];
    const before = JSON.stringify(base);
    const res = insertAnimationsAt(base, preset('fade-out'), 2);

    expect(JSON.stringify(base)).toBe(before);
    expect(res.animations[0]).not.toBe(base[0]);
  });

  it('不同属性各算一次，互不影响', () => {
    const base = [opacityTrack([{ t: 0, v: 0 }, { t: 0.6, v: 1 }])];
    const res = insertAnimationsAt(base, preset('slide-in-left'), 2);

    // slide-in-left = x + opacity ⇒ 既有 opacity 被接上，x 新建
    expect(res.animations).toHaveLength(2);
    const props = res.animations.map((a) => (a as TracksAnimation).prop).sort();
    expect(props).toEqual(['opacity', 'x']);
  });

  it('插入点使用绝对秒（片段内偏移由调用方算好）', () => {
    const res = insertAnimationsAt([], preset('fade-in'), 0);
    expect((res.animations[0] as TracksAnimation).keys.map((k) => k.t)).toEqual([0, 0.6]);
    expect(res.at).toBe(0);
  });

  it('负的插入点夹到 0', () => {
    const res = insertAnimationsAt([], preset('fade-in'), -5);
    expect(res.at).toBe(0);
    expect((res.animations[0] as TracksAnimation).keys[0]!.t).toBe(0);
  });

  it('旧形态（preset / custom）原样留在数组里，不参与合并', () => {
    const legacy = createPresetAnimation('fade-in', 'legacy');
    const res = insertAnimationsAt([legacy], preset('fade-in'), 1);
    expect(res.animations[0]).toBe(legacy);
    expect(res.animations).toHaveLength(2);
    expect((res.animations[1] as TracksAnimation).keys[0]!.t).toBe(1);
  });
});

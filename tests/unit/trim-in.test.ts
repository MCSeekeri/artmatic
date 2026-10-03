import { describe, expect, it } from 'vitest';
import {
  applyTrimIn,
  earliestTrimStart,
  setTrimIn,
  trimInOf,
  withTrimIn,
} from '../../src/core/clips';
import { ProjectStore } from '../../src/core/project-store';
import {
  defaultProject,
  newId,
  type AudioClip,
  type Project,
  type SourceClip,
  type VisualTrack,
} from '../../src/core/schema';

/**
 * trim-in 语义：拖片段**左边界**要同时改长度与源内偏移。
 *
 * 用户点名的那个交互缺陷：原来拖开头只改 start（长度变了），`srcIn` 纹丝不动，
 * 于是「向右裁掉 1 秒」之后听到的仍然是第 0 秒开始的声音 —— 画面/声音与
 * 片段位置对不上。剪辑软件的一致语义是：
 *
 *   拖中部 = 整体平移（srcIn 不变）
 *   拖左边界 = 改长度 **并且** srcIn 跟着走（裁掉的头部不再播放）
 *
 * 顺带修掉同族的一个现存 bug：`splitClipAt` 不给右半段补 srcIn，
 * 切开之后后半段会从头重放。
 */

function audioClip(start: number, end: number, srcIn = 0): AudioClip {
  return {
    kind: 'audio',
    id: newId(),
    start,
    end,
    label: 'a',
    fadeSec: 0,
    curves: {},
    assetId: 'asset-a',
    srcIn,
  };
}

function videoClip(start: number, end: number, srcIn = 0, speed = 1): SourceClip {
  return {
    kind: 'source',
    id: newId(),
    start,
    end,
    label: 'v',
    fadeSec: 0,
    curves: {},
    source: { type: 'video', assetId: 'asset-v', srcIn, speed },
    blend: 'normal',
    opacity: 1,
    transform: { x: 0.5, y: 0.5, sx: 1, sy: 1, rot: 0 },
    fit: 'cover',
  };
}

function solidClip(start: number, end: number): SourceClip {
  return {
    ...videoClip(start, end),
    source: { type: 'solid', color: '#000000' },
  };
}

function projectWith(clips: (AudioClip | SourceClip)[], kind: 'audio' | 'visual' = 'audio'): Project {
  const p = defaultProject('测试');
  p.duration = 60;
  const track =
    kind === 'audio'
      ? { kind: 'audio' as const, id: 'a1', name: 'A1', enabled: true, bus: 'master' as const, clips: clips as AudioClip[] }
      : { kind: 'visual' as const, id: 'v1', name: 'V1', enabled: true, clips: clips as SourceClip[] };
  p.tracks.push(track as VisualTrack | (typeof p.tracks)[number]);
  return p;
}

/* ---------------------------------------------------------------- 纯函数 */

describe('trimInOf / withTrimIn / setTrimIn', () => {
  it('音频与视频有源内偏移，纯色/算法/排版没有', () => {
    expect(trimInOf(audioClip(0, 4, 1.5))).toEqual({ srcIn: 1.5, speed: 1 });
    expect(trimInOf(videoClip(0, 4, 0.25, 2))).toEqual({ srcIn: 0.25, speed: 2 });
    expect(trimInOf(solidClip(0, 4))).toBeNull();
  });

  it('speed 非正时按 1 处理（防除零）', () => {
    expect(trimInOf(videoClip(0, 4, 0, 0))).toEqual({ srcIn: 0, speed: 1 });
  });

  it('withTrimIn 返回新对象且不改原对象；视频连 source 一起换引用', () => {
    const v = videoClip(0, 4, 1);
    const next = withTrimIn(v, 3);
    expect(v.source).toMatchObject({ srcIn: 1 });
    expect(next.source).toMatchObject({ srcIn: 3 });
    expect(next).not.toBe(v);
  });

  it('setTrimIn 原地写（拖拽期的实时变更走这条）', () => {
    const a = audioClip(0, 4, 1);
    setTrimIn(a, 2.5);
    expect(a.srcIn).toBe(2.5);
    const v = videoClip(0, 4, 1);
    setTrimIn(v, 2.5);
    expect(v.source).toMatchObject({ srcIn: 2.5 });
  });

  it('对没有源内偏移的片段是 no-op（不许凭空长出一个 srcIn）', () => {
    const s = solidClip(0, 4);
    const next = withTrimIn(s, 9);
    expect(next).not.toHaveProperty('srcIn');
    setTrimIn(s, 9);
    expect(s).not.toHaveProperty('srcIn');
  });
});

describe('earliestTrimStart', () => {
  it('已消耗的 srcIn 就是左边界能回退的距离', () => {
    expect(earliestTrimStart(audioClip(5, 9, 1.2))).toBeCloseTo(3.8, 9);
  });

  it('srcIn = 0 时不能往左扩（素材头部没有内容）', () => {
    expect(earliestTrimStart(audioClip(5, 9, 0))).toBe(5);
  });

  it('视频按 speed 折算：2 倍速的 srcIn 只能换回一半时长', () => {
    expect(earliestTrimStart(videoClip(10, 14, 1, 2))).toBeCloseTo(9.5, 9);
  });

  it('没有源内偏移的片段回到 0（回到「不许越过时间轴起点」的老规则）', () => {
    expect(earliestTrimStart(solidClip(3, 7))).toBe(0);
  });
});

describe('applyTrimIn：三种情况分开', () => {
  it('整体平移（push 挤开邻居）不动 srcIn', () => {
    const before = [audioClip(2, 6, 1)];
    const after = [{ ...before[0]!, start: 3, end: 7 }];
    expect(applyTrimIn(before, after)[0]!.srcIn).toBe(1);
  });

  it('头部被吃掉（终点不动）→ srcIn 跟着进', () => {
    const before = [audioClip(2, 6, 1)];
    const after = [{ ...before[0]!, start: 3 }];
    expect(applyTrimIn(before, after)[0]!.srcIn).toBe(2);
  });

  it('头部被拉长（往左）→ srcIn 跟着退', () => {
    const before = [audioClip(3, 6, 2)];
    const after = [{ ...before[0]!, start: 2 }];
    expect(applyTrimIn(before, after)[0]!.srcIn).toBe(1);
  });

  it('不会产生负的 srcIn（下界由调用方钳，这里是兜底）', () => {
    const before = [audioClip(2, 6, 1)];
    const after = [{ ...before[0]!, start: 0 }];
    expect(applyTrimIn(before, after)[0]!.srcIn).toBe(0);
  });

  it('新片段与起点没动的片段原样返回', () => {
    const before = [audioClip(2, 6, 1)];
    const fresh = audioClip(8, 9, 0);
    expect(applyTrimIn(before, [before[0]!, fresh])[1]).toBe(fresh);
  });

  it('视频按 speed 折算', () => {
    const before = [videoClip(2, 6, 1, 2)];
    const after = [{ ...before[0]!, start: 3 } as SourceClip];
    expect((applyTrimIn(before, after)[0] as SourceClip).source).toMatchObject({ srcIn: 3 });
  });
});

/* ---------------------------------------------------------------- 落库 */

describe('ProjectStore：拖左边界 = 改长度 + 改 srcIn', () => {
  it('音频向右裁 1s：start +1、end 不变、srcIn +1', () => {
    const clip = audioClip(2, 6, 0);
    const store = new ProjectStore(projectWith([clip]));
    store.liveResizeClip('a1', clip.id, 'start', 3);
    const got = store.findClip(clip.id)!.clip as AudioClip;
    expect(got.start).toBeCloseTo(3, 9);
    expect(got.end).toBeCloseTo(6, 9);
    expect(got.srcIn).toBeCloseTo(1, 9);
  });

  it('往回拖能还原（可逆）—— 拖回 2s 时 srcIn 归零', () => {
    const clip = audioClip(2, 6, 0);
    const store = new ProjectStore(projectWith([clip]));
    store.liveResizeClip('a1', clip.id, 'start', 3.5);
    store.liveResizeClip('a1', clip.id, 'start', 2);
    const got = store.findClip(clip.id)!.clip as AudioClip;
    expect(got.start).toBeCloseTo(2, 9);
    expect(got.srcIn).toBeCloseTo(0, 9);
  });

  it('拖动是增量式的：多次小步挪动累积正确', () => {
    const clip = audioClip(0, 10, 0);
    const store = new ProjectStore(projectWith([clip]));
    for (let t = 0.1; t <= 2.0001; t += 0.1) store.liveResizeClip('a1', clip.id, 'start', t);
    const got = store.findClip(clip.id)!.clip as AudioClip;
    expect(got.start).toBeCloseTo(2, 6);
    expect(got.srcIn).toBeCloseTo(2, 6);
  });

  it('左边界不能越过素材头部：srcIn 到 0 就停住', () => {
    const clip = audioClip(5, 9, 1);
    const store = new ProjectStore(projectWith([clip]));
    // 想拖到 0（比下界 4 早），应停在 4
    store.liveResizeClip('a1', clip.id, 'start', 0);
    const got = store.findClip(clip.id)!.clip as AudioClip;
    expect(got.start).toBeCloseTo(4, 9);
    expect(got.srcIn).toBeCloseTo(0, 9);
    expect(got.end).toBeCloseTo(9, 9);
  });

  it('视频按 speed 折算（2× 时裁 1s 时间轴 = 素材 2s）', () => {
    const clip = videoClip(0, 4, 0, 2);
    const store = new ProjectStore(projectWith([clip], 'visual'));
    store.liveResizeClip('v1', clip.id, 'start', 1);
    const got = store.findClip(clip.id)!.clip as SourceClip;
    expect(got.source).toMatchObject({ srcIn: 2 });
  });

  it('拖右边界不动 srcIn（终点只影响长度）', () => {
    const clip = audioClip(2, 6, 1);
    const store = new ProjectStore(projectWith([clip]));
    store.liveResizeClip('a1', clip.id, 'end', 5);
    const got = store.findClip(clip.id)!.clip as AudioClip;
    expect(got.end).toBeCloseTo(5, 9);
    expect(got.srcIn).toBeCloseTo(1, 9);
  });

  it('settleResize 把松手的原始时间再钳一次下界（否则几何与内容会脱节）', () => {
    const clip = audioClip(5, 9, 1);
    const store = new ProjectStore(projectWith([clip]));
    // 松手报了一个比下界(4)更靠左的位置
    expect(store.settleResize('a1', clip.id, 'start', 0)).toBe(true);
    const got = store.findClip(clip.id)!.clip as AudioClip;
    expect(got.start).toBeCloseTo(4, 9);
    expect(got.srcIn).toBeGreaterThanOrEqual(0);
    // 关键：几何与 srcIn 必须自洽 —— start 回到 4 就该是 srcIn = 0
    expect(got.srcIn).toBeCloseTo(0, 9);
  });

  it('trim 策略吃掉邻居**头部**时，邻居的 srcIn 跟着进', () => {
    // A[0,5] + B[5,10]，把 A 的右边界拖到 7 → B 的 [5,7] 被吃掉
    const a = audioClip(0, 5, 0);
    const b = audioClip(5, 10, 0);
    const p = projectWith([a, b]);
    p.overlapBehavior = 'trim';
    const store = new ProjectStore(p);
    expect(store.settleResize('a1', a.id, 'end', 7)).toBe(true);

    const gotA = store.findClip(a.id)!.clip as AudioClip;
    const gotB = store.findClip(b.id)!.clip as AudioClip;
    expect(gotA.end).toBeCloseTo(7, 9);
    expect(gotB.start).toBeCloseTo(7, 9);
    expect(gotB.end).toBeCloseTo(10, 9);
    // 关键：B 的起点右移 2s、终点没动 → 它的头被吃掉了 → srcIn 必须 +2。
    // 不补的话 B 会从原来的第 0 秒重放，与它现在的位置对不上。
    expect(gotB.srcIn).toBeCloseTo(2, 9);
    // A 自己只是变长（起点没动），srcIn 不变
    expect(gotA.srcIn).toBeCloseTo(0, 9);
  });

  it('往左拉长片段时 srcIn 跟着退（且受素材头部限制）', () => {
    // B 已经消耗了 2s，所以它最多能往左长回 2s（start 5 → 3）
    const a = audioClip(0, 5, 0);
    const b = audioClip(5, 10, 2);
    const p = projectWith([a, b]);
    p.overlapBehavior = 'trim';
    const store = new ProjectStore(p);
    expect(store.settleResize('a1', b.id, 'start', 3)).toBe(true);

    const gotA = store.findClip(a.id)!.clip as AudioClip;
    const gotB = store.findClip(b.id)!.clip as AudioClip;
    expect(gotB.start).toBeCloseTo(3, 9);
    expect(gotB.srcIn).toBeCloseTo(0, 9);
    // A 的尾巴被吃掉，起点没动 → 不是 trim-in，srcIn 不变
    expect(gotA.end).toBeCloseTo(3, 9);
    expect(gotA.srcIn).toBeCloseTo(0, 9);
  });
});

describe('ProjectStore：切分要给右半段补 srcIn（现存 bug）', () => {
  it('音频从中间切开，右半段的 srcIn 前进 atRel', () => {
    const clip = audioClip(0, 10, 2);
    const store = new ProjectStore(projectWith([clip]));
    expect(store.splitClipAt('a1', clip.id, 4)).toBe(true);
    const clips = (store.track('a1')!.clips as AudioClip[]).sort((x, y) => x.start - y.start);
    expect(clips).toHaveLength(2);
    expect(clips[0]!.srcIn).toBeCloseTo(2, 9);
    expect(clips[1]!.start).toBeCloseTo(4, 9);
    // 关键：不是 2（继承原值），而是 2 + 4 = 6
    expect(clips[1]!.srcIn).toBeCloseTo(6, 9);
  });

  it('视频切分同理（并按 speed 折算）', () => {
    const clip = videoClip(0, 10, 1, 2);
    const store = new ProjectStore(projectWith([clip], 'visual'));
    expect(store.splitClipAt('v1', clip.id, 3)).toBe(true);
    const clips = (store.track('v1')!.clips as SourceClip[]).sort((x, y) => x.start - y.start);
    expect(clips[1]!.source).toMatchObject({ srcIn: 1 + 3 * 2 });
  });

  it('没有源内偏移的片段切分不产生多余字段', () => {
    const clip = solidClip(0, 10);
    const store = new ProjectStore(projectWith([clip], 'visual'));
    expect(store.splitClipAt('v1', clip.id, 4)).toBe(true);
    const clips = (store.track('v1')!.clips as SourceClip[]).sort((x, y) => x.start - y.start);
    expect(clips[1]!.source.type).toBe('solid');
  });
});

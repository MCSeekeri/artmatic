import { describe, expect, it } from 'vitest';
import { rippleShift } from '../../src/core/ripple';
import { ProjectStore } from '../../src/core/project-store';
import {
  defaultProject,
  type AudioClip,
  type EffectClip,
  type Project,
  type SourceClip,
} from '../../src/core/schema';

/**
 * 波纹删除的守卫：
 *  - 纯几何（`rippleShift`）：贴边、包含、零点几段的边界；
 *  - store 行为：只动被删片段所在的那几条轨、保留原有空隙、与删除同一笔撤销。
 *
 * 这两层分开测是刻意的：几何错了会让所有轨道一起错位，而 store 接线错了只影响
 * 「某个入口点删除时没补位」—— 后者在真实剪辑里几乎看不出来，直到卡点全错。
 */

/* ------------------------------------------------------------------ 几何 */

describe('rippleShift', () => {
  it('没有删除就一点也不动', () => {
    expect(rippleShift(5, [])).toBe(0);
  });

  it('被删区间之后的片段前移「被删长度」', () => {
    expect(rippleShift(10, [{ start: 2, end: 5 }])).toBe(3);
  });

  it('贴边也算「之后」（否则删除会在相邻两段之间留下等长空洞）', () => {
    expect(rippleShift(5, [{ start: 2, end: 5 }])).toBe(3);
  });

  it('被删区间之前的片段不动', () => {
    expect(rippleShift(1, [{ start: 2, end: 5 }])).toBe(0);
  });

  it('起点落在被删区间内部时不动（同轨不应出现，但别把它拖走）', () => {
    expect(rippleShift(3, [{ start: 2, end: 5 }])).toBe(0);
  });

  it('多段删除按累积长度扣，顺序无关', () => {
    const spans = [{ start: 2, end: 4 }, { start: 6, end: 10 }];
    expect(rippleShift(12, spans)).toBe(6);
    expect(rippleShift(12, [...spans].reverse())).toBe(6);
    // 只有第一段在它之前
    expect(rippleShift(5, spans)).toBe(2);
  });

  it('零长 / 负长区间被忽略（脏数据不该把轨道整体左移）', () => {
    expect(rippleShift(10, [{ start: 3, end: 3 }, { start: 4, end: 2 }])).toBe(0);
  });
});

/* ------------------------------------------------------------------ store */

function projectWith(...kinds: ('visual' | 'audio')[]): Project {
  const p = defaultProject('t');
  p.tracks = kinds.map((kind, i) =>
    kind === 'visual'
      ? { kind, id: `v${i}`, name: `V${i}`, enabled: true, clips: [] }
      : { kind, id: `a${i}`, name: `A${i}`, enabled: true, clips: [], bus: 'master' },
  );
  return p;
}

/** 一条最简片段（不引用素材，几何就是全部要测的东西）。 */
function span(id: string, start: number, end: number): EffectClip {
  return {
    kind: 'effect',
    id,
    start,
    end,
    label: id,
    fadeSec: 0,
    curves: {},
    chain: [],
    affectDepth: 1,
  };
}

function starts(store: ProjectStore, trackId: string): number[] {
  return store.track(trackId)!.clips.map((c) => Number(c.start.toFixed(6)));
}

describe('ProjectStore.removeClips({ ripple })', () => {
  it('删除后同轨后面的片段前移，原有空隙保留', () => {
    const store = new ProjectStore(projectWith('visual'));
    store.addClip('v0', span('a', 0, 1));
    store.addClip('v0', span('b', 1, 2));
    store.addClip('v0', span('c', 3, 4));

    store.removeClips(['b'], { ripple: true });

    // a 不动；c 前移 1 秒（b 的长度），原本 2→3 的空隙仍在
    expect(starts(store, 'v0')).toEqual([0, 2]);
  });

  it('关掉波纹时只删不挪（默认行为）', () => {
    const store = new ProjectStore(projectWith('visual'));
    store.addClip('v0', span('a', 0, 1));
    store.addClip('v0', span('b', 1, 2));
    store.addClip('v0', span('c', 3, 4));

    store.removeClips(['b']);

    expect(starts(store, 'v0')).toEqual([0, 3]);
  });

  it('只动被删片段所在的那条轨，别的轨一个像素都不动', () => {
    const store = new ProjectStore(projectWith('visual', 'visual'));
    store.addClip('v0', span('a', 0, 1));
    store.addClip('v0', span('b', 1, 2));
    store.addClip('v1', span('other', 5, 6));

    store.removeClips(['b'], { ripple: true });

    expect(starts(store, 'v0')).toEqual([0]);
    expect(starts(store, 'v1')).toEqual([5]);
  });

  it('视频与它分离出来的音频各补各的位（两条轨都前移，同步不破）', () => {
    const store = new ProjectStore(projectWith('visual', 'audio'));
    const video: SourceClip = {
      kind: 'source',
      id: 'v',
      start: 0,
      end: 2,
      label: 'v',
      fadeSec: 0,
      curves: {},
      blend: 'normal',
      opacity: 1,
      transform: { x: 0.5, y: 0.5, sx: 1, sy: 1, rot: 0 },
      source: { type: 'video', assetId: 'x', srcIn: 0, speed: 1 },
      fit: 'cover',
      linkedAudioId: 'snd',
    };
    const audio: AudioClip = {
      kind: 'audio',
      id: 'snd',
      start: 0,
      end: 2,
      label: 'snd',
      fadeSec: 0,
      curves: {},
      assetId: 'x',
      srcIn: 0,
      lockedTo: 'v',
    };
    store.addClip('v0', video);
    store.addClip('a1', audio);
    // 后面各有一段：删除 video 时音频被连带删掉，两条轨都要前移 2 秒
    store.addClip('v0', span('after-v', 5, 6));
    store.addClip('a1', span('after-a', 5, 6));

    store.removeClips(['v'], { ripple: true });

    expect(starts(store, 'v0')).toEqual([3]);
    expect(starts(store, 'a1')).toEqual([3]);
  });

  it('删除 + 补位是同一笔撤销（撤销一次就全回来）', () => {
    const store = new ProjectStore(projectWith('visual'));
    store.addClip('v0', span('a', 0, 1));
    store.addClip('v0', span('b', 1, 2));
    store.addClip('v0', span('c', 3, 4));
    const before = starts(store, 'v0');

    store.removeClips(['b'], { ripple: true });
    expect(starts(store, 'v0')).toEqual([0, 2]);

    expect(store.undo()).toBe(true);
    expect(starts(store, 'v0')).toEqual(before);
  });
});

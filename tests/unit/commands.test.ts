import { describe, expect, it } from 'vitest';
import { CommandStack } from '../../src/core/commands';
import { ProjectStore } from '../../src/core/project-store';
import { defaultProject, newId, type SourceClip } from '../../src/core/schema';
import { evalCurve } from '../../src/core/curve';

function makeStack() {
  let state = { n: 0 };
  const changes: string[] = [];
  const stack = new CommandStack(
    () => JSON.stringify(state),
    (json) => {
      state = JSON.parse(json);
    },
    (label) => changes.push(label),
  );
  return { stack, get: () => state, changes };
}

describe('CommandStack', () => {
  it('commit 入栈，undo/redo 往返一致', () => {
    const { stack, get } = makeStack();
    stack.commit('加一', () => { get; });
    // 无变化 commit 不入栈
    expect(stack.canUndo()).toBe(false);
    stack.commit('加一', () => { /* noop */ });
    expect(stack.canUndo()).toBe(false);
  });

  it('真改动可撤销可重做', () => {
    let state = { n: 0 };
    const stack = new CommandStack(
      () => JSON.stringify(state),
      (j) => { state = JSON.parse(j); },
      () => {},
    );
    stack.commit('n=1', () => { state.n = 1; });
    stack.commit('n=2', () => { state.n = 2; });
    expect(state.n).toBe(2);
    stack.undo();
    expect(state.n).toBe(1);
    stack.undo();
    expect(state.n).toBe(0);
    expect(stack.canUndo()).toBe(false);
    stack.redo();
    expect(state.n).toBe(1);
    stack.redo();
    expect(state.n).toBe(2);
  });

  it('手势事务 coalesce 成一条', () => {
    let state = { x: 0 };
    const stack = new CommandStack(
      () => JSON.stringify(state),
      (j) => { state = JSON.parse(j); },
      () => {},
    );
    stack.beginTx();
    for (let i = 1; i <= 50; i++) state.x = i;
    stack.endTx('拖拽');
    expect(state.x).toBe(50);
    stack.undo();
    expect(state.x).toBe(0);
    expect(stack.canUndo()).toBe(false);
  });

  it('cancelTx 回滚手势', () => {
    let state = { x: 0 };
    const stack = new CommandStack(
      () => JSON.stringify(state),
      (j) => { state = JSON.parse(j); },
      () => {},
    );
    stack.beginTx();
    state.x = 42;
    stack.cancelTx();
    expect(state.x).toBe(0);
    expect(stack.canUndo()).toBe(false);
  });

  /*
   * 事务内 `commit` 只通知、不入栈 —— agent 的「一轮对话 = 一笔撤销」依赖它。
   * 修之前：两次 commit 会留下 3 条记录（两次中间态 + 事务快照），撤到第二次
   * 就落在一个用户从没见过的中间态上。
   */
  it('事务内多次 commit 只产生一条撤销记录', () => {
    let state = { x: 0, y: 0 };
    const changes: string[] = [];
    const stack = new CommandStack(
      () => JSON.stringify(state),
      (j) => { state = JSON.parse(j); },
      (label) => changes.push(label),
    );
    stack.beginTx();
    stack.commit('x=1', () => { state.x = 1; });
    stack.commit('y=2', () => { state.y = 2; });
    expect(stack.endTx('一轮')).toBe(true);
    expect(state).toEqual({ x: 1, y: 2 });

    // 事务内每次 commit 仍然通知界面（版本/重绘），所以有两条中间通知。
    expect(changes).toEqual(['x=1', 'y=2', '一轮']);

    stack.undo();
    // 一次撤销直接回到事务之前 —— 不是 { x: 1, y: 0 }。
    expect(state).toEqual({ x: 0, y: 0 });
    expect(stack.canUndo()).toBe(false);

    stack.redo();
    expect(state).toEqual({ x: 1, y: 2 });
  });

  it('事务内无变化时 endTx 不入栈，也不丢已有记录', () => {
    let state = { x: 0 };
    const stack = new CommandStack(
      () => JSON.stringify(state),
      (j) => { state = JSON.parse(j); },
      () => {},
    );
    stack.commit('x=1', () => { state.x = 1; });
    stack.beginTx();
    stack.commit('noop', () => {});
    expect(stack.endTx('空事务')).toBe(false);
    stack.undo();
    expect(state.x).toBe(0);
  });
});

/* ---------------------------------------------------------- store 层 */

function solidClip(start: number, end: number, color = '#ff0000'): SourceClip {
  return {
    kind: 'source',
    id: newId(),
    start,
    end,
    label: color,
    fadeSec: 0,
    curves: {},
    source: { type: 'solid', color },
    blend: 'normal',
    opacity: 1,
    transform: { x: 0.5, y: 0.5, sx: 1, sy: 1, rot: 0 },
    fit: 'contain',
  };
}

describe('ProjectStore 片段操作', () => {
  it('建轨 / 加片段 / 移动（默认 reject）/ 撤销', () => {
    const store = new ProjectStore(defaultProject('t'));
    const v = store.addTrack('visual');
    const a = solidClip(0, 2, '#111111');
    const b = solidClip(3, 5, '#222222');
    store.addClip(v, a);
    store.addClip(v, b);
    expect(store.track(v)!.clips).toHaveLength(2);

    store.commit('移动', () => store.settlePlacement(v, a.id, 2.5));
    const aAfter = store.track(v)!.clips.find((c) => c.id === a.id)!;
    expect(aAfter.start).toBe(0); // reject：落点撞上 b，整次不动

    store.undo();
    expect(store.track(v)!.clips.find((c) => c.id === a.id)!.start).toBe(0);
  });

  it('trim 策略下移动会吃掉邻居', () => {
    const store = new ProjectStore(defaultProject('t'));
    store.setOverlapBehavior('trim');
    const v = store.addTrack('visual');
    const a = solidClip(0, 2);
    const b = solidClip(3, 5);
    store.addClip(v, a);
    store.addClip(v, b);
    store.commit('移动', () => store.settlePlacement(v, a.id, 2.5));
    const bAfter = store.track(v)!.clips.find((c) => c.id === b.id)!;
    expect([bAfter.start, bAfter.end]).toEqual([4.5, 5]);
  });

  it('切分片段：几何与曲线都被切开', () => {
    const store = new ProjectStore(defaultProject('t'));
    const v = store.addTrack('visual');
    const clip = solidClip(0, 4);
    clip.curves['opacity'] = {
      keys: [
        { t: 0, v: 0, interp: 'linear' },
        { t: 4, v: 1, interp: 'linear' },
      ],
    };
    store.addClip(v, clip);
    expect(store.splitClipAt(v, clip.id, 1)).toBe(true);

    const clips = store.track(v)!.clips as SourceClip[];
    expect(clips).toHaveLength(2);
    const [left, right] = clips;
    expect([left!.start, left!.end]).toEqual([0, 1]);
    expect([right!.start, right!.end]).toEqual([1, 4]);

    // 左半曲线保留 t<=1 的 keys；右半曲线 0 处的值 = 原曲线在切点的值 0.25
    const lc = left!.curves['opacity']!;
    const rc = right!.curves['opacity']!;
    expect(lc.keys.map((k) => k.t)).toEqual([0]);
    expect(evalCurve(rc, 0, {})).toBeCloseTo(0.25);
    // 右半末尾（t=3，即原来的 t=4）仍然是 1
    expect(evalCurve(rc, 3, {})).toBeCloseTo(1);

    store.undo();
    expect(store.track(v)!.clips).toHaveLength(1);
  });

  it('beatAnchor 曲线切分时两半各自原样复制', () => {
    const store = new ProjectStore(defaultProject('t'));
    const v = store.addTrack('visual');
    const clip = solidClip(0, 4);
    clip.curves['opacity'] = {
      keys: [{ t: 0, v: 1, interp: 'step' }],
      beatAnchor: { beat: 4 },
    };
    store.addClip(v, clip);
    store.splitClipAt(v, clip.id, 2);
    const clips = store.track(v)!.clips as SourceClip[];
    expect(clips[0]!.curves['opacity']!.beatAnchor).toEqual({ beat: 4 });
    expect(clips[1]!.curves['opacity']!.beatAnchor).toEqual({ beat: 4 });
  });

  it('离边太近的切分返回 false 且不进撤销栈', () => {
    const store = new ProjectStore(defaultProject('t'));
    const v = store.addTrack('visual');
    store.addClip(v, solidClip(0, 2));
    const before = store.version;
    expect(store.splitClipAt(v, store.track(v)!.clips[0]!.id, 0.001)).toBe(false);
    expect(store.version).toBe(before);
  });
});

/* ------------------------------------- 手势两段式 / 跨轨 / 时长（2026-09-27） */

describe('实时预览与策略结算分离', () => {
  function seeded(policy: 'reject' | 'push' | 'trim' = 'reject') {
    const store = new ProjectStore(defaultProject('t'));
    store.setOverlapBehavior(policy);
    const v = store.addTrack('visual');
    const a = solidClip(0, 2);
    const b = solidClip(3, 5);
    store.addClip(v, a);
    store.addClip(v, b);
    return { store, v, a, b };
  }

  const at = (store: ProjectStore, id: string) => {
    const f = store.findClip(id)!;
    return [Number(f.clip.start.toFixed(3)), Number(f.clip.end.toFixed(3))];
  };

  it('liveMoveClip 不套策略：拖过去邻居不动，允许重叠', () => {
    const { store, v, a, b } = seeded('trim');
    store.beginTx();
    store.liveMoveClip(v, a.id, 2.5);
    expect(at(store, a.id)).toEqual([2.5, 4.5]);
    expect(at(store, b.id)).toEqual([3, 5]); // 邻居完好
    store.cancelTx();
    expect(at(store, a.id)).toEqual([0, 2]);
  });

  it('settlePlacement 才动邻居：trim 在松手时结算', () => {
    const { store, v, a, b } = seeded('trim');
    store.beginTx();
    store.liveMoveClip(v, a.id, 2.5);
    expect(store.settlePlacement(v, a.id, 2.5)).toBe(true);
    expect(at(store, b.id)).toEqual([4.5, 5]);
    store.endTx('移动片段');
    store.undo();
    expect(at(store, b.id)).toEqual([3, 5]); // 一次手势 = 一条撤销记录
  });

  it('settlePlacement 被 reject 拒绝时返回 false 且不改动任何东西', () => {
    const { store, v, a, b } = seeded('reject');
    store.beginTx();
    store.liveMoveClip(v, a.id, 2.5);
    expect(store.settlePlacement(v, a.id, 2.5)).toBe(false);
    store.cancelTx();
    expect(at(store, a.id)).toEqual([0, 2]);
    expect(at(store, b.id)).toEqual([3, 5]);
  });

  it('placementAccepted 给实时预览提供落点合法性', () => {
    const { store, v, a } = seeded('reject');
    expect(store.placementAccepted(v, a.id, 0.5)).toBe(true);
    expect(store.placementAccepted(v, a.id, 3)).toBe(false); // 压在 b 上
  });

  it('trim 结算裂出右段时换掉 #r 临时 id', () => {
    const store = new ProjectStore(defaultProject('t'));
    store.setOverlapBehavior('trim');
    const v = store.addTrack('visual');
    const c = solidClip(2, 6);
    const a = solidClip(9, 10);
    store.addClip(v, c);
    store.addClip(v, a);
    store.beginTx();
    store.liveMoveClip(v, a.id, 3);
    store.settlePlacement(v, a.id, 3);
    const ids = store.track(v)!.clips.map((x) => x.id);
    expect(ids.some((id) => id.endsWith('#r'))).toBe(false);
    expect(store.track(v)!.clips).toHaveLength(3);
  });
});

describe('跨轨', () => {
  function twoTracks() {
    const store = new ProjectStore(defaultProject('t'));
    const v1 = store.addTrack('visual', 'V1');
    const v2 = store.addTrack('visual', 'V2');
    const clip = solidClip(0, 2);
    store.addClip(v1, clip);
    return { store, v1, v2, clip };
  }

  it('liveMoveClip 跨轨实时搬家', () => {
    const { store, v1, v2, clip } = twoTracks();
    store.liveMoveClip(v2, clip.id, 1);
    expect(store.track(v1)!.clips).toHaveLength(0);
    expect(store.track(v2)!.clips).toHaveLength(1);
    expect(store.findClip(clip.id)!.track.id).toBe(v2);
  });

  it('目标轨不兼容（画面片段进音频轨）时原地不动', () => {
    const { store, v1, clip } = twoTracks();
    const a = store.addTrack('audio');
    store.liveMoveClip(a, clip.id, 0);
    expect(store.findClip(clip.id)!.track.id).toBe(v1);
    expect(store.track(a)!.clips).toHaveLength(0);
    expect(store.canHost(store.track(a)!, clip)).toBe(false);
  });

  it('settlePlacement 跨轨被拒 → 片段留在原轨', () => {
    const { store, v1, v2, clip } = twoTracks();
    store.addClip(v2, solidClip(0, 4));
    expect(store.settlePlacement(v2, clip.id, 0)).toBe(false);
    expect(store.findClip(clip.id)!.track.id).toBe(v1);
    expect(store.track(v2)!.clips).toHaveLength(1);
  });

  it('Alt+↑↓：跳到同类型的相邻轨，被占据则报 blocked', () => {
    const { store, v1, v2, clip } = twoTracks();
    expect(store.shiftClipTrack(clip.id, 1)).toBe('ok');
    expect(store.findClip(clip.id)!.track.id).toBe(v2);
    expect(store.shiftClipTrack(clip.id, 1)).toBe('no-track');
    store.addClip(v1, solidClip(0, 4));
    expect(store.shiftClipTrack(clip.id, -1)).toBe('blocked');
    expect(store.findClip(clip.id)!.track.id).toBe(v2);
  });

  it('Alt+↑↓ 跳过装不下的轨道（音频片段跨过视觉轨）', () => {
    const store = new ProjectStore(defaultProject('t'));
    const a1 = store.addTrack('audio', 'A1');
    store.addTrack('visual', 'V1');
    const a2 = store.addTrack('audio', 'A2');
    const ac = { ...solidClip(0, 2), kind: 'audio' as const, assetId: 'x', srcIn: 0 };
    store.addClip(a1, ac as never);
    expect(store.shiftClipTrack(ac.id, 1)).toBe('ok');
    expect(store.findClip(ac.id)!.track.id).toBe(a2);
  });
});

describe('工程时长', () => {
  it('片段超出时长会被撑长，而不是被截断', () => {
    const store = new ProjectStore(defaultProject('t')); // duration 16
    const a = store.addTrack('audio');
    const clip = { ...solidClip(0, 30), kind: 'audio' as const, assetId: 'x', srcIn: 0 };
    store.addClip(a, clip as never);
    expect(store.project.duration).toBe(30);
    expect(Number(store.track(a)!.clips[0]!.end)).toBe(30);
  });

  it('liveMoveClip 拖出末尾也会撑长', () => {
    const store = new ProjectStore(defaultProject('t'));
    const v = store.addTrack('visual');
    const clip = solidClip(0, 2);
    store.addClip(v, clip);
    store.liveMoveClip(v, clip.id, 20);
    expect(store.project.duration).toBe(22);
  });

  it('setDuration / fitDurationToContent 双向可控', () => {
    const store = new ProjectStore(defaultProject('t'));
    const v = store.addTrack('visual');
    store.addClip(v, solidClip(0, 4));
    store.setDuration(30);
    expect(store.project.duration).toBe(30);
    store.fitDurationToContent();
    expect(store.project.duration).toBe(4);
  });
});

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

    store.commit('移动', () => store.moveClip(v, a.id, 2.5));
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
    store.commit('移动', () => store.moveClip(v, a.id, 2.5));
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

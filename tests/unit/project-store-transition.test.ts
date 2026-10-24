import { describe, expect, it } from 'vitest';
import { ProjectStore } from '../../src/core/project-store';
import { MIN_CLIP_LENGTH } from '../../src/core/clips';
import { defaultProject, newId, type Project, type SourceClip, type VisualTrack } from '../../src/core/schema';

/**
 * 转场的落库路径（ProjectStore 的四个方法）。
 *
 * 与 `transitions.test.ts` 的分工：那边只测纯几何，这边测「几何 → 撤销栈 →
 * 工程 JSON」这一段。两个理由必须在这里而不是只在纯函数里测：
 *   1. `commit` 靠 JSON 快照判「有没有变化」。原地改一个**浅拷贝**出来的对象
 *      会让改动静默丢失（轨道开关踩过这个坑，见 project-store 的注释），
 *      所以「改动真的落库」必须有一次端到端断言。
 *   2. 钳制若只写在 UI 侧，拖拽/撤销回退都会绕过它。
 */

function sourceClip(start: number, end: number, over: Partial<SourceClip> = {}): SourceClip {
  const id = newId();
  return {
    kind: 'source',
    id,
    start,
    end,
    label: id,
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

function projectWith(clips: SourceClip[]): Project {
  const p = defaultProject('测试');
  p.duration = 20;
  const track: VisualTrack = { kind: 'visual', id: 'v1', name: 'V1', enabled: true, clips };
  p.tracks.push(track);
  return p;
}

/** from[0,2] + to[2,4]：紧邻，窗口上限 = 4。 */
function adjacentProject(): { store: ProjectStore; a: SourceClip; b: SourceClip } {
  const a = sourceClip(0, 2);
  const b = sourceClip(2, 4);
  return { store: new ProjectStore(projectWith([a, b])), a, b };
}

function clipOf(store: ProjectStore, id: string): SourceClip {
  const found = store.findClip(id);
  return found!.clip as SourceClip;
}

describe('ProjectStore：转场落库', () => {
  it('setTransitionOut 写进工程，并按上限钳制', () => {
    const { store, a } = adjacentProject();
    store.setTransitionOut(a.id, 'fade', 10, { foo: 1 });
    const t = clipOf(store, a.id).transitionOut!;
    expect(t.defId).toBe('fade');
    expect(t.duration).toBe(4); // 上限 = 2×min(2,2)
    expect(t.values).toEqual({ foo: 1 });
    expect(store.version).toBeGreaterThan(0);
  });

  it('defId 为空串 = 删除', () => {
    const { store, a } = adjacentProject();
    store.setTransitionOut(a.id, 'fade', 1, {});
    expect(clipOf(store, a.id).transitionOut).toBeDefined();
    store.setTransitionOut(a.id, '', 0, {});
    expect(clipOf(store, a.id).transitionOut).toBeUndefined();
  });

  it('删除后工程 JSON 里不再出现 transitionOut（不是留一个 undefined 键）', () => {
    const { store, a } = adjacentProject();
    store.setTransitionOut(a.id, 'fade', 1, {});
    store.clearTransitionOut(a.id);
    expect(store.serialize()).not.toContain('transitionOut');
  });

  it('落不了地（留缝）时 duration 不被钳成 0，原样保留', () => {
    const a = sourceClip(0, 2);
    const b = sourceClip(3, 5); // 有 1s 缝隙
    const store = new ProjectStore(projectWith([a, b]));
    store.setTransitionOut(a.id, 'fade', 1.5, {});
    expect(clipOf(store, a.id).transitionOut!.duration).toBe(1.5);
  });

  it('setTransitionDuration 走同一个钳制入口', () => {
    const { store, a } = adjacentProject();
    store.setTransitionOut(a.id, 'fade', 1, {});
    store.setTransitionDuration(a.id, 99);
    expect(clipOf(store, a.id).transitionOut!.duration).toBe(4);
    store.setTransitionDuration(a.id, 0);
    expect(clipOf(store, a.id).transitionOut!.duration).toBeGreaterThan(0);
  });

  it('updateTransition 改参数', () => {
    const { store, a } = adjacentProject();
    store.setTransitionOut(a.id, 'fade', 1, { foo: 1 });
    store.updateTransition(a.id, '改参数', (t) => {
      t.values.foo = 7;
    });
    expect(clipOf(store, a.id).transitionOut!.values.foo).toBe(7);
  });

  it('撤销能回到「没有转场」，重做能回来', () => {
    const { store, a } = adjacentProject();
    store.setTransitionOut(a.id, 'fade', 1, {});
    expect(clipOf(store, a.id).transitionOut).toBeDefined();

    expect(store.undo()).toBe(true);
    expect(clipOf(store, a.id).transitionOut).toBeUndefined();

    expect(store.redo()).toBe(true);
    expect(clipOf(store, a.id).transitionOut).toBeDefined();
  });

  it('特效片段上没有转场入口（静默 no-op，不写库）', () => {
    const fx = {
      kind: 'effect' as const,
      id: newId(),
      start: 0,
      end: 2,
      label: 'fx',
      fadeSec: 0,
      curves: {},
      chain: [],
    };
    const store = new ProjectStore(projectWith([]));
    (store.project.tracks[0] as VisualTrack).clips.push(fx);
    const v = store.version;
    store.setTransitionOut(fx.id, 'fade', 1, {});
    expect(clipOf(store, fx.id).kind).toBe('effect');
    expect(store.version).toBe(v); // 没 bump = 没写库
  });

  it('片段未知 id → 静默 no-op', () => {
    const { store } = adjacentProject();
    const v = store.version;
    store.setTransitionOut('不存在', 'fade', 1, {});
    expect(store.version).toBe(v);
  });


});

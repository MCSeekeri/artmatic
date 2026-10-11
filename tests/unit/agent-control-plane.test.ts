/**
 * 控制平面的 M1 守卫（方案 §8）：**写进去、能撤销、错误码可判别**。
 *
 * 用得是**真的 `ProjectStore`**（不是替身）：这一层要守的恰恰是「写操作等值」——
 * 每个方法都落到 `ProjectStore` 的既有方法上，撤销栈的完整性是它的直接后果。
 * 拿替身测等于把被测对象换掉。
 *
 * 渲染 / 导出那两条（M2 / M4）在这里测不了：WebGL 与 WebCodecs 在 Node 里不存在，
 * 它们由 `tests/e2e/agent.spec.ts` 守。
 */

import { describe, expect, it } from 'vitest';
import { createControlPlane, type AgentControlPlane } from '../../src/agent/control-plane';
import type { ControlContext, ControlResult } from '../../src/agent/types';
import { ProjectStore } from '../../src/core/project-store';
import { createBlankProject } from '../../src/core/demo-project';
import { SCHEMA_VERSION, type Project } from '../../src/core/schema';

/* --------------------------------------------------------------- 测试台 */

interface Harness {
  store: ProjectStore;
  cp: AgentControlPlane;
  ctx: ControlContext;
}

function harness(project: Project = createBlankProject('agent-test')): Harness {
  const store = new ProjectStore(project);
  const ctx: ControlContext = {
    getStore: () => store,
    // 渲染 / 素材 / 音频在纯 Node 单测里都不存在 —— 这条测试只覆盖读与写。
    getRenderer: () => null,
    getAssets: () => null,
    getPlayT: () => 0,
    setPlayT: () => {},
    getAudioBuffer: () => null,
    listProjects: () => [],
    saveProject: async () => false,
    openProject: async () => false,
    cancelPendingGesture: () => {},
    refreshPreview: () => {},
  };
  return { store, ctx, cp: createControlPlane(ctx) };
}

async function ok<T>(p: Promise<ControlResult<T>>): Promise<T> {
  const r = await p;
  if (!r.ok) throw new Error(`期望成功，实际失败：${r.error.code} / ${r.error.message}`);
  return r.data;
}

async function code<T>(p: Promise<ControlResult<T>>): Promise<string> {
  const r = await p;
  if (r.ok) throw new Error(`期望失败，实际成功：${JSON.stringify(r.data)}`);
  return r.error.code;
}

function visualTrackId(h: Harness): string {
  const t = h.store.project.tracks.find((x) => x.kind === 'visual');
  if (!t) throw new Error('空白工程应当有一条视觉轨');
  return t.id;
}

/* ------------------------------------------------------------ 读接口 */

describe('读接口', () => {
  it('describe 给出握手需要的全部字段', async () => {
    const h = harness();
    const d = await ok(h.cp.describe());
    expect(d.apiVersion).toBe(1);
    // 不写死数字：这里守的是「握手报的是本构建支持的 schema 版本」，
    // 写死的话每次抬版本都要来改这条守卫，而不是它挡住了什么。
    expect(d.schemaVersion).toBe(SCHEMA_VERSION);
    expect(d.fps).toBe(h.store.project.fps);
    expect(d.resolution).toEqual(h.store.project.resolution);
  });

  it('clearThenDescribe：一份工程都没打开时，写操作给 no-project（而不是抛异常）', async () => {
    const h = harness();
    const bare: ControlContext = { ...h.ctx, getStore: () => null };
    const cp = createControlPlane(bare);
    expect(await code(cp.addTrack('visual'))).toBe('no-project');
    // 读接口也必须是同一个口径
    expect(await code(cp.getScene())).toBe('no-project');
    // 但「有没有工程」这类元信息不能因为没工程就报错
    const d = await ok(cp.describe());
    expect(d.fps).toBe(0);
  });

  it('getCapabilities 给出的是合法 id 的**唯一**来源', async () => {
    const h = harness();
    const caps = await ok(h.cp.getCapabilities());
    expect(caps.generators.length).toBeGreaterThan(10);
    expect(caps.effects.map((e) => e.id)).toContain('echo');
    expect(caps.transitions.length).toBeGreaterThan(100);
    expect(caps.blendModes).toContain('normal');
    expect(caps.curveModes).toEqual(['keyframe', 'impulse', 'follower']);
  });

  it('读接口不动 version、不动工程（纯读无副作用）', async () => {
    const h = harness();
    const v0 = h.store.version;
    const before = JSON.stringify(h.store.project);
    await h.cp.getScene();
    await h.cp.getCapabilities();
    await h.cp.undoState();
    await h.cp.exportState();
    expect(h.store.version).toBe(v0);
    expect(JSON.stringify(h.store.project)).toBe(before);
  });
});

/* ------------------------------------------------------------ 写 + 撤销 */

describe('写 → undo 回原状（M1 的核心验收）', () => {
  it('addClip 能被用户 Ctrl+Z 掉', async () => {
    const h = harness();
    const track = visualTrackId(h);
    const before = await ok(h.cp.getScene({ t: 0, detail: 'ids' }));

    const added = await ok(
      h.cp.addClip(track, { kind: 'algo', generator: 'mandelbrot', start: 0, end: 2, id: 'c1' }),
    );
    expect(added.clipId).toBe('c1');
    expect(await ok(h.cp.undoState())).toEqual({ canUndo: true, canRedo: false });

    const during = await ok(h.cp.getScene({ t: 0.5, detail: 'ids' }));
    expect(during.tracks[0]!.clips.map((c) => c.id)).toEqual(['c1']);

    expect(await ok(h.cp.undo())).toEqual({ changed: true });
    const after = await ok(h.cp.getScene({ t: 0, detail: 'ids' }));
    expect(JSON.stringify(after)).toBe(JSON.stringify(before));
  });

  it('redo 把它放回来', async () => {
    const h = harness();
    const track = visualTrackId(h);
    await h.cp.addClip(track, { kind: 'solid', color: '#123456', start: 0, end: 1, id: 'c1' });
    await h.cp.undo();
    expect(await ok(h.cp.redo())).toEqual({ changed: true });
    expect(h.store.findClip('c1')).not.toBeNull();
  });

  it('moveClip 是一笔撤销（live + settle 都在同一条记录里）', async () => {
    const h = harness();
    const track = visualTrackId(h);
    await h.cp.addClip(track, { kind: 'solid', color: '#111111', start: 0, end: 1, id: 'c1' });
    const recordsAfterAdd = h.store.canUndo();

    await ok(h.cp.moveClip('c1', track, 5));
    expect(h.store.findClip('c1')!.clip.start).toBeCloseTo(5, 9);
    // 只多了一条记录 —— 内部跑了 live + settle 两次直改，但它们不入栈
    expect(h.store.canUndo()).toBe(recordsAfterAdd);
    await ok(h.cp.undo());
    expect(h.store.findClip('c1')!.clip.start).toBeCloseTo(0, 9);
  });

  it('setCurve / setClipProps / 特效链 都入栈', async () => {
    const h = harness();
    const track = visualTrackId(h);
    await h.cp.addClip(track, { kind: 'algo', generator: 'mandelbrot', start: 0, end: 2, id: 'c1' });

    await ok(h.cp.setClipProps('c1', { label: '底图', opacity: 0.4 }));
    expect(h.store.findClip('c1')!.clip.label).toBe('底图');

    await ok(h.cp.setCurve('c1', 'opacity', { keys: [{ t: 0, v: 0, interp: 'linear' }, { t: 1, v: 1, interp: 'linear' }] }));
    expect(h.store.findClip('c1')!.clip.curves.opacity!.keys).toHaveLength(2);
    await ok(h.cp.setCurve('c1', 'opacity', null));
    expect(h.store.findClip('c1')!.clip.curves.opacity).toBeUndefined();

    await ok(h.cp.addEffectClip(track, { start: 0, end: 2, id: 'fx', chain: [{ defId: 'echo' }] }));
    const added = await ok(h.cp.addEffect('fx', 'slices', { count: 4 }));
    const fxClip = h.store.findClip('fx')!.clip;
    if (fxClip.kind !== 'effect') throw new Error('应为特效片段');
    expect(fxClip.chain.map((c) => c.defId)).toEqual(['echo', 'slices']);
    expect(fxClip.chain[1]!.instanceId).toBe(added.instanceId);
    // 默认值补齐了：agent 只给 count，其余参数也在
    expect(Object.keys(fxClip.chain[1]!.values).length).toBeGreaterThan(1);

    await ok(h.cp.reorderEffect('fx', 0, 1));
    const reordered = h.store.findClip('fx')!.clip;
    if (reordered.kind !== 'effect') throw new Error('应为特效片段');
    expect(reordered.chain.map((c) => c.defId)).toEqual(['slices', 'echo']);

    await ok(h.cp.removeEffect('fx', 0));
    const removed = h.store.findClip('fx')!.clip;
    if (removed.kind !== 'effect') throw new Error('应为特效片段');
    expect(removed.chain.map((c) => c.defId)).toEqual(['echo']);
  });

  it('beginTx / endTx 把整段包成**一笔**撤销', async () => {
    const h = harness();
    const track = visualTrackId(h);
    await ok(h.cp.beginTx());
    await ok(h.cp.addClip(track, { kind: 'solid', color: '#111111', start: 0, end: 1, id: 'a' }));
    await ok(h.cp.addClip(track, { kind: 'solid', color: '#222222', start: 1, end: 2, id: 'b' }));
    h.store.touch();
    expect(await ok(h.cp.endTx('agent: 两段'))).toEqual({ changed: true });
    await ok(h.cp.undo());
    expect(h.store.findClip('a')).toBeNull();
    expect(h.store.findClip('b')).toBeNull();
  });

  it('cancelTx 回滚到事务起点', async () => {
    const h = harness();
    const track = visualTrackId(h);
    await ok(h.cp.beginTx());
    await ok(h.cp.addClip(track, { kind: 'solid', color: '#111111', start: 0, end: 1, id: 'a' }));
    await ok(h.cp.cancelTx());
    expect(h.store.findClip('a')).toBeNull();
    expect(await code(h.cp.endTx('x'))).toBe('conflict');
  });

  it('事务没开时 endTx / 重复 beginTx 都是 conflict（不是崩）', async () => {
    const h = harness();
    expect(await code(h.cp.endTx('x'))).toBe('conflict');
    await ok(h.cp.beginTx());
    expect(await code(h.cp.beginTx())).toBe('conflict');
    await ok(h.cp.cancelTx());
  });

  it('loadScene 走 loadFrom（可撤销），不是 replaceProject（清栈）', async () => {
    const h = harness();
    const track = visualTrackId(h);
    await h.cp.addClip(track, { kind: 'solid', color: '#111111', start: 0, end: 1, id: 'c1' });

    const draft = createBlankProject('整体改写');
    draft.duration = 6;
    const dt = draft.tracks.find((t) => t.kind === 'visual')!;
    (dt.clips as unknown[]).push({
      kind: 'source',
      id: 'z1',
      start: 0,
      end: 3,
      label: 'z',
      fadeSec: 0,
      curves: {},
      source: { type: 'solid', color: '#00ff00' },
      blend: 'normal',
      opacity: 1,
      transform: { x: 0.5, y: 0.5, sx: 1, sy: 1, rot: 0 },
      fit: 'stretch',
    });
    await ok(h.cp.loadScene(draft));
    expect(h.store.project.name).toBe('整体改写');
    expect(h.store.findClip('z1')).not.toBeNull();
    expect(h.store.canUndo()).toBe(true);
    await ok(h.cp.undo());
    expect(h.store.project.name).toBe('agent-test');
    expect(h.store.findClip('c1')).not.toBeNull();
  });
});

/* ------------------------------------------------------------ 错误码 */

describe('错误码（agent 靠它决定下一步，不许只有一句字符串）', () => {
  it('找不到的 id 是 not-found，并带上合法值清单', async () => {
    const h = harness();
    const r = await h.cp.addClip(visualTrackId(h), {
      kind: 'algo',
      generator: '不存在的生成器',
      start: 0,
      end: 1,
    });
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error('应当失败');
    expect(r.error.code).toBe('not-found');
    expect((r.error.detail as { validIds: string[] }).validIds).toContain('mandelbrot');
  });

  it('未知参数键是 invalid-argument，并列出已知键', async () => {
    const h = harness();
    const track = visualTrackId(h);
    await h.cp.addClip(track, { kind: 'algo', generator: 'mandelbrot', start: 0, end: 2, id: 'c1' });
    const r = await h.cp.setClipSourceParams('c1', { 不存在的参数: 1 });
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error('应当失败');
    expect(r.error.code).toBe('invalid-argument');
    expect((r.error.detail as { known: string[] }).known.length).toBeGreaterThan(0);
  });

  it('reject 策略下非法落点整次不动（conflict），且不留下半成品', async () => {
    const h = harness();
    const track = visualTrackId(h);
    await h.cp.addClip(track, { kind: 'solid', color: '#111111', start: 0, end: 1, id: 'a' });
    await h.cp.addClip(track, { kind: 'solid', color: '#222222', start: 1, end: 2, id: 'b' });

    expect(await code(h.cp.moveClip('b', track, 0.5))).toBe('conflict');
    // 一动没动：几何、时长、撤销栈都不许被这次失败的移动改掉
    expect(h.store.findClip('b')!.clip.start).toBeCloseTo(1, 9);
    await h.cp.undo();
    expect(h.store.findClip('b')).toBeNull();
    expect(h.store.findClip('a')).not.toBeNull();
  });

  it('音频轨只装 audio 片段（判据只有 canHost 一条，拖拽与 Alt+↑↓ 共用）', async () => {
    const h = harness();
    const audio = h.store.project.tracks.find((t) => t.kind === 'audio')!.id;
    expect(
      await code(h.cp.addClip(audio, { kind: 'solid', color: '#111111', start: 0, end: 1, id: 's1' })),
    ).toBe('invalid-argument');
    // 视觉片段也跨不过去
    const visual = visualTrackId(h);
    await ok(h.cp.addClip(visual, { kind: 'solid', color: '#111111', start: 0, end: 1, id: 's2' }));
    expect(await code(h.cp.moveClip('s2', audio, 0))).toBe('invalid-argument');
  });

  it('image / video 的 assetId 必须在台账里（否则就是一张黑屏 + 零报错）', async () => {
    const h = harness();
    const track = visualTrackId(h);
    expect(
      await code(h.cp.addClip(track, { kind: 'image', assetId: '不存在', start: 0, end: 1 })),
    ).toBe('not-found');
    // 登记进 project.assets 之后就能加
    h.store.commit('登记素材', (p) => {
      p.assets['img1'] = { id: 'img1', kind: 'image', name: 'test' };
    });
    expect((await ok(h.cp.addClip(track, { kind: 'image', assetId: 'img1', start: 0, end: 1 }))).clipId).toBeTruthy();
  });

  it('落不了的转场是 unsupported，并给出原因（不是静默什么都不发生）', async () => {
    const h = harness();
    const track = visualTrackId(h);
    await h.cp.addClip(track, { kind: 'solid', color: '#111111', start: 0, end: 1, id: 'a' });
    const r = await h.cp.setTransition('a', 'fade', 0.5);
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error('应当失败');
    expect(r.error.code).toBe('unsupported');
    expect(r.error.detail).toEqual({ reason: 'no-next' });
  });

  it('相邻的两个 source 片段上转场能落地', async () => {
    const h = harness();
    const track = visualTrackId(h);
    await h.cp.addClip(track, { kind: 'solid', color: '#111111', start: 0, end: 2, id: 'a' });
    await h.cp.addClip(track, { kind: 'solid', color: '#222222', start: 2, end: 4, id: 'b' });
    expect(await ok(h.cp.setTransition('a', 'fade', 1))).toEqual({ changed: true });
    const clip = h.store.findClip('a')!.clip;
    if (clip.kind !== 'source') throw new Error('应为 source');
    expect(clip.transitionOut!.defId).toBe('fade');
    // 场景里两侧都 active —— 与 core/transitions 的窗口一致
    const snap = await ok(h.cp.getScene({ t: 2.2, detail: 'full' }));
    // 快照的片段类型是 ids / full 两档的联合，`active` 只有 full 那档才有。
    const flags = Object.fromEntries(
      snap.tracks.flatMap((t) => t.clips.map((c) => [c.id, 'active' in c ? c.active : undefined])),
    );
    expect(flags).toEqual({ a: true, b: true });
    expect(await ok(h.cp.clearTransition('a'))).toEqual({ changed: true });
  });

  it('曲线形状不对是 invalid-argument（形状错会一路穿透到渲染期）', async () => {
    const h = harness();
    const track = visualTrackId(h);
    await h.cp.addClip(track, { kind: 'solid', color: '#111111', start: 0, end: 2, id: 'c1' });
    expect(
      await code(h.cp.setCurve('c1', 'opacity', { keys: [{ t: 1, v: 0, interp: 'linear' }, { t: 0, v: 1, interp: 'linear' }] })),
    ).toBe('invalid-argument');
    expect(await code(h.cp.setCurve('c1', 'nope', { keys: [] }))).toBe('invalid-argument');
  });

  it('不可写的字段被挡在 setClipProps 之外', async () => {
    const h = harness();
    const track = visualTrackId(h);
    await h.cp.addClip(track, { kind: 'solid', color: '#111111', start: 0, end: 2, id: 'c1' });
    expect(await code(h.cp.setClipProps('c1', { kind: 'effect' }))).toBe('invalid-argument');
    expect(await code(h.cp.setClipProps('c1', { id: 'other' }))).toBe('invalid-argument');
  });

  it('loadScene 收一份坏工程时给 invalid-argument（不把库改坏）', async () => {
    const h = harness();
    const before = JSON.stringify(h.store.project);
    expect(await code(h.cp.loadScene({ name: '没版本号' }))).toBe('invalid-argument');
    expect(await code(h.cp.loadScene({ schemaVersion: 999 }))).toBe('invalid-argument');
    expect(JSON.stringify(h.store.project)).toBe(before);
  });

  it('渲染类方法在渲染服务缺席时给 not-ready（不是 undefined 崩）', async () => {
    const h = harness();
    expect(await code(h.cp.renderFrame({ t: 0 }))).toBe('not-ready');
    expect(await code(h.cp.frameSignature({ t: 0 }))).toBe('not-ready');
    expect(await code(h.cp.snapshotPng({ t: 0 }))).toBe('not-ready');
    expect(await code(h.cp.export({ format: 'png' }))).toBe('not-ready');
  });

  it('保存不成时给 unsupported（而不是假装成功）', async () => {
    const h = harness();
    expect(await code(h.cp.saveProject())).toBe('unsupported');
  });
});

/* ---------------------------------------------------------- 结构不变量 */

describe('结构与不变量', () => {
  it('addClip 回传的是**落点之后**的几何（`addClip` 会把起点顺延到下一个空档）', async () => {
    const h = harness();
    const track = visualTrackId(h);
    await ok(h.cp.addClip(track, { kind: 'solid', color: '#111111', start: 0, end: 10, id: 'big' }));
    const shifted = await ok(
      h.cp.addClip(track, { kind: 'solid', color: '#222222', start: 0, end: 1, id: 'small' }),
    );
    // 起点被占 ⇒ 顺延到 big 的末尾（`addClip` 会加一个 1e-6 的避碰余量）。
    // 回传原始入参（0）就是撒谎。
    expect(shifted.start).toBeGreaterThan(9.999);
    expect(shifted.start).toBeLessThan(10.001);
    expect(h.store.findClip('small')!.clip.start).toBe(shifted.start);
  });

  it('splitClip 返回左右两段的 id，右半段按几何认回来', async () => {
    const h = harness();
    const track = visualTrackId(h);
    await h.cp.addClip(track, { kind: 'solid', color: '#111111', start: 0, end: 4, id: 'c1' });
    const split = await ok(h.cp.splitClip('c1', 2));
    expect(split.leftId).toBe('c1');
    expect(split.rightId).toBeTruthy();
    const placed = h.store.findClip(split.rightId!)!;
    expect(placed.clip.start).toBeCloseTo(2, 9);
    expect(placed.clip.end).toBeCloseTo(4, 9);
    expect(await code(h.cp.splitClip('c1', 99))).toBe('invalid-argument');
  });

  it('resizeClip 的 start 边会推进 srcIn（trim-in 的语义不许被绕过）', async () => {
    const h = harness();
    const track = visualTrackId(h);
    h.store.commit('登记视频', (p) => {
      p.assets['a'] = { id: 'a', kind: 'video', name: 'v' };
    });
    await ok(
      h.cp.addClip(track, {
        kind: 'video',
        assetId: 'a',
        srcIn: 0,
        speed: 2,
        start: 0,
        end: 4,
        id: 'v1',
      }),
    );
    await ok(h.cp.resizeClip('v1', 'start', 1));
    const clip = h.store.findClip('v1')!.clip;
    if (clip.kind !== 'source' || clip.source.type !== 'video') throw new Error('应为 video source');
    expect(clip.source.srcIn).toBeCloseTo(2, 9);
    expect(clip.end).toBeCloseTo(4, 9);
  });

  it('setProject 的每个字段都是独立的一笔（想一键撤销就用事务）', async () => {
    const h = harness();
    const changed = await ok(h.cp.setProject({ fps: 24, duration: 5 }));
    expect(changed.changed.sort()).toEqual(['duration', 'fps']);
    expect(h.store.project.fps).toBe(24);
    expect(h.store.project.duration).toBe(5);
    await ok(h.cp.undo());
    expect(h.store.project.duration).not.toBe(5);
  });

  it('moveTrack 改的是合成顺序（不是纯展示排序）', async () => {
    const h = harness();
    await h.cp.addTrack('visual', 'V2');
    expect(h.store.project.tracks.filter((t) => t.kind === 'visual')).toHaveLength(2);
    await ok(h.cp.moveTrack(0, 1));
    const snap = await ok(h.cp.getScene({ t: 0, detail: 'ids' }));
    expect(snap.tracks.map((t) => t.z)).toEqual([null, 1, 0]);
  });
});

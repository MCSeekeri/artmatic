import { describe, expect, it } from 'vitest';
import { buildStack } from '../../src/engine/stack';
import { createDemoProject } from '../../src/core/demo-project';
import { defaultProject, newId, type Project, type SourceClip, type VisualTrack } from '../../src/core/schema';

/** 造一个「一轨一个纯色片段」的工程，用于只观察 z 映射。 */
function projectWithTracks(names: string[]): Project {
  const p = defaultProject('测试');
  p.duration = 10;
  for (const name of names) {
    const clip: SourceClip = {
      kind: 'source',
      id: newId(),
      start: 0,
      end: 10,
      label: name,
      fadeSec: 0,
      curves: {},
      source: { type: 'solid', color: '#000000' },
      blend: 'normal',
      opacity: 1,
      transform: { x: 0.5, y: 0.5, sx: 1, sy: 1, rot: 0 },
      fit: 'stretch',
    };
    const track: VisualTrack = {
      kind: 'visual',
      id: newId(),
      name,
      enabled: true,
      clips: [clip],
    };
    p.tracks.push(track);
  }
  return p;
}

describe('buildStack 的 z 序 = 列表顶部在前景', () => {
  it('列表第一轨的 z 最大（last），最后一轨 z 最小（0）', () => {
    const p = projectWithTracks(['顶', '中', '底']);
    const ops = buildStack(p, 1);
    const byLabel = Object.fromEntries(
      ops.filter((o) => o.type === 'source').map((o) => [(o as { source: { clip: SourceClip } }).source.clip.label, o.z]),
    );
    expect(byLabel['顶']).toBe(2);
    expect(byLabel['中']).toBe(1);
    expect(byLabel['底']).toBe(0);
  });

  it('z 严格随列表下标递减', () => {
    const p = projectWithTracks(['a', 'b', 'c', 'd']);
    const zs = buildStack(p, 1).map((o) => o.z);
    expect(zs).toEqual([...zs].sort((x, y) => x - y)); // 升序输出（合成顺序）
    expect(zs).toEqual([0, 1, 2, 3]);
  });

  it('输出按 z 升序 —— compositor 顺序消费，后画者盖在上', () => {
    const ops = buildStack(projectWithTracks(['x', 'y']), 1);
    for (let i = 1; i < ops.length; i += 1) {
      expect(ops[i]!.z).toBeGreaterThanOrEqual(ops[i - 1]!.z);
    }
  });

  it('禁用的轨道整条不参与（引擎侧确实消费 enabled）', () => {
    const p = projectWithTracks(['顶', '底']);
    (p.tracks[0] as VisualTrack).enabled = false;
    const ops = buildStack(p, 1);
    expect(ops).toHaveLength(1);
    // 禁用后索引不变，所以「底」仍是 z=0（z 由数组下标决定，不因过滤而重排）
    expect(ops[0]!.z).toBe(0);
  });

  it('音频轨不产生渲染 op（视觉栈只含 visual 轨）', () => {
    const p = projectWithTracks(['v']);
    p.tracks.push({
      kind: 'audio',
      id: newId(),
      name: 'a',
      enabled: true,
      bus: 'master',
      clips: [],
    });
    expect(buildStack(p, 1)).toHaveLength(1);
  });

  it('demo 工程：每个 op 的 z 都等于「轨道下标取反」', () => {
    const p = createDemoProject();
    const visual = p.tracks.filter((t) => t.kind === 'visual');
    /*
     * 轨名约定是 `V{n}`，列表自上而下 = 前景→背景 ⇒ 编号必须**降序**，
     * 且最大编号等于视觉轨数。
     *
     * 这里刻意不写死 `'V4'` / 条数：被守的是「轨道列表顺序 ↔ z 的映射」，
     * 不是「demo 恰好有几条轨」。写死之后每次调整 demo 的层数都要来改守卫，
     * 而改守卫的时候很容易顺手把要守的东西也改掉 —— 那时它就只是个装饰。
     */
    const nums = visual.map((t) => {
      const m = /^V(\d+)/.exec(t.name);
      expect(m, `轨名 ${t.name} 不符合 V{n} 约定`).not.toBeNull();
      return Number(m![1]);
    });
    expect(nums).toEqual([...nums].sort((a, b) => b - a));
    expect(nums[0]).toBe(visual.length);

    const ops = buildStack(p, 0.5);
    expect(ops.length).toBeGreaterThan(0);
    for (const op of ops) {
      // 转场 op 也是「挂在某条轨道上」的，归属按出画片段算
      const clipId =
        op.type === 'effect'
          ? op.clip.id
          : op.type === 'transition'
            ? op.from.clip.id
            : op.source.clip.id;
      const trackIdx = visual.findIndex((t) => t.clips.some((c) => c.id === clipId));
      expect(trackIdx, `找不到 ${clipId} 所属轨道`).toBeGreaterThanOrEqual(0);
      expect(op.z, `z 与轨道 ${visual[trackIdx]!.name} 的顺序不符`).toBe(
        visual.length - 1 - trackIdx,
      );
    }
  });

  it('demo 工程 z 的取值集合恰为 0..(视觉轨数-1)', () => {
    const p = createDemoProject();
    const visualCount = p.tracks.filter((t) => t.kind === 'visual').length;
    const zs = [...new Set(buildStack(p, 0.5).map((o) => o.z))].sort((a, b) => a - b);
    for (const z of zs) expect(z).toBeGreaterThanOrEqual(0);
    for (const z of zs) expect(z).toBeLessThan(visualCount);
  });

  it('demo 工程最后一轨是音频（与视觉栈的 z 无关）', () => {
    const p = createDemoProject();
    expect(p.tracks[p.tracks.length - 1]!.kind).toBe('audio');
  });
});

/* ------------------------------------------------------------------ 转场 */

/** from[0,2] + to[2,4]，from 带 d=1 的出画转场 → 窗口 [1.5, 2.5)。 */
function transitionProject(opts: { fromBlend?: SourceClip['blend']; toBlend?: SourceClip['blend'] } = {}) {
  const mk = (start: number, end: number, color: string, blend: SourceClip['blend']): SourceClip => ({
    kind: 'source',
    id: newId(),
    start,
    end,
    label: color,
    fadeSec: 0,
    curves: {},
    source: { type: 'solid', color },
    blend,
    opacity: 1,
    transform: { x: 0.5, y: 0.5, sx: 1, sy: 1, rot: 0 },
    fit: 'stretch',
  });
  const from = mk(0, 2, '#ff0000', opts.fromBlend ?? 'normal');
  const to = mk(2, 4, '#0000ff', opts.toBlend ?? 'normal');
  from.transitionOut = { defId: 'fade', duration: 1, values: { foo: 3 } };
  const p = defaultProject('测试');
  p.duration = 10;
  p.tracks.push({ kind: 'visual', id: 'v1', name: 'V1', enabled: true, clips: [from, to] });
  return { p, from, to };
}

describe('buildStack：转场 op', () => {
  it('窗口外仍是两个独立 source op（行为没变）', () => {
    const { p } = transitionProject();
    expect(buildStack(p, 1).map((o) => o.type)).toEqual(['source']);
    expect(buildStack(p, 3).map((o) => o.type)).toEqual(['source']);
  });

  it('窗口前半段（t < cut）：一个 transition op，没有多余的 source op', () => {
    const { p } = transitionProject();
    const ops = buildStack(p, 1.6);
    expect(ops.map((o) => o.type)).toEqual(['transition']);
    const op = ops[0]!;
    if (op.type !== 'transition') throw new Error('应为 transition');
    expect(op.defId).toBe('fade');
    expect(op.values).toEqual({ foo: 3 });
    expect(op.progress).toBeCloseTo(0.1, 9);
    expect(op.from.clip.label).toBe('#ff0000');
    expect(op.to.clip.label).toBe('#0000ff');
  });

  it('窗口后半段（t ≥ from.end）照样命中 —— 这是「转场判断必须在 span 过滤之前」的守卫', () => {
    const { p } = transitionProject();
    // t=2.2 已越过 from.end(2)；若先做 span 过滤就会退化成单个 to 的 source op
    const ops = buildStack(p, 2.2);
    expect(ops.map((o) => o.type)).toEqual(['transition']);
    const op = ops[0]!;
    if (op.type !== 'transition') throw new Error('应为 transition');
    expect(op.progress).toBeCloseTo(0.7, 9);
  });

  it('入画片段不会被重复画（窗口后半段的 t 落在它自己的区间里）', () => {
    const { p } = transitionProject();
    // to 的区间是 [2,4)，窗口是 [1.5,2.5)：整段窗口内都只应有 1 个 op
    for (const t of [1.5, 1.9, 2.0, 2.4, 2.49]) {
      expect(buildStack(p, t).filter((o) => o.type !== 'effect')).toHaveLength(1);
    }
  });

  it('t = 窗口末端（半开）回到单 source op：入画片段自己出场', () => {
    const { p } = transitionProject();
    const ops = buildStack(p, 2.5);
    expect(ops.map((o) => o.type)).toEqual(['source']);
    expect((ops[0] as { source: { clip: SourceClip } }).source.clip.label).toBe('#0000ff');
  });

  it('两侧各自的 transform / opacity 都在 op 里求值好（不是共用一个）', () => {
    const { p, from } = transitionProject();
    from.opacity = 0.5;
    const op = buildStack(p, 1.6)[0]!;
    if (op.type !== 'transition') throw new Error('应为 transition');
    expect(op.from.opacity).toBeCloseTo(0.5, 9);
    expect(op.to.opacity).toBeCloseTo(1, 9);
    expect(op.from.transform.x).toBe(0.5);
  });

  it('合成用的 blend 取入画片段的（窗口结束后下一帧就是它）', () => {
    const { p } = transitionProject({ fromBlend: 'screen', toBlend: 'multiply' });
    const op = buildStack(p, 1.6)[0]!;
    if (op.type !== 'transition') throw new Error('应为 transition');
    expect(op.blend).toBe('multiply');
  });

  it('转场 op 的 z 与所在轨道一致（其他轨道照常叠）', () => {
    const { p } = transitionProject();
    // 再加一条视觉轨：列表顶部 = 前景
    p.tracks.unshift({
      kind: 'visual',
      id: 'v0',
      name: 'V0',
      enabled: true,
      clips: [
        {
          kind: 'source',
          id: newId(),
          start: 0,
          end: 10,
          label: 'under',
          fadeSec: 0,
          curves: {},
          source: { type: 'solid', color: '#00ff00' },
          blend: 'normal',
          opacity: 1,
          transform: { x: 0.5, y: 0.5, sx: 1, sy: 1, rot: 0 },
          fit: 'stretch',
        },
      ],
    });
    const ops = buildStack(p, 1.6);
    // 输出按 z 升序：v1（数组下标 1 → z=0）在前，v0（z=1）在后 = 前景后画
    expect(ops.map((o) => o.type)).toEqual(['transition', 'source']);
    expect(ops[0]!.z).toBe(0);
    expect(ops[1]!.z).toBe(1);
  });

  it('轨道被禁用时整个转场也不产出', () => {
    const { p } = transitionProject();
    (p.tracks[0] as VisualTrack).enabled = false;
    expect(buildStack(p, 1.6)).toEqual([]);
  });

  it('没有紧邻的下一个片段时不做转场（留缝），退化成普通的两个 op', () => {
    const { p, to } = transitionProject();
    to.start = 2.5;
    to.end = 4.5;
    expect(buildStack(p, 1.6).map((o) => o.type)).toEqual(['source']);
    expect(buildStack(p, 2.2).map((o) => o.type)).toEqual([]); // 缝隙里什么都没有
  });
});

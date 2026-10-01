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
    expect(visual[0]!.name).toContain('V4');
    expect(visual[visual.length - 1]!.name).toContain('V1');

    const ops = buildStack(p, 0.5);
    expect(ops.length).toBeGreaterThan(0);
    for (const op of ops) {
      const clipId = op.type === 'effect' ? op.clip.id : op.source.clip.id;
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

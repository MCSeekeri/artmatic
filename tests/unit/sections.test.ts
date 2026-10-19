import { describe, expect, it } from 'vitest';
import {
  nextSectionName,
  sanitizeSections,
  sectionAt,
  sectionEnd,
  snapTimeWithSections,
  sortSections,
} from '../../src/core/sections';
import { defaultProject, migrateProject, validateProject, type Section } from '../../src/core/schema';
import { ProjectStore } from '../../src/core/project-store';
import { createBlankProject } from '../../src/core/demo-project';
import { snapTime, type BeatGrid } from '../../src/core/time';

const GRID: BeatGrid = { bpm: 120, offset: 0, beatsPerBar: 4 };

function sec(id: string, start: number, name = id, color?: string): Section {
  return color ? { id, name, start, color } : { id, name, start };
}

describe('sortSections', () => {
  it('按 start 排序，且不改原数组', () => {
    const input = [sec('c', 4), sec('a', 0), sec('b', 2)];
    const out = sortSections(input);
    expect(out.map((s) => s.id)).toEqual(['a', 'b', 'c']);
    expect(input.map((s) => s.id)).toEqual(['c', 'a', 'b']);
  });

  it('同起点保持原相对顺序（拖动时不会无故互换）', () => {
    const out = sortSections([sec('x', 1), sec('y', 1)]);
    expect(out.map((s) => s.id)).toEqual(['x', 'y']);
  });
});

describe('sanitizeSections：永不抛，坏条目逐条丢弃', () => {
  it('缺字段 / 坏类型 / 负起点全部丢掉', () => {
    const out = sanitizeSections([
      { id: 'ok', name: 'A', start: 2 },
      { name: 'no-id', start: 0 },
      { id: '', name: 'empty-id', start: 0 },
      { id: 'nan', name: 'x', start: Number.NaN },
      { id: 'neg', name: 'x', start: -1 },
      { id: 'inf', name: 'x', start: Number.POSITIVE_INFINITY },
      null,
      'nope',
      [1, 2],
    ]);
    expect(out.map((s) => s.id)).toEqual(['ok']);
  });

  it('不是数组 → 空数组（老工程 / 手改 JSON）', () => {
    expect(sanitizeSections(undefined)).toEqual([]);
    expect(sanitizeSections({ id: 'x' })).toEqual([]);
  });

  it('start 是数字字符串时接受（手改 JSON 常见）', () => {
    expect(sanitizeSections([{ id: 'a', name: 'A', start: '3.5' }])[0]!.start).toBe(3.5);
  });

  it('颜色不合法只删这个键，不丢整条', () => {
    const out = sanitizeSections([
      { id: 'a', name: 'A', start: 0, color: 'red' },
      { id: 'b', name: 'B', start: 1, color: '#12abEF' },
    ]);
    expect(out[0]!.color).toBeUndefined();
    expect(out[1]!.color).toBe('#12abEF');
  });

  it('名字过长被截断（标尺上方只有 12px 高的一条带）', () => {
    const out = sanitizeSections([{ id: 'a', name: 'x'.repeat(200), start: 0 }]);
    expect(out[0]!.name.length).toBeLessThanOrEqual(60);
  });
});

describe('sectionAt / sectionEnd', () => {
  const list = [sec('a', 0), sec('b', 4), sec('c', 8)];

  it('落在段内取「起点不晚于 t 的最后一段」', () => {
    expect(sectionAt(list, 0)!.id).toBe('a');
    expect(sectionAt(list, 3.999)!.id).toBe('a');
    expect(sectionAt(list, 4)!.id).toBe('b');
    expect(sectionAt(list, 100)!.id).toBe('c');
  });

  it('t 在第一个段落之前（offset 为负的情况）→ null', () => {
    expect(sectionAt(list, -1)).toBeNull();
    expect(sectionAt([], 1)).toBeNull();
  });

  it('右边界 = 下一段起点；最后一段到工程末尾', () => {
    expect(sectionEnd(list, list[0]!, 16)).toBe(4);
    expect(sectionEnd(list, list[2]!, 16)).toBe(16);
  });

  it('重叠时右边界可能小于起点（几何交给画法钳制，不在数据层修）', () => {
    const overlap = [sec('a', 5), sec('b', 2)];
    expect(sectionEnd(overlap, overlap[0]!, 10)).toBe(10);
  });
});

describe('snapTimeWithSections：段落边界是吸附点', () => {
  it('没有段落时与 snapTime 完全一致', () => {
    for (const mode of ['bar', 'beat', 'half', 'free', 'frame'] as const) {
      expect(snapTimeWithSections(2.31, mode, GRID, [])).toBe(snapTime(2.31, mode, GRID));
    }
  });

  it('帧吸附：段落只在同一帧内才抢（标准模式的容差是半帧）', () => {
    // 30fps → 半帧 ≈ 0.0167s。段落放在 2.0s，2.01 落在同一帧 → 吸到段落；
    // 2.06 已经跨帧（0.06s > 半帧）→ 只按帧吸附。
    const sections = [sec('s', 2)];
    expect(snapTimeWithSections(2.01, 'frame', GRID, sections, 30)).toBe(2);
    // 2.06s @30fps → 最近的第 62 帧（2.0667s），而不是段落 2.0。
    expect(snapTimeWithSections(2.06, 'frame', GRID, sections, 30)).toBeCloseTo(62 / 30, 6);
  });

  it('段落比网格线更近时吸附到段落', () => {
    // 120BPM / 4 拍一小节 = 2s；段落放在 3s（非网格点）。
    const sections = [sec('s', 3)];
    // bar 模式：网格在 2/4，段落 3 更近（|3.1-3|=0.1 vs |3.1-4|=0.9）。
    expect(snapTimeWithSections(3.1, 'bar', GRID, sections)).toBe(3);
    // 2.2 更靠近网格 2s，段落不该抢。
    expect(snapTimeWithSections(2.2, 'bar', GRID, sections)).toBe(2);
  });

  it('标准模式（free）几乎不吸附段落 —— 与「吸附默认关」一致', () => {
    const sections = [sec('s', 3)];
    expect(snapTimeWithSections(3.2, 'free', GRID, sections)).toBeCloseTo(3.2, 1);
  });

  it('网格更近时网格赢（段落不抢）', () => {
    const sections = [sec('s', 3)];
    // beat 步长 0.5s：2.7 离网格 2.5 只有 0.2，离段落 0.3 → 归网格。
    expect(snapTimeWithSections(2.7, 'beat', GRID, sections)).toBe(2.5);
  });

  it('结果不为负（拖动到 0 之前）', () => {
    expect(snapTimeWithSections(-2, 'bar', GRID, [sec('s', 0)])).toBeGreaterThanOrEqual(0);
  });
});

describe('nextSectionName', () => {
  it('跳过已有编号，删掉中间几段也不会撞名', () => {
    const list = [sec('a', 0, '段落 1'), sec('b', 1, '段落 3')];
    expect(nextSectionName(list, (n) => `段落 ${n}`)).toBe('段落 2');
  });

  it('空列表从 1 开始', () => {
    expect(nextSectionName([], (n) => `段落 ${n}`)).toBe('段落 1');
  });
});

describe('schema v8：sections', () => {
  it('defaultProject 自带空数组（读取方不必到处 ?? []）', () => {
    expect(defaultProject('p').sections).toEqual([]);
  });

  it('v7 → v8 恒等迁移：缺字段补空数组，已存在的段落原样保留', () => {
    const bare = defaultProject('old') as unknown as Record<string, unknown>;
    delete bare.sections;
    bare.schemaVersion = 7;
    const out = migrateProject(bare);
    expect(out.schemaVersion).toBe(8);
    expect(out.sections).toEqual([]);

    const withSections = defaultProject('old2');
    withSections.sections = [sec('s1', 8, '发展', '#ff0000')];
    (withSections as unknown as Record<string, unknown>).schemaVersion = 7;
    const kept = migrateProject(JSON.parse(JSON.stringify(withSections)));
    expect(kept.sections).toEqual([sec('s1', 8, '发展', '#ff0000')]);
  });

  it('validateProject 清洗坏条目并重新排序', () => {
    const p = defaultProject('bad') as unknown as Record<string, unknown>;
    p.sections = [{ id: 'b', name: 'B', start: 4 }, { id: 'a', name: 'A', start: 1 }, { nope: 1 }];
    const out = validateProject(p);
    expect(out.sections.map((s) => s.id)).toEqual(['a', 'b']);
  });

  it('AudioClip 的 fadeIn / fadeOut：缺省不写，坏值钳成 0', () => {
    const p = defaultProject('audio');
    p.tracks.push({
      kind: 'audio', id: 'a1', name: 'A1', enabled: true, bus: 'master',
      clips: [{
        kind: 'audio', id: 'c1', start: 0, end: 2, label: '', fadeSec: 0, curves: {},
        assetId: 'x', srcIn: 0, fadeIn: -3, fadeOut: Number.NaN,
      }],
    } as never);
    const out = validateProject(p);
    const clip = out.tracks[0]!.clips[0]!;
    if (clip.kind !== 'audio') throw new Error('unreachable');
    expect(clip.fadeIn).toBe(0);
    expect(clip.fadeOut).toBe(0);
  });
});

describe('ProjectStore：段落写入', () => {
  function store(): ProjectStore {
    return new ProjectStore(createBlankProject('t'));
  }

  it('addSection 生成不撞名的默认名，并保持排序', () => {
    const s = store();
    s.addSection(4);
    const id = s.addSection(0);
    expect(s.project.sections.map((x) => x.start)).toEqual([0, 4]);
    expect(s.project.sections[0]!.id).toBe(id);
    expect(new Set(s.project.sections.map((x) => x.name)).size).toBe(2);
  });

  it('liveMoveSection 触摸版本、不入栈；endTx 才落成一笔撤销', () => {
    const s = store();
    const id = s.addSection(2, 'A');
    // 清空「加段落」那一笔，只留下「本次手势有没有入栈」这一个变量。
    s.replaceProject(s.project);
    const before = s.version;
    s.beginTx();
    s.liveMoveSection(id, 6);
    expect(s.project.sections[0]!.start).toBe(6);
    expect(s.version).toBeGreaterThan(before);
    expect(s.canUndo()).toBe(false);
    s.endTx('移动段落');
    expect(s.canUndo()).toBe(true);
    s.undo();
    expect(s.project.sections[0]!.start).toBe(2);
  });

  it('removeSection 与 renameSection 各一笔撤销', () => {
    const s = store();
    const id = s.addSection(1, 'A');
    s.renameSection(id, 'B');
    expect(s.project.sections[0]!.name).toBe('B');
    s.removeSection(id);
    expect(s.project.sections).toEqual([]);
    s.undo();
    expect(s.project.sections).toHaveLength(1);
    s.undo();
    expect(s.project.sections[0]!.name).toBe('A');
  });

  it('renameSection 拒绝空名字（留一个点不中的色块比不改更糟）', () => {
    const s = store();
    const id = s.addSection(1, 'A');
    s.renameSection(id, '   ');
    expect(s.project.sections[0]!.name).toBe('A');
  });

  it('liveSetFade 钳住 fadeIn + fadeOut ≤ 片段长度，归零时删字段', () => {
    const s = store();
    const trackId = s.project.tracks.find((t) => t.kind === 'audio')!.id;
    s.addClip(trackId, {
      kind: 'audio', id: 'c', start: 0, end: 2, label: '', fadeSec: 0, curves: {},
      assetId: 'x', srcIn: 0,
    } as never);
    s.beginTx();
    s.liveSetFade('c', 'in', 1.5);
    s.liveSetFade('c', 'out', 1.5);
    const clip = s.findClip('c')!.clip;
    if (clip.kind !== 'audio') throw new Error('unreachable');
    expect(clip.fadeIn).toBe(1.5);
    expect(clip.fadeOut).toBe(0.5); // 只剩 0.5s 的余量
    s.liveSetFade('c', 'in', 0);
    expect('fadeIn' in s.findClip('c')!.clip).toBe(false);
    s.endTx('调整淡入');
  });

  it('setFade（检查器那条）与手柄同一份钳制，并且是一笔撤销', () => {
    const s = store();
    const trackId = s.project.tracks.find((t) => t.kind === 'audio')!.id;
    s.addClip(trackId, {
      kind: 'audio', id: 'c', start: 0, end: 2, label: '', fadeSec: 0, curves: {},
      assetId: 'x', srcIn: 0,
    } as never);
    s.replaceProject(s.project); // 清掉「加片段」那一笔
    s.setFade('c', 'out', 1);
    let clip = s.findClip('c')!.clip;
    if (clip.kind !== 'audio') throw new Error('unreachable');
    expect(clip.fadeOut).toBe(1);

    s.setFade('c', 'in', 5); // 只余 1s 的余量
    clip = s.findClip('c')!.clip;
    if (clip.kind !== 'audio') throw new Error('unreachable');
    expect(clip.fadeIn).toBe(1);

    s.undo();
    clip = s.findClip('c')!.clip;
    if (clip.kind !== 'audio') throw new Error('unreachable');
    expect(clip.fadeIn).toBeUndefined();
    expect(clip.fadeOut).toBe(1);
  });

  it('splitSection：只插一个新起点，右半沿用颜色，两侧太窄时拒绝', () => {
    const s = store();
    const first = s.addSection(0, 'A');
    s.addSection(8, 'B');
    expect(s.canSplitSection(first, 3)).toBe(true);
    expect(s.canSplitSection(first, 0.01)).toBe(false); // 左侧太窄
    expect(s.canSplitSection(first, 8)).toBe(false); // 落在段外

    const id = s.splitSection(first, 3)!;
    expect(id).toBeTruthy();
    expect(s.project.sections.map((x) => +x.start.toFixed(3))).toEqual([0, 3, 8]);
    // 原名留给左半；新段拿到一个不撞名的默认名
    expect(s.project.sections[0]!.name).toBe('A');
    expect(s.project.sections[1]!.name).not.toBe('A');
    expect(s.project.sections[1]!.name).not.toBe('B');

    s.undo();
    expect(s.project.sections.map((x) => x.start)).toEqual([0, 8]);
  });

  it('splitSection 继承颜色（切出来的是同一种「段落类型」）', () => {
    const s = store();
    const p = defaultProject('color');
    p.sections = [sec('s1', 0, 'A', '#ff0000')];
    s.replaceProject(p);
    s.splitSection('s1', 4);
    expect(s.project.sections[1]!.color).toBe('#ff0000');
  });
});

import { describe, expect, it } from 'vitest';
import {
  contextRefKey,
  mergeContextRefs,
  renderAttachedRefs,
  renderUiContext,
  type ContextRef,
  type ElementContextRef,
} from '../../src/agent/context';
import { barBeatAt, type BeatGrid } from '../../src/core/time';

const grid: BeatGrid = { bpm: 120, offset: 0, beatsPerBar: 4 };

const clip = (id: string, name = ''): ContextRef => ({ kind: 'clip', id, name });
const el = (clipId: string, id: string, name = '', clipName = ''): ElementContextRef => ({
  kind: 'element',
  clipId,
  clipName,
  id,
  name,
});

describe('标注引用（右键「添加进上下文」）', () => {
  it('去重键区分片段与元素，元素带所属片段', () => {
    expect(contextRefKey(clip('c1'))).toBe('clip:c1');
    expect(contextRefKey(el('c1', 'e1'))).toBe('element:c1/e1');
    // 同一个元素 id 在两个片段里不冲突（id 只在文档内唯一）
    expect(contextRefKey(el('c1', 'e1'))).not.toBe(contextRefKey(el('c2', 'e1')));
  });

  it('追加去重、保序、封顶', () => {
    const merged = mergeContextRefs([clip('a')], [clip('a'), clip('b'), clip('c')]);
    expect(merged.map((r) => r.id)).toEqual(['a', 'b', 'c']);

    const capped = mergeContextRefs([clip('a')], [clip('b'), clip('c')], 2);
    expect(capped.map((r) => r.id)).toEqual(['a', 'b']);
  });

  it('没有标注时不产生任何文本（空串，不是一段空标题）', () => {
    expect(renderAttachedRefs([])).toBe('');
  });

  it('片段与元素分组，元素按所属片段归组并写出 clipId', () => {
    const text = renderAttachedRefs([
      clip('c1', '片头'),
      el('c2', 'e1', '大标题', '标题卡'),
      el('c2', 'e2', '副标题', '标题卡'),
      el('c3', 'e3', '角标', '角标卡'),
    ]);

    expect(text).toContain('## 用户标注的片段');
    expect(text).toContain('- 【片头】 id: c1');
    expect(text).toContain('## 用户标注的排版元素');
    // 同一片段只出现一次分组标题
    expect(text.match(/### 位于片段【标题卡】/g)).toHaveLength(1);
    expect(text).toContain('（id: c2）');
    expect(text).toContain('- 【大标题】 id: e1');
    expect(text).toContain('- 【副标题】 id: e2');
    expect(text).toContain('### 位于片段【角标卡】（id: c3）');
    // 分组顺序 = 首次出现顺序
    expect(text.indexOf('标题卡')).toBeLessThan(text.indexOf('角标卡'));
  });

  it('名字为空时退回 id（`【】` 会让模型以为对象没有名字）', () => {
    const text = renderAttachedRefs([clip('c9'), el('c8', 'e9')]);
    expect(text).toContain('- 【c9】 id: c9');
    expect(text).toContain('- 【e9】 id: e9');
  });
});

describe('界面快照（每轮注入系统提示）', () => {
  it('时间轴页：播放头同时给秒 / 帧号 / 小节拍', () => {
    const text = renderUiContext({
      view: 'timeline',
      playT: 12.4,
      fps: 30,
      beatGrid: grid,
      typoClip: null,
      selectedClips: [{ id: 'c1', name: '片头' }],
      selectedElements: [],
    });
    expect(text).toContain('View: the timeline');
    // 12.4s @ 30fps = 第 372 帧；120BPM 下 0.5s 一拍 ⇒ 第 24.8 拍 = 第 7 小节第 1 拍
    expect(text).toContain('12.400s = frame 372 = bar 7, beat 1');
    expect(text).toContain('- Selected clips: 【片头】 id: c1');
    expect(text).toContain('- Selected typography elements: none');
  });

  it('排版页：写出正在编辑的片段，元素一并列出', () => {
    const text = renderUiContext({
      view: 'typography',
      playT: 0,
      fps: 30,
      beatGrid: grid,
      typoClip: { id: 'c2', name: '标题卡' },
      selectedClips: [],
      selectedElements: [{ id: 'e1', name: '大标题' }],
    });
    expect(text).toContain('editing clip 【标题卡】 id: c2');
    expect(text).toContain('- Selected clips: none');
    expect(text).toContain('【大标题】 id: e1');
    // 空选区时必须显式写 none：留空会让模型以为「选区信息不存在」而不是「没选」
    expect(text).not.toContain('Selected clips: 【');
  });
});

describe('小节 / 拍换算', () => {
  it('从 1 起，且 offset 被尊重', () => {
    expect(barBeatAt(0, grid)).toEqual({ bar: 1, beat: 1 });
    expect(barBeatAt(1.5, grid)).toEqual({ bar: 1, beat: 4 });
    expect(barBeatAt(2, grid)).toEqual({ bar: 2, beat: 1 });
    expect(barBeatAt(2, { ...grid, offset: 0.5 })).toEqual({ bar: 1, beat: 4 });
  });

  it('负拍落到第 0 小节（DAW 惯例，不钳成第 1 小节）', () => {
    expect(barBeatAt(0, { ...grid, offset: 0.5 })).toEqual({ bar: 0, beat: 4 });
  });

  it('坏 BPM 不产生 NaN（「第 NaN 小节」会直接写进提示词）', () => {
    expect(barBeatAt(1, { bpm: Number.NaN, offset: 0, beatsPerBar: 4 })).toEqual({ bar: 1, beat: 1 });
  });
});

import { describe, expect, it } from 'vitest';
import {
  CLIP_KIND,
  clipAssetIds,
  parseClipboard,
  planPaste,
  serializeClips,
  type ClipboardEntry,
} from '../../src/core/clipboard';
import type { AnyClip } from '../../src/core/schema';
import type { BeatGrid } from '../../src/core/time';

/**
 * 片段剪贴板的守卫。
 *
 * 四条判据：
 *  1. 序列化 → 解析往返，且 start 归一成「相对第一个片段」；
 *  2. **永不抛**：非 JSON / 外来 JSON / 版本不对 / 片段形状不对一律 null
 *     （调用方的纪律是「不是自己的格式整段放行」，解析抛错会把粘贴整个搞垮）；
 *  3. 落点优先级：原轨位 → 选中轨 → 第一条能装的轨，音频/视觉不混装；
 *  4. 跨工程素材缺失只打标记、不丢片段（画面按脱机媒体占位符表现）。
 */

const grid: BeatGrid = { bpm: 120, offset: 0, beatsPerBar: 4 };

function clip(id: string, over: Partial<AnyClip> = {}): AnyClip {
  return {
    kind: 'source',
    id,
    start: 0,
    end: 4,
    label: id,
    fadeSec: 0,
    curves: {},
    source: { type: 'solid', color: '#ffffff' },
    blend: 'normal',
    opacity: 1,
    transform: { x: 0.5, y: 0.5, sx: 1, sy: 1, rot: 0 },
    fit: 'contain',
    ...over,
  } as AnyClip;
}

const tracks = [
  { id: 'v1', kind: 'visual' as const },
  { id: 'v2', kind: 'visual' as const },
  { id: 'a1', kind: 'audio' as const },
];

describe('serializeClips / parseClipboard：往返', () => {
  it('往返保真，start 归一成相对第一个片段', () => {
    const entries: ClipboardEntry[] = [
      { trackId: 'v1', clip: clip('c1', { start: 10, end: 14 }) },
      { trackId: 'v2', clip: clip('c2', { start: 12, end: 20 }) },
    ];
    const text = serializeClips(entries, '我的工程');
    const back = parseClipboard(text);
    expect(back).not.toBeNull();
    expect(back!.kind).toBe(CLIP_KIND);
    expect(back!.version).toBe(1);
    expect(back!.originName).toBe('我的工程');
    expect(back!.clips.map((e) => e.trackId)).toEqual(['v1', 'v2']);
    expect(back!.clips.map((e) => e.clip.start)).toEqual([0, 2]);
    expect(back!.clips.map((e) => e.clip.end)).toEqual([4, 10]);
  });

  it('不是自家格式一律 null（且不抛）', () => {
    expect(parseClipboard('')).toBeNull();
    expect(parseClipboard('not json at all')).toBeNull();
    expect(parseClipboard('[]')).toBeNull();
    expect(parseClipboard('null')).toBeNull();
    expect(parseClipboard(JSON.stringify({ kind: 'other/clips', version: 1, clips: [] }))).toBeNull();
    expect(parseClipboard(JSON.stringify({ kind: CLIP_KIND, version: 2, clips: [] }))).toBeNull();
    // kind / version 对但片段形状不对
    const bad = { kind: CLIP_KIND, version: 1, clips: [{ trackId: 'v1', clip: { id: 'x' } }] };
    expect(parseClipboard(JSON.stringify(bad))).toBeNull();
    // 缺 trackId（载荷形状演进过）
    const noTrack = { kind: CLIP_KIND, version: 1, clips: [{ clip: clip('c1') }] };
    expect(parseClipboard(JSON.stringify(noTrack))).toBeNull();
  });

  it('空数组不序列化（没有可复制的片段时写个空载荷只会污染剪贴板）', () => {
    expect(serializeClips([])).toBe('');
  });
});

describe('planPaste：落点', () => {
  const ctx = {
    tracks,
    knownAssetIds: new Set<string>(),
    grid,
  };

  it('原轨位优先（同 id 的轨还在且装得下）', () => {
    const plans = planPaste(
      parseClipboard(serializeClips([{ trackId: 'v2', clip: clip('c1') }]))!,
      { ...ctx, preferredTrackId: 'v1' },
    );
    expect(plans[0]!.trackId).toBe('v2');
  });

  it('原轨没了 → 选中轨', () => {
    const plans = planPaste(
      parseClipboard(serializeClips([{ trackId: 'gone', clip: clip('c1') }]))!,
      { ...ctx, preferredTrackId: 'v1' },
    );
    expect(plans[0]!.trackId).toBe('v1');
  });

  it('原轨与选中轨都不行 → 第一条能装的轨；音频/视觉不混装', () => {
    const visual = planPaste(
      parseClipboard(serializeClips([{ trackId: 'gone', clip: clip('c1') }]))!,
      { ...ctx, preferredTrackId: null },
    );
    expect(visual[0]!.trackId).toBe('v1');

    const audio = planPaste(
      parseClipboard(
        serializeClips([{ trackId: 'gone', clip: clip('a1', { kind: 'audio', assetId: 'x' } as Partial<AnyClip>) }]),
      )!,
      { ...ctx, preferredTrackId: 'v1' },
    );
    expect(audio[0]!.trackId).toBe('a1');
  });

  it('一条能装的轨都没有 → trackId 为 null（调用方说明，不静默丢弃）', () => {
    const plans = planPaste(
      parseClipboard(
        serializeClips([{ trackId: 'gone', clip: clip('a1', { kind: 'audio', assetId: 'x' } as Partial<AnyClip>) }]),
      )!,
      { ...ctx, tracks: [{ id: 'v1', kind: 'visual' }], preferredTrackId: null },
    );
    expect(plans[0]!.trackId).toBeNull();
  });
});

describe('planPaste：跨工程素材缺失', () => {
  it('只打标记不丢片段；solid 片段永不打标记', () => {
    const img = clip('c1', { source: { type: 'image', assetId: 'gone-1' } } as Partial<AnyClip>);
    const vid = clip('c2', { source: { type: 'video', assetId: 'gone-2', srcIn: 0, speed: 1 } } as Partial<AnyClip>);
    const aud = clip('c3', { kind: 'audio', assetId: 'gone-3' } as Partial<AnyClip>);
    const solid = clip('c4');
    const plans = planPaste(
      parseClipboard(
        serializeClips([
          { trackId: 'v1', clip: img },
          { trackId: 'v1', clip: vid },
          { trackId: 'a1', clip: aud },
          { trackId: 'v1', clip: solid },
        ]),
      )!,
      { tracks, knownAssetIds: new Set(['other']), grid },
    );
    expect(plans.map((p) => p.assetMissing)).toEqual([true, true, true, false]);
    // 片段一个都没丢
    expect(plans.every((p) => p.trackId !== null)).toBe(true);
  });

  it('素材在目标工程里 → 不打标记', () => {
    const plans = planPaste(
      parseClipboard(
        serializeClips([{ trackId: 'v1', clip: clip('c1', { source: { type: 'image', assetId: 'here' } } as Partial<AnyClip>) }]),
      )!,
      { tracks, knownAssetIds: new Set(['here']), grid },
    );
    expect(plans[0]!.assetMissing).toBe(false);
  });
});

describe('clipAssetIds', () => {
  it('按来源类型取素材 id；无素材来源给空数组', () => {
    expect(clipAssetIds(clip('c1', { source: { type: 'image', assetId: 'a' } } as Partial<AnyClip>))).toEqual(['a']);
    expect(clipAssetIds(clip('c2', { source: { type: 'video', assetId: 'b', srcIn: 0, speed: 1 } } as Partial<AnyClip>))).toEqual(['b']);
    expect(clipAssetIds(clip('c3', { kind: 'audio', assetId: 'c' } as Partial<AnyClip>))).toEqual(['c']);
    expect(clipAssetIds(clip('c4'))).toEqual([]);
    expect(clipAssetIds(clip('c5', { kind: 'effect', chain: [] } as Partial<AnyClip>))).toEqual([]);
  });
});

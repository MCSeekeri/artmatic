import { describe, expect, it } from 'vitest';
import { audioSpans, spanFromAudioClip, spanFromVideoClip, videoAudioAssetIds } from '../../src/core/audio-plan';
import { audioClipGainAt, dbToLinear } from '../../src/core/audio-envelope';
import { defaultProject, newId, type AudioClip, type Project, type SourceClip, type VisualTrack } from '../../src/core/schema';

/**
 * `core/audio-plan.ts` —— 预览与导出共用的「声音事件表」。
 *
 * 这里钉的是**谁出声**：独立音频片段 + 未静音的视频内嵌音轨。两处消费方
 * （`audio/player.ts` / `exporters/mixdown.ts`）都只认这张表，所以这张表错一项，
 * 预览和导出会一起错 —— 也正因为一起错，它必须在单测里被钉死。
 */

function audioClip(start: number, end: number, over: Partial<AudioClip> = {}): AudioClip {
  return {
    kind: 'audio',
    id: newId(),
    start,
    end,
    label: 'a',
    fadeSec: 0,
    curves: {},
    assetId: 'audio1',
    srcIn: 0,
    ...over,
  };
}

function videoClip(start: number, end: number, over: Partial<SourceClip> = {}): SourceClip {
  return {
    kind: 'source',
    id: newId(),
    start,
    end,
    label: 'v',
    fadeSec: 0,
    curves: {},
    source: { type: 'video', assetId: 'video1', srcIn: 0, speed: 1 },
    blend: 'normal',
    opacity: 1,
    transform: { x: 0.5, y: 0.5, sx: 1, sy: 1, rot: 0 },
    fit: 'cover',
    ...over,
  };
}

function projectWith(visual: SourceClip[], audio: AudioClip[], enabled = true): Project {
  const p = defaultProject('音频计划');
  p.assets['video1'] = { id: 'video1', kind: 'video', name: 'v.mp4', durationSec: 10, hasAudio: true };
  p.assets['audio1'] = { id: 'audio1', kind: 'audio', name: 'a.wav', durationSec: 10 };
  p.tracks.push({ kind: 'visual', id: 'v1', name: 'V1', enabled, clips: visual } as VisualTrack);
  p.tracks.push({ kind: 'audio', id: 'a1', name: 'A1', enabled, clips: audio, bus: 'master' });
  return p;
}

describe('AudioSpan 构造', () => {
  it('音频片段带上静态增益与两段淡变', () => {
    const clip = audioClip(1, 3, { gainDb: -6, fadeIn: 0.2, fadeOut: 0.4, srcIn: 0.5 });
    const span = spanFromAudioClip(clip);
    expect(span.id).toBe(clip.id);
    expect(span.srcIn).toBe(0.5);
    expect(span.gainDb).toBe(-6);
    expect(span.fadeIn).toBe(0.2);
    expect(span.fadeOut).toBe(0.4);
  });

  it('视频内嵌音轨用 `${clipId}:embedded` 作为 id', () => {
    const clip = videoClip(2, 5, { audio: { gainDb: 3, fadeIn: 1 } });
    const span = spanFromVideoClip(clip, true)!;
    expect(span.id).toBe(`${clip.id}:embedded`);
    expect(span.assetId).toBe('video1');
    expect(span.videoClipId).toBe(clip.id);
    expect(span.gainDb).toBe(3);
    expect(span.fadeIn).toBe(1);
    expect(span.speed).toBe(1);
  });

  it('静音 / 素材明确没有音轨 / 非视频源 → null', () => {
    expect(spanFromVideoClip(videoClip(0, 1, { audio: { muted: true } }), true)).toBeNull();
    expect(spanFromVideoClip(videoClip(0, 1), false)).toBeNull();
    expect(
      spanFromVideoClip(
        { ...videoClip(0, 1), source: { type: 'image', assetId: 'img' } } as SourceClip,
        true,
      ),
    ).toBeNull();
  });
});

describe('audioSpans：工程级筛选', () => {
  it('视频自带声音 + 独立音频片段都进表', () => {
    const p = projectWith([videoClip(0, 2)], [audioClip(0, 1)]);
    const spans = audioSpans(p);
    expect(spans.map((s) => s.assetId).sort()).toEqual(['audio1', 'video1']);
  });

  it('分离后视频静音 → 只剩独立音频片段（不会重复出声）', () => {
    const v = videoClip(0, 2, { audio: { muted: true } });
    const p = projectWith([v], [audioClip(0, 2, { assetId: 'video1', linkedVideoId: v.id, lockedTo: v.id })]);
    const spans = audioSpans(p);
    expect(spans).toHaveLength(1);
    expect(spans[0]!.videoClipId).toBeUndefined();
  });

  it('轨道禁用 → 那一条轨上什么都不出声', () => {
    const p = projectWith([videoClip(0, 2)], [audioClip(0, 1)]);
    p.tracks[1]!.enabled = false;
    expect(audioSpans(p).map((s) => s.assetId)).toEqual(['video1']);

    p.tracks[0]!.enabled = false;
    expect(audioSpans(p)).toEqual([]);
  });

  it('asset.hasAudio === false → 不尝试解码', () => {
    const p = projectWith([videoClip(0, 2)], []);
    p.assets['video1']!.hasAudio = false;
    expect(audioSpans(p)).toEqual([]);
  });

  it('videoAudioAssetIds 去重，且只列视频素材', () => {
    const p = projectWith([videoClip(0, 2), videoClip(2, 4)], [audioClip(0, 1)]);
    expect(videoAudioAssetIds(p)).toEqual(['video1']);
  });
});

describe('gainDb 进唯一增益表达式', () => {
  it('-60 dB = 静音，0 dB = 1', () => {
    expect(dbToLinear(-60)).toBe(0);
    expect(dbToLinear(-120)).toBe(0);
    expect(dbToLinear(0)).toBe(1);
    expect(dbToLinear(6)).toBeCloseTo(1.995, 3);
  });

  it('音频片段上的 gainDb 作用在片段中段', () => {
    const clip = audioClip(0, 2, { gainDb: -6 });
    const g = audioClipGainAt(clip, { bpm: 120, offset: 0, beatsPerBar: 4 }, 1);
    expect(g).toBeCloseTo(dbToLinear(-6), 9);
  });

  it('视频内嵌音轨用同一份求值（span 结构兼容）', () => {
    const span = spanFromVideoClip(videoClip(0, 2, { audio: { gainDb: 0, fadeIn: 1 } }), true)!;
    expect(audioClipGainAt(span, { bpm: 120, offset: 0, beatsPerBar: 4 }, 0)).toBeCloseTo(0, 9);
    expect(audioClipGainAt(span, { bpm: 120, offset: 0, beatsPerBar: 4 }, 0.5)).toBeCloseTo(0.5, 9);
    expect(audioClipGainAt(span, { bpm: 120, offset: 0, beatsPerBar: 4 }, 1)).toBeCloseTo(1, 9);
  });
});

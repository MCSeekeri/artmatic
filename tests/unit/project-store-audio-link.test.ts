import { describe, expect, it } from 'vitest';
import { ProjectStore } from '../../src/core/project-store';
import { defaultProject, newId, type AudioClip, type Project, type SoundTrack, type SourceClip, type VisualTrack } from '../../src/core/schema';

/**
 * 视频音频分离 / 锁定（v13）的落库与几何同步。
 *
 * 链接同步是**在几何写操作里做的**（`liveMoveClip` / `liveResizeClip` /
 * `settleResize` / `splitClipAt` / 删除），所以必须逐条测：漏一条的表现是
 * 「拖动中不同步、松手跳一下」，或者「删了视频声音还在响」。
 */

function videoClip(start: number, end: number, srcIn = 0): SourceClip {
  const id = newId();
  return {
    kind: 'source',
    id,
    start,
    end,
    label: id,
    fadeSec: 0,
    curves: {},
    source: { type: 'video', assetId: 'video1', srcIn, speed: 1 },
    blend: 'normal',
    opacity: 1,
    transform: { x: 0.5, y: 0.5, sx: 1, sy: 1, rot: 0 },
    fit: 'cover',
  };
}

function projectWith(clips: SourceClip[]): Project {
  const p = defaultProject('音频链接');
  p.duration = 20;
  p.assets['video1'] = { id: 'video1', kind: 'video', name: 'v.mp4', durationSec: 20, hasAudio: true };
  p.tracks.push({ kind: 'visual', id: 'v1', name: 'V1', enabled: true, clips } as VisualTrack);
  return p;
}

function audioOf(store: ProjectStore, id: string): AudioClip {
  const clip = store.findClip(id)?.clip;
  if (!clip || clip.kind !== 'audio') throw new Error('不是音频片段');
  return clip;
}

function audioTrackOf(store: ProjectStore): SoundTrack {
  const t = store.project.tracks.find((x): x is SoundTrack => x.kind === 'audio');
  if (!t) throw new Error('没有音频轨');
  return t;
}

describe('detachVideoAudio', () => {
  it('建新音频轨 + 对齐音频片段 + 视频静音 + 双向链接，一笔撤销', () => {
    const v = videoClip(2, 6, 1);
    const store = new ProjectStore(projectWith([v]));
    const before = store.version;

    const audioId = store.detachVideoAudio(v.id)!;
    expect(audioId).toBeTruthy();
    expect(store.version).toBeGreaterThan(before);

    const track = audioTrackOf(store);
    expect(track.clips).toHaveLength(1);
    const a = track.clips[0]!;
    expect(a.start).toBe(2);
    expect(a.end).toBe(6);
    expect(a.srcIn).toBe(1);
    expect(a.assetId).toBe('video1');
    expect(a.linkedVideoId).toBe(v.id);
    expect(a.lockedTo).toBe(v.id);

    const video = store.findClip(v.id)!.clip as SourceClip;
    expect(video.linkedAudioId).toBe(a.id);
    expect(video.audio?.muted).toBe(true);

    // 一笔撤销全回去
    store.undo();
    expect(store.project.tracks.filter((t) => t.kind === 'audio')).toHaveLength(0);
    expect((store.findClip(v.id)!.clip as SourceClip).audio).toBeUndefined();
  });

  it('重复点击返回同一条，不造第二条声音', () => {
    const v = videoClip(0, 4);
    const store = new ProjectStore(projectWith([v]));
    const id = store.detachVideoAudio(v.id)!;
    expect(store.detachVideoAudio(v.id)).toBe(id);
    expect(audioTrackOf(store).clips).toHaveLength(1);
  });

  it('非视频片段 / 不存在的 id → null 且不写库', () => {
    const v = videoClip(0, 4);
    const store = new ProjectStore(projectWith([v]));
    const before = store.version;
    expect(store.detachVideoAudio('不存在')).toBeNull();
    expect(store.version).toBe(before);
  });
});

describe('锁定跟随', () => {
  function setup(): { store: ProjectStore; v: SourceClip; a: string } {
    const v = videoClip(2, 6, 0);
    const store = new ProjectStore(projectWith([v]));
    const a = store.detachVideoAudio(v.id)!;
    return { store, v, a };
  }

  it('移动视频：音频跟着走（拖动中同步，不是松手才动）', () => {
    const { store, v, a } = setup();
    store.liveMoveClip('v1', v.id, 5);
    expect(audioOf(store, a).start).toBe(5);
    expect(audioOf(store, a).end).toBe(9);
  });

  it('拉左边界：音频的 start / end / srcIn 一起变', () => {
    const { store, v, a } = setup();
    store.liveResizeClip('v1', v.id, 'start', 3);
    const audio = audioOf(store, a);
    expect(audio.start).toBe(3);
    expect(audio.end).toBe(6);
    expect(audio.srcIn).toBe(1);
  });

  it('解锁后不再跟随；重新锁定立刻对齐', () => {
    const { store, v, a } = setup();
    store.setAudioLocked(a, false);
    store.liveMoveClip('v1', v.id, 8);
    expect(audioOf(store, a).start).toBe(2);

    store.setAudioLocked(a, true);
    expect(audioOf(store, a).start).toBe(8);
    expect(audioOf(store, a).end).toBe(12);
  });
});

describe('分裂与删除', () => {
  it('分裂视频：音频一起切成两段，右半重新链接到右半视频', () => {
    const v = videoClip(0, 4);
    const store = new ProjectStore(projectWith([v]));
    const a = store.detachVideoAudio(v.id)!;

    expect(store.splitClipAt('v1', v.id, 2)).toBe(true);
    const videos = (store.project.tracks[0] as VisualTrack).clips as SourceClip[];
    expect(videos).toHaveLength(2);
    const audios = audioTrackOf(store).clips;
    expect(audios).toHaveLength(2);

    const left = audios.find((x) => x.start === 0)!;
    const right = audios.find((x) => x.start === 2)!;
    expect(left.id).toBe(a);
    expect(left.end).toBe(2);
    expect(right.end).toBe(4);
    expect(right.srcIn).toBe(2);
    expect(right.lockedTo).toBe(videos.find((x) => x.start === 2)!.id);
    expect(videos.find((x) => x.start === 2)!.linkedAudioId).toBe(right.id);
  });

  it('删除视频：分离出来的音频一起删掉', () => {
    const v = videoClip(0, 4);
    const store = new ProjectStore(projectWith([v]));
    const a = store.detachVideoAudio(v.id)!;
    store.removeClip(v.id);
    expect(store.findClip(a)).toBeNull();
    expect(store.project.tracks.filter((t) => t.kind === 'audio')[0]?.clips ?? []).toHaveLength(0);
  });

  it('删除音频片段：视频保持静音，但链接被清掉（可再次分离）', () => {
    const v = videoClip(0, 4);
    const store = new ProjectStore(projectWith([v]));
    const a = store.detachVideoAudio(v.id)!;
    store.removeClip(a);
    const video = store.findClip(v.id)!.clip as SourceClip;
    expect(video.linkedAudioId).toBeUndefined();
    expect(video.audio?.muted).toBe(true);
    expect(store.detachVideoAudio(v.id)).toBeTruthy();
  });
});

describe('片段音频参数', () => {
  it('增益 / 淡变 / 静音写进正确的字段', () => {
    const v = videoClip(0, 4);
    const store = new ProjectStore(projectWith([v]));
    const a = store.detachVideoAudio(v.id)!;

    store.setClipGainDb(a, -6);
    store.setClipAudioFade(a, 'in', 0.5);
    store.setClipAudioFade(a, 'out', 99); // 钳到片段长度
    const audio = audioOf(store, a);
    expect(audio.gainDb).toBe(-6);
    expect(audio.fadeIn).toBe(0.5);
    expect(audio.fadeOut).toBe(3.5);

    store.setClipGainDb(v.id, 3);
    store.setVideoAudioMuted(v.id, false);
    const video = store.findClip(v.id)!.clip as SourceClip;
    expect(video.audio?.gainDb).toBe(3);
    expect(video.audio?.muted).toBeUndefined();
  });

  it('0 dB 删掉字段（不留「改过」的假象）', () => {
    const v = videoClip(0, 4);
    const store = new ProjectStore(projectWith([v]));
    const a = store.detachVideoAudio(v.id)!;
    store.setClipGainDb(a, -6);
    store.setClipGainDb(a, 0);
    expect(audioOf(store, a).gainDb).toBeUndefined();
  });
});

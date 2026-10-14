import { describe, expect, it } from 'vitest';
import { clipsUsingAsset } from '../../src/ui/media-pool';
import { createBlankProject } from '../../src/core/demo-project';
import type { AudioClip, Project, SourceClip } from '../../src/core/schema';

/**
 * 素材引用检查（媒体池「移除素材」前的询问文案与计数用）。
 *
 * 这一条的判据必须**唯一**：UI 里另算一遍（比如只扫 image 源）的 bug 形态是
 * 「提示说没人用，删掉之后画面空了」—— 而漏掉哪一类都不会报错。
 */

const SOURCE_BASE = {
  fadeSec: 0,
  curves: {},
  blend: 'normal' as const,
  opacity: 1,
  transform: { x: 0.5, y: 0.5, sx: 1, sy: 1, rot: 0 },
  fit: 'contain' as const,
};

function imageClip(id: string, assetId: string): SourceClip {
  return { ...SOURCE_BASE, kind: 'source', id, start: 0, end: 2, label: id, source: { type: 'image', assetId } };
}

function videoClip(id: string, assetId: string): SourceClip {
  return {
    ...SOURCE_BASE,
    kind: 'source',
    id,
    start: 0,
    end: 2,
    label: id,
    source: { type: 'video', assetId, srcIn: 0, speed: 1 },
  };
}

function solidClip(id: string): SourceClip {
  return { ...SOURCE_BASE, kind: 'source', id, start: 0, end: 2, label: id, source: { type: 'solid', color: '#fff' } };
}

function audioClip(id: string, assetId: string): AudioClip {
  return { kind: 'audio', id, start: 0, end: 2, label: id, fadeSec: 0, curves: {}, assetId, srcIn: 0 };
}

function projectWith(clips: SourceClip[], audios: AudioClip[] = []): Project {
  const p = createBlankProject('t');
  const visual = p.tracks.find((t) => t.kind === 'visual');
  const sound = p.tracks.find((t) => t.kind === 'audio');
  if (visual?.kind !== 'visual' || sound?.kind !== 'audio') throw new Error('空白工程缺轨');
  visual.clips.push(...clips);
  sound.clips.push(...audios);
  return p;
}

describe('clipsUsingAsset', () => {
  it('图像 / 视频 / 音频三类引用都算数（漏一类的形态是「说没人用，删完画面空了」）', () => {
    const p = projectWith(
      [imageClip('i1', 'a1'), videoClip('v1', 'a1'), solidClip('s1'), imageClip('i2', 'other')],
      [audioClip('au1', 'a1')],
    );
    const used = clipsUsingAsset(p, 'a1');
    expect(used.map((u) => u.clipId).sort()).toEqual(['au1', 'i1', 'v1']);
    // 文案要用的轨道名也一起给出来
    expect(used.find((u) => u.clipId === 'i1')?.trackName).toBe(used[0]!.trackName);
  });

  it('没用到的素材返回空数组（solid 源与别的 assetId 都不算）', () => {
    const p = projectWith([solidClip('s1'), imageClip('i2', 'other')]);
    expect(clipsUsingAsset(p, 'a1')).toEqual([]);
  });
});

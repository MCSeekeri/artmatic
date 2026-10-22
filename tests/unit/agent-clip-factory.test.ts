/**
 * M1 的守卫之一（方案 §8）：**片段工厂的默认值必须完整**。
 *
 * 为什么值得一条测试：`addClip` 要一个字段完整的 `AnyClip`，少一个 `fadeSec`
 * 或 `curves` 时，报错点离调用点很远（`validateProject` 在保存时才炸）。
 * 所以判据就是「工厂产物直接塞进工程，`validateProject` 必须通过」。
 */

import { describe, expect, it } from 'vitest';
import { makeEffectClip, makeSourceClip } from '../../src/agent/clip-factory';
import { ControlFailure } from '../../src/agent/types';
import {
  defaultProject,
  validateProject,
  type EffectClip,
  type Project,
  type SourceClip,
  type VisualTrack,
} from '../../src/core/schema';

/** 视觉轨装不下 `AudioClip`，所以这里刻意不收 `AnyClip`（那会让测试掩盖类型错误）。 */
function projectWith(clip: SourceClip | EffectClip): Project {
  const p = defaultProject('factory');
  p.duration = 10;
  const track: VisualTrack = { kind: 'visual', id: 'v1', name: 'V1', enabled: true, clips: [clip] };
  p.tracks = [track];
  return p;
}

describe('makeSourceClip', () => {
  it('algo 源：默认值完整，直接过 validateProject', () => {
    const clip = makeSourceClip({
      kind: 'algo',
      generator: 'mandelbrot',
      params: { zoom: 0.5 },
      start: 0,
      end: 2,
      id: 'c1',
    });
    expect(clip.blend).toBe('normal');
    expect(clip.opacity).toBe(1);
    expect(clip.fit).toBe('contain');
    expect(clip.fadeSec).toBe(0);
    expect(clip.curves).toEqual({});
    expect(clip.transform).toEqual({ x: 0.5, y: 0.5, sx: 1, sy: 1, rot: 0 });
    expect(() => validateProject(projectWith(clip))).not.toThrow();
  });

  it('solid / image / video / text 四种源都要求各自必填的那个字段', () => {
    expect(() => makeSourceClip({ kind: 'image', start: 0, end: 1 })).toThrow(ControlFailure);
    expect(() => makeSourceClip({ kind: 'video', start: 0, end: 1 })).toThrow(ControlFailure);
    expect(() => makeSourceClip({ kind: 'text', start: 0, end: 1 })).toThrow(ControlFailure);
    // solid 的 color 有默认值，不需要给
    expect(makeSourceClip({ kind: 'solid', start: 0, end: 1 }).source).toEqual({
      type: 'solid',
      color: '#000000',
    });
  });

  it('video 的 srcIn / speed 被钳到合法区间（负偏移会让取帧逻辑读负时间）', () => {
    const clip = makeSourceClip({ kind: 'video', assetId: 'a', start: 0, end: 1, srcIn: -3, speed: 0 });
    expect(clip.source).toEqual({ type: 'video', assetId: 'a', srcIn: 0, speed: 1 });
  });

  it('显式 id 会被保留（agent 的脚本要能复跑）', () => {
    expect(makeSourceClip({ kind: 'solid', start: 0, end: 1, id: 'fixed' }).id).toBe('fixed');
  });

  it('不给 id 时自动生成一个非空 id', () => {
    expect(makeSourceClip({ kind: 'solid', start: 0, end: 1 }).id).toBeTruthy();
  });

  it('start / end 非法时抛 invalid-argument（而不是造出一个 validate 不过的片段）', () => {
    const bad = (start: number, end: number) => () => makeSourceClip({ kind: 'solid', start, end });
    expect(bad(-1, 1)).toThrow(ControlFailure);
    expect(bad(1, 1)).toThrow(ControlFailure);
    expect(bad(2, 1)).toThrow(ControlFailure);
    expect(bad(NaN, 1)).toThrow(ControlFailure);
  });

  it('缺省的 label 是有意义的那个值（不是空串 —— 空标签在时间轴上点不到）', () => {
    expect(makeSourceClip({ kind: 'algo', generator: 'mandelbrot', start: 0, end: 1 }).label).toBe('mandelbrot');
    expect(makeSourceClip({ kind: 'solid', color: '#123456', start: 0, end: 1 }).label).toBe('#123456');
  });
});

describe('makeEffectClip', () => {
  it('chain 里每一项都补上 instanceId / enabled / values', () => {
    const clip = makeEffectClip({
      start: 0,
      end: 2,
      chain: [{ defId: 'echo' }, { defId: 'slices', values: { count: 8 } }],
    });
    expect(clip.chain).toHaveLength(2);
    expect(clip.chain[0]!.instanceId).toBeTruthy();
    expect(clip.chain[0]!.enabled).toBe(true);
    expect(clip.chain[0]!.values).toEqual({});
    expect(clip.chain[1]!.values).toEqual({ count: 8 });
    expect(() => validateProject(projectWith(clip))).not.toThrow();
  });

  it('默认 label 是 effect（EffectClip 没有源类型可借）', () => {
    expect(makeEffectClip({ start: 0, end: 1 }).label).toBe('effect');
  });

  it('两个实例的 instanceId 不相同（同一片段上挂两个同类特效是常态）', () => {
    const clip = makeEffectClip({ start: 0, end: 1, chain: [{ defId: 'echo' }, { defId: 'echo' }] });
    expect(clip.chain[0]!.instanceId).not.toBe(clip.chain[1]!.instanceId);
  });

  it('boundClipId 写进工程；与 affectDepth 互斥（同时给直接拒绝）', () => {
    const clip = makeEffectClip({ start: 0, end: 1, boundClipId: 'src-1', chain: [{ defId: 'echo' }] });
    expect(clip.boundClipId).toBe('src-1');
    expect(clip.affectDepth).toBeUndefined();
    expect(() =>
      makeEffectClip({ start: 0, end: 1, boundClipId: 'src-1', affectDepth: 1 }),
    ).toThrow();
  });
});

describe('纯色片段的默认 fit（反馈第 4 条）', () => {
  it('solid 默认 stretch：源是 1×1 纹理，contain 会画成居中的正方形', () => {
    const clip = makeSourceClip({ kind: 'solid', start: 0, end: 1 });
    expect(clip.fit).toBe('stretch');
  });

  it('其它源仍然默认 contain（图片/视频的「完整可见」是既有语义）', () => {
    const clip = makeSourceClip({ kind: 'image', start: 0, end: 1, assetId: 'a' });
    expect(clip.fit).toBe('contain');
    // 显式给值永远优先。
    expect(makeSourceClip({ kind: 'solid', start: 0, end: 1, fit: 'cover' }).fit).toBe('cover');
  });
});

import { describe, expect, it } from 'vitest';
import { upsertCurveKey } from '../../src/ui/clip-edit';
import type { AnyClip, SourceClip } from '../../src/core/schema';
import type { BeatGrid } from '../../src/core/time';

const GRID: BeatGrid = { bpm: 120, offset: 0, beatsPerBar: 4 };

function clip(extra: Partial<SourceClip> = {}): SourceClip {
  return {
    id: 'c',
    start: 2,
    end: 10,
    label: 'c',
    fadeSec: 0,
    curves: {},
    kind: 'source',
    source: { type: 'solid', color: '#000' },
    blend: 'normal',
    opacity: 1,
    transform: { x: 0.5, y: 0.5, sx: 1, sy: 1, rot: 0 },
    fit: 'contain',
    ...extra,
  };
}

describe('upsertCurveKey', () => {
  it('新建曲线：第一个 key 是 linear，t 相对片段起点', () => {
    const c = clip();
    upsertCurveKey(c as AnyClip, 'opacity', 0.5, 3, null, GRID);
    expect(c.curves.opacity!.keys).toEqual([{ t: 1, v: 0.5, interp: 'linear' }]);
    expect(c.curves.opacity!.beatAnchor).toBeNull();
  });

  it('播放头处已有 key：只改值，保留 interp / 手柄', () => {
    const c = clip({
      curves: {
        opacity: {
          keys: [{ t: 1, v: 0.5, interp: 'step', hOut: [0.2, 0.1], hIn: [-0.2, -0.1] }],
        },
      },
    });
    upsertCurveKey(c as AnyClip, 'opacity', 0.9, 3, null, GRID);
    const keys = c.curves.opacity!.keys;
    expect(keys).toHaveLength(1);
    expect(keys[0]).toMatchObject({ t: 1, v: 0.9, interp: 'step' });
    expect(keys[0]!.hOut).toEqual([0.2, 0.1]);
    expect(keys[0]!.hIn).toEqual([-0.2, -0.1]);
  });

  it('锚到拍：t 相对锚定拍，而不是片段起点', () => {
    const c = clip();
    // 120BPM：第 4 拍 = 2s；绝对时刻 3s → 局部 t = 1
    upsertCurveKey(c as AnyClip, 'opacity', 0.5, 3, { beat: 4 }, GRID);
    expect(c.curves.opacity!.keys[0]!.t).toBeCloseTo(1, 9);
    expect(c.curves.opacity!.beatAnchor).toEqual({ beat: 4 });
  });
});

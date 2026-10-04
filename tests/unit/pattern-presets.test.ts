import { describe, expect, it } from 'vitest';
import { PATTERN_PRESETS, getPatternPreset, presetBitmap, presetParamValue } from '../../src/algos/pattern-presets';
import { bitmapToRows, decodePattern, liveCount } from '../../src/algos/pattern-codec';

describe('图案预设', () => {
  it('每个预设都能解出位图，且活格数等于 ASCII 里 # 的个数', () => {
    for (const p of PATTERN_PRESETS) {
      const bm = presetBitmap(p.id);
      expect(bm, p.id).not.toBeNull();
      const hashes = p.rows.join('').split('').filter((c) => c === '#').length;
      expect(liveCount(bm!), p.id).toBe(hashes);
    }
  });

  it('id 唯一（重复的 id 会让 Map 静默丢掉一个）', () => {
    const ids = PATTERN_PRESETS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('滑翔机是那个 5 格的三连体', () => {
    const rows = bitmapToRows(presetBitmap('glider')!);
    expect(rows).toEqual(['.#.', '..#', '###']);
    expect(liveCount(presetBitmap('glider')!)).toBe(5);
  });

  it('滑翔机枪是 36×9（36 宽才能装下两端的反射块）', () => {
    const bm = presetBitmap('gospersGun')!;
    expect(bm.w).toBe(36);
    expect(bm.h).toBe(9);
    expect(liveCount(bm)).toBe(36);
  });

  it('Diehard 是 7 个细胞 —— 130 代后完全消失的那个构造', () => {
    expect(liveCount(presetBitmap('diehard')!)).toBe(7);
  });

  it('presetParamValue 产出的串能原样解回来（存进 params 的那条路）', () => {
    const s = presetParamValue('pulsar');
    expect(s.length).toBeGreaterThan(0);
    const round = decodePattern(s);
    expect(round).not.toBeNull();
    expect(liveCount(round!)).toBe(liveCount(presetBitmap('pulsar')!));
  });

  it('未知 id 返回 null / 空串（不抛）', () => {
    expect(presetBitmap('nope')).toBeNull();
    expect(presetParamValue('nope')).toBe('');
    expect(getPatternPreset('nope')).toBeNull();
  });
});

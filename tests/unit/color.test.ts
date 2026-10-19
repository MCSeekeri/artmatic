import { describe, expect, it } from 'vitest';
import { hexToRgb, rgbToHex } from '../../src/core/color';

describe('hex ↔ rgb', () => {
  it('支持 #rgb / #rrggbb，失败返回 null', () => {
    expect(hexToRgb('#0af')).toEqual({ r: 0, g: 170, b: 255 });
    expect(hexToRgb('FFFFFF')).toEqual({ r: 255, g: 255, b: 255 });
    expect(hexToRgb('#12345')).toBeNull();
    expect(hexToRgb('zzzzzz')).toBeNull();
  });

  it('rgbToHex 钳制越界，并把 NaN / Infinity 落到 0', () => {
    expect(rgbToHex({ r: 0, g: 170, b: 255 })).toBe('#00aaff');
    expect(rgbToHex({ r: -10, g: 999, b: 12.6 })).toBe('#00ff0d');
    // 吸管路径可能给 NaN（readPixels 越界）；绝不能写进 `#NaNNaNNaN`
    expect(rgbToHex({ r: Number.NaN, g: Number.POSITIVE_INFINITY, b: 12 })).toBe('#00000c');
  });
});

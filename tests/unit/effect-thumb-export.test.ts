import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SHOT_HEIGHT,
  SHOT_HEIGHTS,
  SHOT_QUALITY,
  safeFilename,
  shotFilename,
} from '../../lab/export-thumbs';
import { thumbSize } from '../../src/render/effect-thumb-renderer';

/**
 * 导出截图的两件「纯」东西：尺寸换算与文件名。
 *
 * 它们值得单测是因为**出错时都不报错**：宽度算成奇数只会让图看起来糊一点，
 * 文件名里有冒号会让下载静默失败（或者变成浏览器的 `_` 替换），
 * 而这两件事在 E2E 里都很贵（要真跑一次导出）。
 */

describe('thumbSize：由高度定尺寸', () => {
  it('16:9，宽度取偶', () => {
    expect(thumbSize(128)).toEqual({ w: 228, h: 128 });
    expect(thumbSize(180)).toEqual({ w: 320, h: 180 });
    expect(thumbSize(256)).toEqual({ w: 456, h: 256 });
    // 默认档 = 仓库里现有的资源尺寸（640×360），必须逐字对上，
    // 否则「重新导出一次」与「仓库里的那套」就不是同一个东西了。
    expect(thumbSize(DEFAULT_SHOT_HEIGHT)).toEqual({ w: 640, h: 360 });
  });

  it('任何高度都得到偶数宽度（JPEG 色度子采样与下游布局都省事）', () => {
    for (let h = 17; h <= 400; h += 1) {
      expect(thumbSize(h).w % 2, `h=${h}`).toBe(0);
    }
  });

  it('退化输入被夹住，不产生 0 或负数', () => {
    for (const h of [0, -5, 1, 2, NaN]) {
      const s = thumbSize(h);
      expect(s.h).toBeGreaterThanOrEqual(16);
      expect(s.w).toBeGreaterThanOrEqual(16);
      expect(Number.isFinite(s.w)).toBe(true);
    }
  });

  it('档位都是正整数，且默认值在档位里', () => {
    for (const h of SHOT_HEIGHTS) {
      expect(Number.isInteger(h)).toBe(true);
      expect(h).toBeGreaterThan(0);
    }
    expect(SHOT_HEIGHTS).toContain(DEFAULT_SHOT_HEIGHT);
  });

  it('质量是个有意义的取值（既不是「无损」也不是「糊」）', () => {
    // 太低会把缩略图压出块状，太高则整套体积逼近 PNG —— 两头都在浪费
    expect(SHOT_QUALITY).toBeGreaterThan(0.7);
    expect(SHOT_QUALITY).toBeLessThan(0.95);
  });
});

describe('文件名消毒', () => {
  it('特效 id 是恒等变换', () => {
    for (const id of ['bleach', 'channel-split-prism', 'kino-datamosh', 'transform-3d']) {
      expect(safeFilename(id)).toBe(id);
    }
  });

  it('回退到源 id 时把冒号这类非法字符换掉（`lab:grid`）', () => {
    expect(safeFilename('lab:grid')).toBe('lab-grid');
    expect(safeFilename('a/b\\c')).toBe('a-b-c');
    expect(safeFilename('  spaces  ')).toBe('spaces');
  });

  it('全是非法字符时给一个兜底名字，绝不返回空串', () => {
    expect(safeFilename('///')).toBe('shot');
    expect(safeFilename('')).toBe('shot');
  });

  it('截图文件名 = 特效 id（有特效时），否则回退源 id', () => {
    expect(shotFilename('bleach', 'lab:grid')).toBe('bleach.png');
    expect(shotFilename(null, 'lab:grid')).toBe('lab-grid.png');
  });
});

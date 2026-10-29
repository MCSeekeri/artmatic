import { describe, expect, it } from 'vitest';
import { intResSize } from '../../src/algos/int-res';

/**
 * `intResSize` 的表驱动测试。
 *
 * 这条纯函数同时修了两个东西，两个都必须钉住：
 * 1. **宽高比取自渲染目标**。旧写法 `w = round(res * 16 / 9)` 让竖屏工程的 3D
 *    被按 16:9 渲染再 letterbox —— 画面里两条黑边，参数面板上毫无异常。
 * 2. **`auto` 跟渲染目标一样大**。固定 480 行时 1080p 导出等于 2.25 倍放大，
 *    这是 3D 画质的第一杠杆。
 */
describe('intResSize', () => {
  it('auto 就是渲染目标尺寸（16:9）', () => {
    expect(intResSize('auto', 1920, 1080)).toEqual({ w: 1920, h: 1080 });
    expect(intResSize('auto', 960, 540)).toEqual({ w: 960, h: 540 });
  });

  it('auto 在竖屏下按渲染宽高比出图，不强制 16:9', () => {
    // 1080x1920 → 高度撞 1440 的上界，宽度按比例跟着缩
    expect(intResSize('auto', 1080, 1920)).toEqual({ w: 810, h: 1440 });
  });

  it('固定档只固定高度，宽度仍然跟渲染宽高比', () => {
    expect(intResSize('480', 1920, 1080)).toEqual({ w: 853, h: 480 });
    // 4:3 工程不该出现 16:9 的内部缓冲
    expect(intResSize('480', 1024, 768)).toEqual({ w: 640, h: 480 });
  });

  it('高度封顶在 1440（4K 导出不会无限加价）', () => {
    const s = intResSize('auto', 4096, 2160);
    expect(s.h).toBe(1440);
    expect(s.w).toBe(Math.round(1440 * (4096 / 2160)));
  });

  it('高度有下界，脏值退回 480 而不是 NaN', () => {
    expect(intResSize('120', 1920, 1080)).toEqual({ w: 427, h: 240 });
    expect(intResSize('', 1920, 1080)).toEqual({ w: 853, h: 480 });
    expect(intResSize('bogus', 1920, 1080)).toEqual({ w: 853, h: 480 });
    expect(intResSize('0', 1920, 1080)).toEqual({ w: 853, h: 480 });
  });

  it('渲染目标还没量出来时按 16:9 兜底', () => {
    expect(intResSize('auto', 0, 0)).toEqual({ w: 853, h: 480 });
    expect(intResSize('720', 0, 0)).toEqual({ w: 1280, h: 720 });
  });
});

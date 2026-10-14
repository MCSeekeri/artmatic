import { describe, expect, it } from 'vitest';
import {
  centeredImageFrame,
  createImageElement,
  defaultImageFrame,
  defaultShapeFrame,
} from '../../src/typography/document';

/**
 * 图片置入的默认框与默认 fit。
 *
 * 判据是用户报的那一条：「图片置入：默认情况下会被裁切」——
 * 一张 16:9 的图默认放进 1080×1080 的方块里、配上 `cover`，两侧必被裁掉。
 * 所以这里钉两件事：**框按原比例**、**fit 默认 contain**。
 */

const DOC = { w: 1920, h: 1080 };

describe('defaultImageFrame', () => {
  it('正方形图 = 原来的形状方块（不改变既有观感）', () => {
    expect(defaultImageFrame(DOC, 256, 256)).toEqual(defaultShapeFrame(DOC));
  });

  it('横图：长边仍是短边的 30%，另一边按比例收', () => {
    const f = defaultImageFrame(DOC, 1600, 900); // 16:9
    expect(f.w).toBe(324); // min(1920,1080) × 0.3
    expect(f.h).toBe(182); // 324 / (16/9) ≈ 182.25
    expect(f.w / f.h).toBeCloseTo(16 / 9, 1);
  });

  it('竖图：翻转过来（长边给高度）', () => {
    const f = defaultImageFrame(DOC, 900, 1600);
    expect(f.h).toBe(324);
    expect(f.w).toBe(182);
  });

  it('未知尺寸（未解码 / 0 / 负数）退回正方块，不猜比例', () => {
    const square = defaultShapeFrame(DOC);
    expect(defaultImageFrame(DOC, 0, 0)).toEqual(square);
    expect(defaultImageFrame(DOC, Number.NaN, 100)).toEqual(square);
    expect(defaultImageFrame(DOC, -10, 100)).toEqual(square);
  });

  it('居中', () => {
    const f = defaultImageFrame(DOC, 1600, 900);
    expect(f.x + f.w / 2).toBeCloseTo(DOC.w / 2, 0);
    expect(f.y + f.h / 2).toBeCloseTo(DOC.h / 2, 0);
  });

  it('带落点的版本以落点为中心（粘贴 / 拖放）', () => {
    const f = centeredImageFrame(DOC, 400, 300, 1600, 900);
    expect(Math.round(f.x + f.w / 2)).toBe(400);
    expect(Math.round(f.y + f.h / 2)).toBe(300);
  });
});

describe('createImageElement', () => {
  it('默认 fit 是 contain（不裁切），框按给出的原图比例', () => {
    const el = createImageElement(DOC, 'a1', { name: 'p.png', natural: { w: 1600, h: 900 } });
    expect(el.fit).toBe('contain');
    expect(el.frame.w).toBe(324);
    expect(el.frame.h).toBe(182);
  });

  it('没给 natural 时用正方块，但 fit 仍是 contain', () => {
    const el = createImageElement(DOC, 'a1', { name: 'p.png' });
    expect(el.fit).toBe('contain');
    expect(el.frame).toEqual(defaultShapeFrame(DOC));
  });

  it('显式给的 frame / fit 优先（用户自己拖过的不该被默认值盖掉）', () => {
    const frame = { x: 1, y: 2, w: 3, h: 4, rot: 0 };
    const el = createImageElement(DOC, 'a1', { frame, fit: 'cover' });
    expect(el.frame).toEqual(frame);
    expect(el.fit).toBe('cover');
  });
});

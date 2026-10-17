import { describe, expect, it } from 'vitest';
import { defaultKeySettings, identityQuad } from '../../src/core/image-fx';
import type { ImageElement } from '../../src/typography/document';
import {
  fxKey,
  fxRasterSize,
  imageNeedsFx,
  objectFitRect,
} from '../../src/typography/image-fx';

/**
 * 排版图片元素的 fx 纯函数：`object-fit` 落点、位图尺寸夹取、缓存键、是否走 canvas。
 *
 * 渲染本身（逐像素色键 / 单应重采样）由 E2E 的像素断言守；这里守的是
 * 「算错了不会报错、只会静默变形」的那一层。
 */

function img(over: Partial<ImageElement> = {}): ImageElement {
  return {
    id: 'el',
    name: 'img',
    kind: 'image',
    assetId: 'a1',
    fit: 'contain',
    frame: { x: 0, y: 0, w: 400, h: 300, rot: 0 },
    blend: 'normal',
    opacity: 1,
    visible: true,
    locked: false,
    animations: [],
    ...over,
  };
}

describe('objectFitRect', () => {
  it('fill 拉满', () => {
    expect(objectFitRect(200, 100, 400, 300, 'fill')).toEqual({ x: 0, y: 0, w: 400, h: 300 });
  });

  it('contain 等比装入并居中（上下留边）', () => {
    // 2:1 放进 4:3 的盒子：宽度撑满，高度 200
    expect(objectFitRect(200, 100, 400, 300, 'contain')).toEqual({
      x: 0,
      y: 50,
      w: 400,
      h: 200,
    });
  });

  it('cover 等比铺满并居中（左右被裁）', () => {
    // 2:1 铺 4:3：高度撑满 300 → 宽 600，左右各溢出 100
    expect(objectFitRect(200, 100, 400, 300, 'cover')).toEqual({
      x: -100,
      y: 0,
      w: 600,
      h: 300,
    });
  });

  it('none 用原始像素尺寸居中', () => {
    expect(objectFitRect(200, 100, 400, 300, 'none')).toEqual({
      x: 100,
      y: 100,
      w: 200,
      h: 100,
    });
  });

  it('任何一边为 0 一律 null（坏图不画，不猜比例）', () => {
    expect(objectFitRect(0, 100, 400, 300, 'contain')).toBeNull();
    expect(objectFitRect(200, 100, 0, 300, 'contain')).toBeNull();
  });
});

describe('fxRasterSize', () => {
  it('常规尺寸按元素框取整', () => {
    expect(fxRasterSize(img({ frame: { x: 0, y: 0, w: 400.4, h: 300.6, rot: 0 } }))).toEqual({
      w: 400,
      h: 301,
    });
  });

  it('长边超过上限时等比缩小（保持宽高比）', () => {
    const s = fxRasterSize(img({ frame: { x: 0, y: 0, w: 8192, h: 4096, rot: 0 } }));
    expect(Math.max(s.w, s.h)).toBe(4096);
    expect(s.w / s.h).toBeCloseTo(2, 2);
  });

  it('极小尺寸不会变成 0', () => {
    const s = fxRasterSize(img({ frame: { x: 0, y: 0, w: 0.2, h: 0.2, rot: 0 } }));
    expect(s.w).toBeGreaterThanOrEqual(1);
    expect(s.h).toBeGreaterThanOrEqual(1);
  });
});

describe('imageNeedsFx', () => {
  it('没有 key / quad → 走普通 img', () => {
    expect(imageNeedsFx(img())).toBe(false);
  });

  it('有 key → 走 canvas', () => {
    expect(imageNeedsFx(img({ key: defaultKeySettings() }))).toBe(true);
  });

  it('quad 恒等 → 仍走 img（与引擎 u_quadOn = 0 同一判据）', () => {
    expect(imageNeedsFx(img({ quad: identityQuad() }))).toBe(false);
  });

  it('quad 非恒等 → 走 canvas', () => {
    const q = identityQuad();
    q.tl = [0.1, 0.1];
    expect(imageNeedsFx(img({ quad: q }))).toBe(true);
  });
});

describe('fxKey', () => {
  const url = 'blob:probe';

  it('同样的输入 → 同样的键（缓存能命中）', () => {
    expect(fxKey(img(), url)).toBe(fxKey(img(), url));
  });

  it('每个影响像素的输入都会换键', () => {
    const base = fxKey(img(), url);
    expect(fxKey(img({ fit: 'cover' }), url)).not.toBe(base);
    expect(fxKey(img({ crop: { x: 0.1, y: 0, w: 0.5, h: 1 } }), url)).not.toBe(base);
    expect(fxKey(img({ frame: { x: 0, y: 0, w: 401, h: 300, rot: 0 } }), url)).not.toBe(base);
    expect(fxKey(img({ key: defaultKeySettings() }), url)).not.toBe(base);
    expect(fxKey(img(), 'blob:other')).not.toBe(base);
  });

  it('抠图参数变化 → 换键；恒等 quad 与没有 quad 视为同一件事', () => {
    const k = defaultKeySettings();
    const a = fxKey(img({ key: k }), url);
    const b = fxKey(img({ key: { ...k, tolerance: 0.4 } }), url);
    expect(a).not.toBe(b);
    // 恒等 quad 写进数据也不该换键：渲染走的是同一条 img 路径。
    expect(fxKey(img({ quad: identityQuad() }), url)).toBe(fxKey(img(), url));
  });
});

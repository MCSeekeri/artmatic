import { describe, expect, it } from 'vitest';
import {
  animationsEquivalent,
  applyElementAnimations,
  applyElementFormat,
  cloneAnimations,
} from '../../src/typography/format-painter';
import {
  createImageElement,
  createShapeElement,
  createTextElement,
  type TypographyElement,
} from '../../src/typography/document';
import { createTracksAnimation } from '../../src/typography/animation';

const SIZE = { w: 1920, h: 1080 };

function rect(over: Parameters<typeof createShapeElement>[2] = {}) {
  return createShapeElement(SIZE, 'rect', over);
}
function text(over: Parameters<typeof createTextElement>[1] = {}) {
  return createTextElement(SIZE, over);
}
function image(over: Parameters<typeof createImageElement>[2] = {}) {
  return createImageElement(SIZE, 'asset-a', over);
}

/** 深拷贝后再跑断言：确认「原地改」的只有目标。 */
const snap = (el: TypographyElement): string => JSON.stringify(el);

describe('applyElementFormat：图形 → 图形', () => {
  it('填充 / 描边 / 圆角 / 阴影 / 虚化都刷过去', () => {
    const src = rect({
      fill: {
        kind: 'linear',
        angle: 30,
        stops: [
          { color: '#ff0000', offset: 0 },
          { color: '#0000ff', offset: 1 },
        ],
      },
      stroke: { color: '#00ff00', width: 7, style: 'dashed' },
      radius: 18,
      shadows: [{ color: '#000', dx: 0.1, dy: 0.1, blur: 0.2 }],
      blur: 4,
    });
    const tgt = rect({ fill: { kind: 'solid', color: '#123456' }, stroke: null });
    expect(applyElementFormat(src, tgt)).toBe(true);
    expect(tgt.fill).toEqual(src.fill);
    expect(tgt.stroke).toEqual(src.stroke);
    expect(tgt.radius).toBe(18);
    expect(tgt.shadows).toEqual(src.shadows);
    expect(tgt.blur).toBe(4);
    // 副本，不是同一份引用（改目标不会改到源）
    expect(tgt.fill).not.toBe(src.fill);
  });

  it('不搬内容 / 几何 / 图层属性', () => {
    const src = rect({ name: '源', frame: { x: 999, y: 999, w: 10, h: 10, rot: 1 }, opacity: 0.3 });
    const tgt = rect({ name: '目标', frame: { x: 10, y: 20, w: 30, h: 40, rot: 0 }, opacity: 0.9 });
    applyElementFormat(src, tgt);
    expect(tgt.name).toBe('目标');
    expect(tgt.frame).toEqual({ x: 10, y: 20, w: 30, h: 40, rot: 0 });
    expect(tgt.opacity).toBe(0.9);
    expect(tgt.id).not.toBe(src.id);
  });

  it('源没有 imageFill ⇒ 目标的 imageFill 被清掉（否则刚刷的纯色填充被盖住）', () => {
    const src = rect({ fill: { kind: 'solid', color: '#abcdef' } });
    const tgt = rect({ imageFill: { assetId: 'a', fit: 'cover' } });
    applyElementFormat(src, tgt);
    expect(tgt.imageFill).toBeUndefined();
    expect(tgt.fill).toEqual({ kind: 'solid', color: '#abcdef' });
  });

  it('源有 imageFill ⇒ 连它一起搬，且 fill 也带过去（清掉后能用）', () => {
    const src = rect({ imageFill: { assetId: 'img', fit: 'contain' } });
    const tgt = rect();
    applyElementFormat(src, tgt);
    expect(tgt.imageFill).toEqual({ assetId: 'img', fit: 'contain' });
    expect(tgt.imageFill).not.toBe(src.imageFill);
  });

  it('自己刷自己：什么都不做', () => {
    const el = rect();
    expect(applyElementFormat(el, el)).toBe(false);
  });
});

describe('applyElementFormat：图形 ↔ 文本框', () => {
  it('图形的填充 / 描边落到文本框的**底**上，字形样式不动', () => {
    const src = rect({
      fill: { kind: 'solid', color: '#222222' },
      stroke: { color: '#eeeeee', width: 3, style: 'solid' },
      radius: 12,
    });
    const tgt = text({ text: 'hello' });
    const before = JSON.stringify(tgt.style);
    expect(applyElementFormat(src, tgt)).toBe(true);
    expect(tgt.boxFill).toEqual({ kind: 'solid', color: '#222222' });
    expect(tgt.boxStroke).toEqual({ color: '#eeeeee', width: 3, style: 'solid' });
    // 文本样式与字形填充不属于「图形的外观」
    expect(JSON.stringify(tgt.style)).toBe(before);
    expect(tgt.fill).toBeUndefined();
    // 圆角在文本框上不存在 → 静默跳过
    expect(tgt).not.toHaveProperty('radius');
  });

  it('文本框的 boxFill / boxStroke 反向落到图形上', () => {
    const src = text({
      boxFill: { kind: 'solid', color: '#445566' },
      boxStroke: { color: '#778899', width: 5, style: 'dotted' },
    });
    const tgt = rect({ fill: { kind: 'solid', color: '#000000' } });
    expect(applyElementFormat(src, tgt)).toBe(true);
    expect(tgt.fill).toEqual({ kind: 'solid', color: '#445566' });
    expect(tgt.stroke).toEqual({ color: '#778899', width: 5, style: 'dotted' });
  });

  it('文本框没有 boxFill 时图形保留自己的填充（缺失字段静默跳过）', () => {
    const plain = text(); // 默认没有 boxFill / boxStroke
    const tgt = rect({ fill: { kind: 'solid', color: '#010203' }, stroke: null });
    expect(applyElementFormat(plain, tgt)).toBe(false);
    expect(tgt.fill).toEqual({ kind: 'solid', color: '#010203' });
    expect(tgt.stroke).toBeNull();
  });

  it('图形带 imageFill 时不去改文本框的底（那是图片，不是填充色）', () => {
    const src = rect({ imageFill: { assetId: 'x', fit: 'cover' } });
    const tgt = text();
    applyElementFormat(src, tgt);
    expect(tgt.boxFill).toBeUndefined();
  });
});

describe('applyElementFormat：文本 → 文本', () => {
  it('整块排版样式与字形填充 / 描边一起过去', () => {
    const src = text({
      style: {
        ...createTextElement(SIZE).style,
        fontFamily: 'Inter',
        fontSize: 96,
        color: '#ff00ff',
        align: 'center',
      },
      fill: {
        kind: 'linear',
        angle: 90,
        stops: [
          { color: '#fff', offset: 0 },
          { color: '#000', offset: 1 },
        ],
      },
      glyphStroke: { color: '#00ffff', width: 3, style: 'solid' },
      boxFill: { kind: 'solid', color: '#101010' },
    });
    const tgt = text({ text: 'other' });
    expect(applyElementFormat(src, tgt)).toBe(true);
    expect(tgt.style.fontFamily).toBe('Inter');
    expect(tgt.style.fontSize).toBe(96);
    expect(tgt.style.color).toBe('#ff00ff');
    expect(tgt.fill).toEqual(src.fill);
    expect(tgt.glyphStroke).toEqual(src.glyphStroke);
    expect(tgt.boxFill).toEqual({ kind: 'solid', color: '#101010' });
    // 内容不搬
    expect(tgt.runs).toEqual(text({ text: 'other' }).runs);
  });

  it('源没有字形填充 ⇒ 清掉目标的（刷成一样，不是叠加）', () => {
    const src = text();
    const tgt = text({
      fill: { kind: 'solid', color: '#999999' },
      glyphStroke: { color: '#888888', width: 2, style: 'solid' },
    });
    applyElementFormat(src, tgt);
    expect(tgt.fill).toBeUndefined();
    expect(tgt.glyphStroke).toBeUndefined();
  });
});

describe('applyElementFormat：图片', () => {
  it('图片的各项处理都搬，assetId 不搬', () => {
    const src = image({
      fit: 'cover',
      radius: 20,
      crop: { x: 0.1, y: 0.2, w: 0.5, h: 0.5 },
      key: { enabled: true } as never,
      quad: { tl: [0, 0], tr: [1, 0], br: [1, 1], bl: [0, 1] },
      border: { width: 4, color: '#ffffff' } as never,
      filter: { preset: 'warm', strength: 1 } as never,
    });
    const tgt = image();
    expect(applyElementFormat(src, tgt)).toBe(true);
    expect(tgt.assetId).toBe('asset-a');
    expect(tgt.fit).toBe('cover');
    expect(tgt.radius).toBe(20);
    expect(tgt.crop).toEqual({ x: 0.1, y: 0.2, w: 0.5, h: 0.5 });
    expect(tgt.quad).toEqual(src.quad);
    expect(tgt.quad).not.toBe(src.quad);
    expect(tgt.border).toEqual(src.border);
    expect(tgt.filter).toEqual(src.filter);
  });

  it('源没有的处理项 ⇒ 清掉目标的', () => {
    const src = image();
    const tgt = image({ crop: { x: 0.1, y: 0.1, w: 0.2, h: 0.2 }, radius: 9 });
    applyElementFormat(src, tgt);
    expect(tgt.crop).toBeUndefined();
    expect(tgt.radius).toBeUndefined();
  });

  it('图片 ↔ 图形只交换圆角（其余各自保留）', () => {
    const src = image({ radius: 14, fit: 'cover' });
    const tgt = rect({ fill: { kind: 'solid', color: '#000000' }, radius: 0 });
    expect(applyElementFormat(src, tgt)).toBe(true);
    expect(tgt.radius).toBe(14);
    expect(tgt.fill).toEqual({ kind: 'solid', color: '#000000' });
    expect(tgt).not.toHaveProperty('fit');
  });
});

describe('动画刷', () => {
  const anims = (prop: 'opacity' | 'y') => [
    createTracksAnimation(
      `k-${prop}`,
      prop,
      [
        { t: 0, v: prop === 'opacity' ? 0 : 40 },
        { t: 0.6, v: prop === 'opacity' ? 1 : 0 },
      ],
      { easing: 'ease-out' },
    ),
  ];

  it('cloneAnimations：换新 id、深拷贝、Infinity 不丢', () => {
    const src = anims('opacity');
    src[0]!.iterations = Infinity;
    const out = cloneAnimations(src);
    expect(out).toHaveLength(1);
    expect(out[0]!.id).not.toBe(src[0]!.id);
    expect(out[0]!.iterations).toBe(Infinity);
    expect(out[0]!.id).toMatch(/./);
    // 深拷贝：改副本的关键帧不影响源
    (out[0] as { keys: { t: number }[] }).keys[0]!.t = 99;
    expect((src[0] as { keys: { t: number }[] }).keys[0]!.t).toBe(0);
  });

  it('整份替换目标的动画', () => {
    const src = rect({ animations: anims('opacity') });
    const tgt = rect({ animations: anims('y') });
    expect(applyElementAnimations(src, tgt)).toBe(true);
    expect(tgt.animations).toHaveLength(1);
    expect((tgt.animations[0] as { prop: string }).prop).toBe('opacity');
    expect(tgt.animations[0]!.id).not.toBe(src.animations[0]!.id);
  });

  it('源没有动画 ⇒ 清空目标', () => {
    const src = rect();
    const tgt = rect({ animations: anims('opacity') });
    expect(applyElementAnimations(src, tgt)).toBe(true);
    expect(tgt.animations).toEqual([]);
  });

  it('两边都没有动画 / 内容本来就一样 ⇒ 不动（不开空撤销）', () => {
    expect(applyElementAnimations(rect(), rect())).toBe(false);
    const a = rect({ animations: anims('opacity') });
    const b = rect({ animations: cloneAnimations(a.animations) });
    expect(animationsEquivalent(a.animations, b.animations)).toBe(true);
    expect(applyElementAnimations(a, b)).toBe(false);
  });

  it('自己刷自己：什么都不做', () => {
    const el = rect({ animations: anims('opacity') });
    expect(applyElementAnimations(el, el)).toBe(false);
  });
});

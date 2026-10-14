import { describe, expect, it } from 'vitest';
import {
  collectGlyphs,
  createImageElement,
  createShapeElement,
  createTextElement,
  createTypographyDocument,
  elementById,
  elementsByIds,
  removeElements,
  reorderElements,
  resizeDocument,
  usedFontFamilies,
  usedFonts,
  type FontRef,
  type TypographyDocument,
} from '../../src/typography/document';
import { createPresetAnimation } from '../../src/typography/animation';

function doc(ids: string[]): TypographyDocument {
  const d = createTypographyDocument({ w: 1000, h: 500 });
  d.elements = ids.map((id, i) => createTextElement(d.size, { id, text: `t${i}` }));
  return d;
}

function order(d: TypographyDocument): string[] {
  return d.elements.map((e) => e.id);
}

describe('createTypographyDocument', () => {
  it('尺寸取整并钳到最小 2px', () => {
    expect(createTypographyDocument({ w: 1280.6, h: 719.4 }).size).toEqual({ w: 1281, h: 719 });
    expect(createTypographyDocument({ w: 0, h: -10 }).size).toEqual({ w: 2, h: 2 });
  });

  it('空文档没有元素、没有字体、没有背景', () => {
    const d = createTypographyDocument({ w: 100, h: 100 });
    expect(d.elements).toEqual([]);
    expect(d.fonts).toEqual([]);
    expect(d.background).toEqual({ kind: 'none' });
  });
});

describe('元素工厂', () => {
  it('文本框默认居中、宽占 80%、高占 16%', () => {
    const d = createTypographyDocument({ w: 1000, h: 500 });
    const el = createTextElement(d.size);
    expect(el.frame.w).toBe(800);
    expect(el.frame.h).toBe(80);
    expect(el.frame.x).toBe(100);
    expect(el.frame.y).toBe(210);
    expect(el.frame.rot).toBe(0);
    expect(el.autoHeight).toBe(true);
  });

  it('字号跟随文档高度', () => {
    const small = createTextElement({ w: 1280, h: 720 }).style.fontSize;
    const big = createTextElement({ w: 1920, h: 1080 }).style.fontSize;
    expect(big).toBeGreaterThan(small);
    expect(small).toBe(65);
    expect(big).toBe(97);
  });

  it('显式 id 被尊重（测试与缓存需要可控的 id）', () => {
    expect(createTextElement({ w: 100, h: 100 }, { id: 'fixed' }).id).toBe('fixed');
  });

  it('文本默认**没有**字形填充 —— 纯色字形仍走 style.color', () => {
    const el = createTextElement({ w: 1000, h: 500 });
    expect(el.fill).toBeUndefined();
    expect(el.style.color).toBeTruthy();
  });

  it('直线默认只描边：填充 none + 有描边，否则它什么都看不见', () => {
    const d = createTypographyDocument({ w: 1000, h: 500 });
    const line = createShapeElement(d.size, 'line');
    expect(line.fill).toEqual({ kind: 'none' });
    expect(line.stroke).not.toBeNull();
    // 高度被压成细条，否则「直线」会是一个占满方框的色块
    expect(line.frame.h).toBe(2);
  });

  it('普通图形默认有填充、无描边', () => {
    const d = createTypographyDocument({ w: 1000, h: 500 });
    const rect = createShapeElement(d.size, 'rect');
    expect(rect.fill.kind).toBe('solid');
    expect(rect.stroke).toBeNull();
  });

  it('图片元素带 assetId 与默认适配', () => {
    const d = createTypographyDocument({ w: 1000, h: 500 });
    const img = createImageElement(d.size, 'asset-1');
    expect(img.assetId).toBe('asset-1');
    // 默认不裁切（用户报的「图片置入默认被裁切」）—— 见 image-frame.test.ts
    expect(img.fit).toBe('contain');
  });
});

describe('elementById / elementsByIds / removeElements', () => {
  it('elementById 返回文档里的**真实对象**，不是拷贝', () => {
    const d = doc(['a']);
    const found = elementById(d, 'a');
    expect(found).toBe(d.elements[0]);
    found!.frame.x = 42;
    expect(d.elements[0]!.frame.x).toBe(42);
  });

  it('elementsByIds 保序（按文档顺序，不按传入顺序）', () => {
    const d = doc(['a', 'b', 'c']);
    expect(elementsByIds(d, ['c', 'a']).map((e) => e.id)).toEqual(['a', 'c']);
  });

  it('removeElements 是纯函数，不改原文档', () => {
    const d = doc(['a', 'b']);
    const next = removeElements(d, ['a']);
    expect(order(next)).toEqual(['b']);
    expect(order(d)).toEqual(['a', 'b']);
  });
});

describe('reorderElements', () => {
  it('front / back 保持被选元素的相对顺序', () => {
    const d = doc(['a', 'b', 'c', 'd']);
    expect(order(reorderElements(d, ['b', 'd'], 'front'))).toEqual(['a', 'c', 'b', 'd']);
    expect(order(reorderElements(d, ['b', 'd'], 'back'))).toEqual(['b', 'd', 'a', 'c']);
  });

  it('forward：整批选中时净位移恰好一层', () => {
    // 这是最容易写错的一条：遍历方向不对的话，被选中的元素会互相推挤，
    // 结果 [a,c,b] 之后 a 又去换 c，净位移被吃掉。
    expect(order(reorderElements(doc(['a', 'b', 'c']), ['a', 'b'], 'forward'))).toEqual(['c', 'a', 'b']);
  });

  it('backward：整批选中时净位移恰好一层', () => {
    expect(order(reorderElements(doc(['a', 'b', 'c']), ['b', 'c'], 'backward'))).toEqual(['b', 'c', 'a']);
  });

  it('单元素 forward / backward 只走一层', () => {
    expect(order(reorderElements(doc(['a', 'b', 'c']), ['b'], 'forward'))).toEqual(['a', 'c', 'b']);
    expect(order(reorderElements(doc(['a', 'b', 'c']), ['b'], 'backward'))).toEqual(['b', 'a', 'c']);
  });

  it('已在两端时不动（越界不抛错）', () => {
    expect(order(reorderElements(doc(['a', 'b']), ['b'], 'forward'))).toEqual(['a', 'b']);
    expect(order(reorderElements(doc(['a', 'b']), ['a'], 'backward'))).toEqual(['a', 'b']);
  });

  it('空选择集不改动', () => {
    expect(order(reorderElements(doc(['a', 'b']), [], 'front'))).toEqual(['a', 'b']);
  });
});

describe('resizeDocument', () => {
  it('按比例缩放所有 frame', () => {
    const d = doc(['a']);
    d.elements[0]!.frame = { x: 100, y: 50, w: 200, h: 100, rot: 0 };
    const next = resizeDocument(d, { w: 500, h: 250 });
    expect(next.size).toEqual({ w: 500, h: 250 });
    expect(next.elements[0]!.frame).toEqual({ x: 50, y: 25, w: 100, h: 50, rot: 0 });
  });

  it('字号按 min(sx, sy) 缩放，不按各轴分别缩', () => {
    // 只把宽度翻倍时字号**不该**跟着翻倍 —— 文字没有「横向拉伸」这种语义，
    // 各轴分别缩会得到被压扁或被撑开的字。
    const d = doc(['a']);
    d.elements[0]!.frame = { x: 0, y: 0, w: 100, h: 100, rot: 0 };
    const next = resizeDocument(d, { w: 2000, h: 500 });
    const before = d.elements[0]!;
    const after = next.elements[0]!;
    if (before.kind !== 'text' || after.kind !== 'text') throw new Error('unreachable');
    expect(after.style.fontSize).toBe(before.style.fontSize);
  });

  it('描边宽度跟着缩放', () => {
    const d = createTypographyDocument({ w: 1000, h: 1000 });
    d.elements = [createShapeElement(d.size, 'rect', { stroke: { color: '#fff', width: 10 } })];
    const next = resizeDocument(d, { w: 500, h: 500 });
    const el = next.elements[0]!;
    if (el.kind !== 'shape') throw new Error('unreachable');
    expect(el.stroke!.width).toBe(5);
  });

  it('不改原文档', () => {
    const d = doc(['a']);
    const before = JSON.stringify(d);
    resizeDocument(d, { w: 111, h: 222 });
    expect(JSON.stringify(d)).toBe(before);
  });
});

describe('collectGlyphs', () => {
  it('去重 + 按码点排序 —— 否则打字顺序不同会导致缓存键不同', () => {
    const d = createTypographyDocument({ w: 100, h: 100 });
    d.elements = [
      createTextElement(d.size, { text: 'ba' }),
      createTextElement(d.size, { text: 'ab' }),
    ];
    expect(collectGlyphs(d)).toBe('ab');
  });

  it('结果与输入顺序无关', () => {
    const mk = (texts: string[]) => {
      const d = createTypographyDocument({ w: 100, h: 100 });
      d.elements = texts.map((t) => createTextElement(d.size, { text: t }));
      return collectGlyphs(d);
    };
    expect(mk(['汉字', 'abc'])).toBe(mk(['abc', '汉字']));
  });

  it('代理对（emoji / 生僻字）不被切碎', () => {
    // 用 .length 索引遍历会把它切成两个孤立代理，产出无效码点。
    const d = createTypographyDocument({ w: 100, h: 100 });
    d.elements = [createTextElement(d.size, { text: 'a😀b' })];
    const glyphs = collectGlyphs(d);
    expect([...glyphs].length).toBe(3);
    expect(glyphs.includes('\u{1F600}')).toBe(true);
    // 不能出现落单的代理码元
    for (const ch of glyphs) {
      const cp = ch.codePointAt(0)!;
      expect(cp >= 0xd800 && cp <= 0xdfff).toBe(false);
    }
  });

  it('非文本元素不参与（图形 / 图片没有字形）', () => {
    const d = createTypographyDocument({ w: 100, h: 100 });
    d.elements = [createShapeElement(d.size, 'rect'), createImageElement(d.size, 'x')];
    expect(collectGlyphs(d)).toBe('');
  });
});

describe('字体引用', () => {
  const font = (family: string): FontRef => ({
    id: `f-${family}`,
    family,
    format: 'sfnt',
    source: { kind: 'builtin' },
  });

  it('usedFontFamilies 按出现顺序去重', () => {
    const d = createTypographyDocument({ w: 100, h: 100 });
    d.elements = [
      createTextElement(d.size, { style: { ...createTextElement(d.size).style, fontFamily: 'B' } }),
      createTextElement(d.size, { style: { ...createTextElement(d.size).style, fontFamily: 'A' } }),
      createTextElement(d.size, { style: { ...createTextElement(d.size).style, fontFamily: 'B' } }),
    ];
    expect(usedFontFamilies(d)).toEqual(['B', 'A']);
  });

  it('usedFonts 只保留被引用的字体', () => {
    const d = createTypographyDocument({ w: 100, h: 100 });
    d.fonts = [font('A'), font('Unused')];
    d.elements = [createTextElement(d.size, { style: { ...createTextElement(d.size).style, fontFamily: 'A' } })];
    expect(usedFonts(d).map((f) => f.family)).toEqual(['A']);
  });
});

describe('动画挂在元素上', () => {
  it('新增元素默认无动画', () => {
    const d = createTypographyDocument({ w: 100, h: 100 });
    expect(createTextElement(d.size).animations).toEqual([]);
  });

  it('工厂可以带动画', () => {
    const d = createTypographyDocument({ w: 100, h: 100 });
    const a = createPresetAnimation('fade-in', 'an1');
    expect(createTextElement(d.size, { animations: [a] }).animations).toHaveLength(1);
  });
});

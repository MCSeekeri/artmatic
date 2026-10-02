import { describe, expect, it } from 'vitest';
import {
  docHash,
  fnv1a,
  frameKeyFor,
  rasterKey,
  rasterKeyForDoc,
  stableStringify,
} from '../../src/typography/cache-key';
import { createTextElement, createTypographyDocument } from '../../src/typography/document';
import type { TypographyDocument } from '../../src/typography/document';
import { createPresetAnimation } from '../../src/typography/animation';

describe('stableStringify', () => {
  it('对象键顺序不影响结果', () => {
    expect(stableStringify({ b: 1, a: 2 })).toBe(stableStringify({ a: 2, b: 1 }));
  });

  it('嵌套对象同理', () => {
    expect(stableStringify({ o: { y: 1, x: 2 } })).toBe(stableStringify({ o: { x: 2, y: 1 } }));
  });

  it('数组顺序**是**有意义的，不排序', () => {
    expect(stableStringify([1, 2])).not.toBe(stableStringify([2, 1]));
  });

  it('null / 基本类型正常', () => {
    expect(stableStringify(null)).toBe('null');
    expect(stableStringify(3)).toBe('3');
    expect(stableStringify('a')).toBe('"a"');
  });

  it('undefined 值的键被跳过（JSON 语义）', () => {
    expect(stableStringify({ a: 1, b: undefined })).toBe(stableStringify({ a: 1 }));
  });
});

describe('fnv1a', () => {
  it('确定性', () => {
    expect(fnv1a('hello')).toBe(fnv1a('hello'));
  });

  it('不同输入不同输出', () => {
    expect(fnv1a('hello')).not.toBe(fnv1a('hellp'));
  });

  it('定长 8 位十六进制', () => {
    expect(fnv1a('anything')).toMatch(/^[0-9a-f]{8}$/);
    expect(fnv1a('')).toMatch(/^[0-9a-f]{8}$/);
  });
});

describe('docHash', () => {
  it('键顺序不同的同一文档指纹相同', () => {
    const a = { size: { w: 10, h: 10 }, background: { kind: 'none' }, elements: [], fonts: [] };
    const b = { fonts: [], elements: [], background: { kind: 'none' }, size: { w: 10, h: 10 } };
    expect(docHash(a as never)).toBe(docHash(b as never));
  });

  it('内容变化 → 指纹变化', () => {
    const d1 = createTypographyDocument({ w: 100, h: 100 });
    d1.elements = [createTextElement(d1.size, { id: 'e', text: 'A' })];
    const d2 = createTypographyDocument({ w: 100, h: 100 });
    d2.elements = [createTextElement(d2.size, { id: 'e', text: 'B' })];
    expect(docHash(d1)).not.toBe(docHash(d2));
  });

  it('元素顺序变化 → 指纹变化（z 序是内容的一部分）', () => {
    const mk = (first: string) => {
      const d = createTypographyDocument({ w: 100, h: 100 });
      d.elements = [
        createTextElement(d.size, { id: first }),
        createTextElement(d.size, { id: first === 'a' ? 'b' : 'a' }),
      ];
      return d;
    };
    expect(docHash(mk('a'))).not.toBe(docHash(mk('b')));
  });

  it('同内容构造两次 → 指纹相同', () => {
    const mk = (): TypographyDocument => ({
      size: { w: 100, h: 100 },
      background: { kind: 'none' },
      elements: [],
      fonts: [],
    });
    expect(docHash(mk())).toBe(docHash(mk()));
  });
});

describe('rasterKey', () => {
  it('格式稳定：docHash|WxH|frame', () => {
    expect(rasterKey({ docHash: 'abcd1234', w: 960, h: 540, frame: 12 })).toBe('abcd1234|960x540|12');
  });

  it('静态文档（frame = null）用 - 占位', () => {
    expect(rasterKey({ docHash: 'abcd1234', w: 960, h: 540, frame: null })).toBe('abcd1234|960x540|-');
  });

  it('尺寸进键 —— 预览与导出的缓存天然分离', () => {
    const a = rasterKey({ docHash: 'x', w: 960, h: 540, frame: null });
    const b = rasterKey({ docHash: 'x', w: 1920, h: 1080, frame: null });
    expect(a).not.toBe(b);
  });

  it('帧号进键 —— 动画文档不会跨帧错命中', () => {
    expect(rasterKey({ docHash: 'x', w: 100, h: 100, frame: 1 }))
      .not.toBe(rasterKey({ docHash: 'x', w: 100, h: 100, frame: 2 }));
  });
});

describe('rasterKeyForDoc', () => {
  it('按文档内容算键，与手工组装的等价', () => {
    const d = createTypographyDocument({ w: 100, h: 100 });
    expect(rasterKeyForDoc(d, 200, 200, null)).toBe(
      rasterKey({ docHash: docHash(d), w: 200, h: 200, frame: null }),
    );
  });
});

describe('frameKeyFor', () => {
  it('静态文档返回 null —— 整个片段只光栅化一次', () => {
    // 带上帧号会让标题卡每帧重做一遍，这是最容易犯的性能错误。
    const d = createTypographyDocument({ w: 100, h: 100 });
    d.elements = [createTextElement(d.size)];
    expect(frameKeyFor(d, 0)).toBeNull();
    expect(frameKeyFor(d, 999)).toBeNull();
  });

  it('动画文档把帧号带进去', () => {
    const d = createTypographyDocument({ w: 100, h: 100 });
    d.elements = [createTextElement(d.size, { animations: [createPresetAnimation('fade-in', 'a')] })];
    expect(frameKeyFor(d, 7)).toBe(7);
  });
});

describe('缓存不该被无关改动击穿', () => {
  it('同一份文档引用，读两次得到同一个键', () => {
    // docHash 只哈希文档本身，不掺 store 的全局 version；
    // 否则改一下别的片段的名字就会把所有排版缓存清空。
    const d = createTypographyDocument({ w: 100, h: 100 });
    d.elements = [createTextElement(d.size)];
    expect(rasterKeyForDoc(d, 100, 100, null)).toBe(rasterKeyForDoc(d, 100, 100, null));
  });
});

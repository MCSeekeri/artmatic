import { describe, expect, it } from 'vitest';
import {
  addGeneratedShape,
  addShapeElement,
  addTextElement,
  applyLayout,
  coerceDocument,
  coercePaint,
  docView,
  findTextDoc,
  groupSelection,
  patchElement,
  removeElement,
  reorderElement,
  setTheme,
  ungroupSelection,
} from '../../src/typography/agent-ops';
import { createTypographyDocument, type TypographyDocument } from '../../src/typography/document';
import { SVG_GENERATORS } from '../../src/typography/svg-gen/registry';
import { defaultProject } from '../../src/core/schema';

function doc(size = { w: 1920, h: 1080 }): TypographyDocument {
  return createTypographyDocument(size);
}

describe('排版写入原语', () => {
  it('加文字：frame / 样式 / 文本都能落进去', () => {
    const d = doc();
    const el = addTextElement(d, {
      text: '标题',
      frame: { x: 100, y: 80, w: 600, h: 120 },
      style: { fontSize: 96, fontWeight: 800, align: 'left' },
    });
    expect(d.elements).toHaveLength(1);
    expect(el.runs.flatMap((r) => r.text).join('')).toBe('标题');
    expect(el.frame).toMatchObject({ x: 100, y: 80, w: 600, h: 120 });
    expect(el.style.fontSize).toBe(96);
    expect(el.style.align).toBe('left');
  });

  it('尺寸钳到 ≥1，坐标保留两位小数', () => {
    const d = doc();
    const el = addTextElement(d, { text: 'x', frame: { w: 0, h: -5, x: 1.23456 } });
    expect(el.frame.w).toBe(1);
    expect(el.frame.h).toBe(1);
    expect(el.frame.x).toBe(1.23);
  });

  it('加图形：未知 shape 抛错（在校验期，不在渲染期）', () => {
    const d = doc();
    expect(() => addShapeElement(d, { shape: 'not-a-shape' })).toThrow();
    expect(d.elements).toHaveLength(0);
  });

  it('程序化图形自带 gen 状态，路径非空', () => {
    const d = doc();
    const spec = SVG_GENERATORS[0]!;
    const el = addGeneratedShape(d, { genId: spec.id, seed: 42 });
    expect(el.shape).toBe('svg');
    expect(el.path && el.path.length > 0).toBe(true);
    expect(el.gen?.id).toBe(spec.id);
    expect(el.gen?.seed).toBe(42);
    // 全量参数（合并默认值后）都落库，跨版本可复现
    expect(Object.keys(el.gen?.params ?? {}).length).toBe(spec.params.length);
  });

  it('未知生成器抛错', () => {
    const d = doc();
    expect(() => addGeneratedShape(d, { genId: 'nope' })).toThrow();
  });

  it('patch：未知键被忽略，文本可以替换', () => {
    const d = doc();
    const el = addTextElement(d, { text: 'old' });
    expect(patchElement(d, el.id, { notAField: 1 })).toBe(false);
    expect(patchElement(d, el.id, { text: 'new' })).toBe(true);
    expect(el.runs.flatMap((r) => r.text).join('')).toBe('new');
  });

  it('patch：opacity / blend / frame 都有钳制', () => {
    const d = doc();
    const el = addTextElement(d, { text: 'x' });
    patchElement(d, el.id, { opacity: 5, blend: 'multiply', frame: { rot: 0.5 } });
    expect(el.opacity).toBe(1);
    expect(el.blend).toBe('multiply');
    expect(el.frame.rot).toBe(0.5);
  });

  it('层级调整保持单元素语义', () => {
    const d = doc();
    const a = addTextElement(d, { text: 'a' });
    const b = addTextElement(d, { text: 'b' });
    expect(reorderElement(d, a.id, 'front')).toBe(true);
    expect(d.elements[d.elements.length - 1]!.id).toBe(a.id);
    expect(d.elements[0]!.id).toBe(b.id);
  });

  it('删元素与主题切换', () => {
    const d = doc();
    const el = addTextElement(d, { text: 'x' });
    expect(removeElement(d, el.id)).toBe(true);
    expect(d.elements).toHaveLength(0);
    setTheme(d, 'office');
    expect(d.theme).toBe('office');
  });
});

describe('布局', () => {
  it('grid 把元素摆进等宽格子（保持尺寸）', () => {
    const d = doc({ w: 1000, h: 1000 });
    const els = [0, 1, 2, 3].map((i) =>
      addTextElement(d, { text: `t${i}`, frame: { w: 100, h: 50, x: 0, y: 0 } }),
    );
    const moved = applyLayout(d, { op: 'grid', cols: 2, gap: 20, margin: 40 });
    expect(moved).toBe(4);
    expect(els[0]!.frame.x).toBeLessThan(els[1]!.frame.x);
    // 同一行（0/1）y 相同，下一行（2）更大
    expect(els[0]!.frame.y).toBe(els[1]!.frame.y);
    expect(els[2]!.frame.y).toBeGreaterThan(els[0]!.frame.y);
    expect(els[0]!.frame.w).toBe(100);
    // 所有元素都落在画布内
    for (const el of els) {
      expect(el.frame.x).toBeGreaterThanOrEqual(0);
      expect(el.frame.y).toBeGreaterThanOrEqual(0);
      expect(el.frame.x + el.frame.w).toBeLessThanOrEqual(1000);
    }
  });

  it('align center-h 把元素对准画布中线', () => {
    const d = doc({ w: 1000, h: 1000 });
    const el = addTextElement(d, { text: 'x', frame: { x: 10, y: 10, w: 200, h: 100 } });
    applyLayout(d, { op: 'align', axis: 'center-h', elementIds: [el.id] });
    expect(el.frame.x).toBe(400);
  });

  it('distribute 少于 3 个元素时不动', () => {
    const d = doc();
    const a = addTextElement(d, { text: 'a' });
    addTextElement(d, { text: 'b' });
    expect(applyLayout(d, { op: 'distribute', axis: 'h' })).toBe(0);
    expect(a.frame.x).toBeGreaterThanOrEqual(0);
  });

  it('锁定的元素不参与布局', () => {
    const d = doc({ w: 1000, h: 1000 });
    const el = addTextElement(d, { text: 'x', frame: { x: 0, y: 0, w: 100, h: 100 } });
    el.locked = true;
    applyLayout(d, { op: 'align', axis: 'center-h' });
    expect(el.frame.x).toBe(0);
  });
});

describe('组合', () => {
  it('成组 → 成员连续 → 解组', () => {
    const d = doc();
    const a = addTextElement(d, { text: 'a' });
    addTextElement(d, { text: 'b' });
    const c = addTextElement(d, { text: 'c' });
    const gid = groupSelection(d, [a.id, c.id], 'G');
    expect(gid).toBeTruthy();
    expect(d.groups?.some((g) => g.id === gid)).toBe(true);
    expect(ungroupSelection(d, [a.id])).toBe(true);
    expect(d.groups?.length ?? 0).toBe(0);
  });
});

describe('视图', () => {
  it('ids 档只给 id / kind / name / frame', () => {
    const d = doc();
    addTextElement(d, { text: 'hello' });
    const view = docView(d, 'clip-1', 'ids');
    expect(view.elements).toHaveLength(1);
    const el = view.elements[0] as Record<string, unknown>;
    expect(Object.keys(el).sort()).toEqual(['frame', 'id', 'kind', 'name']);
  });

  it('full 档带文本、样式与背景', () => {
    const d = doc();
    addTextElement(d, { text: 'hello' });
    const view = docView(d, 'clip-1', 'full');
    const el = view.elements[0] as Record<string, unknown>;
    expect(el.text).toBe('hello');
    expect(el.style).toBeTruthy();
    expect(view.background).toBeTruthy();
  });
});

describe('不可信文档的降级', () => {
  it('坏元素被丢弃，不是整份失败', () => {
    const fallback = doc();
    const out = coerceDocument(
      {
        size: { w: 800, h: 600 },
        elements: [
          { kind: 'text', text: 'ok', frame: { x: 0, y: 0, w: 100, h: 40 } },
          { kind: 'shape', shape: 'not-a-shape' },
          { kind: 'image' }, // 缺 assetId
          'garbage',
          { kind: 'bogus' },
        ],
      },
      fallback,
    );
    expect(out.size).toEqual({ w: 800, h: 600 });
    expect(out.elements).toHaveLength(1);
    expect(out.elements[0]!.kind).toBe('text');
  });

  it('空白文档回落 fallback，不抛', () => {
    const fallback = doc();
    expect(coerceDocument(null, fallback)).toBe(fallback);
    expect(coerceDocument([1, 2, 3], fallback)).toBe(fallback);
  });

  it('Paint 的坏 shape 降级成 none（不抛）', () => {
    expect(coercePaint({ kind: 'wat' })).toEqual({ kind: 'none' });
    expect(coercePaint(null)).toEqual({ kind: 'none' });
    expect(coercePaint({ kind: 'solid', color: '#ff0000' })).toEqual({ kind: 'solid', color: '#ff0000' });
  });
});

describe('findTextDoc', () => {
  it('从工程里定位文本片段的文档', () => {
    const project = defaultProject();
    const textDoc = doc();
    const track = {
      id: 'track-1',
      kind: 'visual' as const,
      name: 'V1',
      enabled: true,
      clips: [
        {
          kind: 'source' as const,
          id: 'clip-text',
          start: 0,
          end: 2,
          label: 'text',
          fadeSec: 0,
          curves: {},
          source: { type: 'text' as const, doc: textDoc },
          blend: 'normal' as const,
          opacity: 1,
          transform: { x: 0.5, y: 0.5, sx: 1, sy: 1, rot: 0 },
          fit: 'contain' as const,
        },
      ],
    };
    project.tracks.push(track);
    expect(findTextDoc(project, 'clip-text')).toBe(textDoc);
    expect(findTextDoc(project, 'nope')).toBeNull();
  });
});

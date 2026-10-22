import { describe, expect, it } from 'vitest';
import { addShapeElement, addTextElement } from '../../src/typography/agent-ops';
import { createTypographyDocument, type TypographyDocument } from '../../src/typography/document';
import {
  applyBoolean,
  applyDivide,
  applyTextToPath,
  buildTextOutlineShapes,
  canBoolean,
  convertShapeToPath,
} from '../../src/typography/shape-convert';

/**
 * 几何改写（转路径 / 布尔 / 拆分 / 文本轮廓落成图形）。
 *
 * 这几段原先是 `ui/typography/actions.ts` 里的私有函数 —— agent 够不着，正是
 * 根 AGENTS §1.9 要消灭的形态。搬进纯模块之后控制平面与编辑器共用同一份，
 * 这里钉住的是「几何与 z 序的语义」。
 */

function doc(): TypographyDocument {
  return createTypographyDocument({ w: 800, h: 600 });
}

function rect(d: TypographyDocument, x: number, y: number, w = 100, h = 100) {
  return addShapeElement(d, { shape: 'rect', frame: { x, y, w, h }, fill: { kind: 'solid', color: '#ffffff' } });
}

describe('参数化图形转路径', () => {
  it('就地转成 svg，写 0..100 authored，并清掉形状参数', () => {
    const d = doc();
    const el = addShapeElement(d, { shape: 'rect', radius: 12, frame: { x: 0, y: 0, w: 200, h: 100 } });
    expect(convertShapeToPath(el)).toBe(true);
    expect(el.shape).toBe('svg');
    expect(el.path).toBeTruthy();
    expect(el.radius).toBeUndefined();
    // 已经是 svg 的不再转（幂等，不产生一笔空改动）。
    expect(convertShapeToPath(el)).toBe(false);
  });

  it('圆环的洞跟着搬（evenOdd），否则一次转换就变成实心盘', () => {
    const d = doc();
    const el = addShapeElement(d, { shape: 'ring' });
    expect(convertShapeToPath(el)).toBe(true);
    expect(el.evenOdd).toBe(true);
  });
});

describe('布尔运算', () => {
  it('并集：产出一个新元素、操作数消失、z 位置沿用最上面那个', () => {
    const d = doc();
    const a = rect(d, 0, 0);
    const b = rect(d, 50, 50);
    const c = rect(d, 300, 0);
    expect(canBoolean(d, [a.id, b.id])).toBe(true);

    const id = applyBoolean(d, [a.id, b.id], 'union');
    expect(id).toBeTruthy();
    expect(d.elements.map((e) => e.id)).not.toContain(a.id);
    expect(d.elements.map((e) => e.id)).not.toContain(b.id);
    expect(d.elements.map((e) => e.id)).toContain(c.id);
    // b 在最上面：结果落在它的位置（a、b 之间那段没有别的元素，所以是 index 0）。
    const fresh = d.elements.find((e) => e.id === id)!;
    expect(fresh.kind === 'shape' && fresh.shape).toBe('svg');
    expect(fresh.kind === 'shape' && fresh.animations).toEqual([]);
    expect(d.elements.indexOf(fresh)).toBe(0);
  });

  it('差集以最底下那个为被减数（后画的挖掉先画的）', () => {
    const d = doc();
    const bottom = rect(d, 0, 0, 200, 200);
    const top = rect(d, 100, 0, 200, 200);
    const id = applyBoolean(d, [top.id, bottom.id], 'difference')!;
    const fresh = d.elements.find((e) => e.id === id)!;
    // 被减数 200×200 在左、减数吃掉右半：结果是左侧 100×200。
    expect(fresh.frame.x).toBeCloseTo(0, 3);
    expect(fresh.frame.w).toBeCloseTo(100, 3);
  });

  it('交集为空 = 返回 null 且不改文档（不能留下一个空图形）', () => {
    const d = doc();
    const a = rect(d, 0, 0);
    const b = rect(d, 500, 400);
    const before = JSON.stringify(d.elements);
    expect(applyBoolean(d, [a.id, b.id], 'intersection')).toBeNull();
    expect(JSON.stringify(d.elements)).toBe(before);
  });

  it('少于两个图形 / 锁定的图形不参与', () => {
    const d = doc();
    const a = rect(d, 0, 0);
    const b = rect(d, 50, 50);
    b.locked = true;
    expect(canBoolean(d, [a.id, b.id])).toBe(false);
    expect(applyBoolean(d, [a.id, b.id], 'union')).toBeNull();
  });
});

describe('拆分', () => {
  it('重叠区域切成互不重叠的片，每片沿用盖在它上面的操作数的外观', () => {
    const d = doc();
    const a = addShapeElement(d, {
      shape: 'rect',
      frame: { x: 0, y: 0, w: 200, h: 200 },
      fill: { kind: 'solid', color: '#ff0000' },
    });
    const b = addShapeElement(d, {
      shape: 'rect',
      frame: { x: 100, y: 0, w: 200, h: 200 },
      fill: { kind: 'solid', color: '#0000ff' },
    });
    const ids = applyDivide(d, [a.id, b.id]);
    expect(ids.length).toBeGreaterThanOrEqual(2);
    const pieces = d.elements.filter((e) => ids.includes(e.id));
    expect(pieces).toHaveLength(ids.length);
    // 只有 A 的那一片是红的、重叠与 B 独有是蓝的。
    const colors = pieces.map((p) => (p.kind === 'shape' && p.fill.kind === 'solid' ? p.fill.color : null));
    expect(colors).toContain('#ff0000');
    expect(colors).toContain('#0000ff');
  });

  it('没有重叠时每个操作数各自成一片（拆的是「区域的排布」，不是只拆交集）', () => {
    const d = doc();
    const a = rect(d, 0, 0);
    const b = rect(d, 500, 400);
    const ids = applyDivide(d, [a.id, b.id]);
    expect(ids).toHaveLength(2);
    expect(d.elements).toHaveLength(2);
    // 两片的并集覆盖原有两个矩形（位置与尺寸不变）。
    const boxes = d.elements
      .filter((e) => ids.includes(e.id))
      .map((e) => ({ x: Math.round(e.frame.x), y: Math.round(e.frame.y), w: Math.round(e.frame.w) }))
      .sort((p, q) => p.x - q.x);
    expect(boxes).toEqual([
      { x: 0, y: 0, w: 100 },
      { x: 500, y: 400, w: 100 },
    ]);
  });
});

describe('文本轮廓落成图形', () => {
  const items = [
    { role: 'glyph' as const, paint: { kind: 'solid' as const, color: '#ffffff' }, d: 'M0 0L10 0L10 10Z' },
    { role: 'glyph' as const, paint: { kind: 'solid' as const, color: '#ff0000' }, d: 'M20 0L30 0L30 10Z' },
  ];

  it('第一个产物沿用源 id，多个时包进一个 padding:0 的组', () => {
    const d = doc();
    const text = addTextElement(d, { text: 'AB', frame: { x: 10, y: 20, w: 200, h: 80 } });
    const ids = applyTextToPath(d, text.id, items, []);
    expect(ids).toHaveLength(2);
    expect(ids[0]).toBe(text.id);
    expect(d.elements.some((e) => e.id === text.id && e.kind === 'shape')).toBe(true);
    expect(d.groups).toHaveLength(1);
    expect(d.groups![0]!.padding).toBe(0);
    expect(d.groups![0]!.name).toBe(text.name);

    const [first, second] = ids.map((id) => d.elements.find((e) => e.id === id)!);
    expect(first!.kind === 'shape' && first!.pathUnit).toBe('px');
    expect(first!.kind === 'shape' && first!.clipFrame).toBe(true);
    // 同一个组，但动画 id 各自独立。
    expect(first!.groupId).toBeTruthy();
    expect(second!.groupId).toBe(first!.groupId);
  });

  it('源元素本来就在组里：不再套一层（组合是扁平的）', () => {
    const d = doc();
    const text = addTextElement(d, { text: 'AB' });
    text.groupId = 'g-existing';
    d.groups = [{ id: 'g-existing', name: 'g', fill: { kind: 'none' }, stroke: null, radius: 0, padding: 8 }];
    applyTextToPath(d, text.id, items, []);
    expect(d.groups).toHaveLength(1);
    expect(d.elements.every((e) => e.groupId === 'g-existing')).toBe(true);
  });

  it('单个产物不建组', () => {
    const d = doc();
    const text = addTextElement(d, { text: 'A' });
    applyTextToPath(d, text.id, [items[0]!], []);
    expect(d.groups ?? []).toHaveLength(0);
  });

  it('阴影分角色：字形拿全部，文本框底色只拿元素阴影', () => {
    const d = doc();
    const text = addTextElement(d, { text: 'A' });
    text.shadows = [{ color: '#000', dx: 0, dy: 2, blur: 4 }];
    const shapes = buildTextOutlineShapes(
      text,
      [
        { role: 'box', paint: { kind: 'solid', color: '#111111' }, d: 'M0 0L10 0L10 10Z' },
        { role: 'glyph', paint: { kind: 'solid', color: '#ffffff' }, d: 'M0 0L10 0L10 10Z' },
      ],
      [{ color: '#0f0', dx: 0, dy: 0, blur: 8 }],
    );
    expect(shapes[0]!.shadows).toEqual([{ color: '#000', dx: 0, dy: 2, blur: 4 }]);
    expect(shapes[1]!.shadows).toEqual([{ color: '#0f0', dx: 0, dy: 0, blur: 8 }]);
  });
});

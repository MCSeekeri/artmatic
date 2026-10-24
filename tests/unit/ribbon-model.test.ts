import { describe, expect, it } from 'vitest';
import {
  DEFAULT_ITEM_W,
  SMALL_ITEM_W,
  contextualTabIds,
  itemWidth,
  resolveVisibleTabs,
  type RibbonItemSpec,
  type RibbonTabDef,
} from '../../src/ui/ribbon/ribbon-model';

function btn(id: string, size?: 'large' | 'small'): RibbonItemSpec {
  return { kind: 'button', id, label: id, icon: 'plus', size, onselect: () => {} };
}

describe('itemWidth', () => {
  it('显式 width 优先', () => {
    const item: RibbonItemSpec = {
      kind: 'button', id: 'a', label: 'a', icon: 'plus', width: 77, onselect: () => {},
    };
    expect(itemWidth(item)).toBe(77);
  });

  it('small 比 large 窄', () => {
    expect(itemWidth(btn('a', 'small'))).toBe(SMALL_ITEM_W);
    expect(itemWidth(btn('a', 'large'))).toBe(DEFAULT_ITEM_W);
    expect(itemWidth(btn('a'))).toBe(DEFAULT_ITEM_W);
  });

  it('select / number / segment 各有各的基准宽度', () => {
    const sel: RibbonItemSpec = {
      kind: 'select', id: 's', label: 's', value: 'a',
      options: [{ value: 'a', label: 'A' }], onchange: () => {},
    };
    const num: RibbonItemSpec = { kind: 'number', id: 'n', label: 'n', value: 1, onchange: () => {} };
    expect(itemWidth(sel)).toBeGreaterThan(0);
    expect(itemWidth(num)).toBeGreaterThan(0);
    // 下拉比按钮宽 —— 它要显示文本
    expect(itemWidth(sel)).toBeGreaterThan(DEFAULT_ITEM_W);
  });

  it('分段控件按选项数计费', () => {
    const two: RibbonItemSpec = {
      kind: 'segment', id: 's', label: 's', value: 'a',
      options: [{ value: 'a', label: 'A' }, { value: 'b', label: 'B' }],
      onchange: () => {},
    };
    const four: RibbonItemSpec = { ...two, options: [...two.options, ...two.options] };
    expect(itemWidth(four)).toBe(itemWidth(two) * 2);
  });

  it('宽度是有限正数（Ribbon 的横向布局全靠它）', () => {
    const all: RibbonItemSpec[] = [
      btn('b'),
      btn('bs', 'small'),
      { kind: 'color', id: 'c', label: 'c', value: '#fff', onchange: () => {} },
      { kind: 'number', id: 'n', label: 'n', value: 0, onchange: () => {} },
    ];
    for (const item of all) {
      const w = itemWidth(item);
      expect(Number.isFinite(w)).toBe(true);
      expect(w).toBeGreaterThan(0);
    }
  });
});

describe('resolveVisibleTabs', () => {
  const tabs: RibbonTabDef[] = [
    { id: 'home', label: '开始', order: 0, groups: [] },
    { id: 'insert', label: '插入', order: 1, groups: [] },
    { id: 'shape-format', label: '图形格式', contextual: true, order: 10, groups: [] },
    { id: 'image-format', label: '图片格式', contextual: true, order: 11, groups: [] },
  ];

  it('没有选择时 contextual Tab 不出现', () => {
    const r = resolveVisibleTabs(tabs, new Set(), 'home');
    expect(r.visible.map((t) => t.id)).toEqual(['home', 'insert']);
  });

  it('选中图形时出现图形格式，且排在非 contextual 之后', () => {
    const r = resolveVisibleTabs(tabs, new Set(['shape-format']), 'home');
    expect(r.visible.map((t) => t.id)).toEqual(['home', 'insert', 'shape-format']);
  });

  it('两类都选中时两个 contextual Tab 同时出现', () => {
    const r = resolveVisibleTabs(tabs, new Set(['shape-format', 'image-format']), 'home');
    expect(r.visible.map((t) => t.id)).toEqual(['home', 'insert', 'shape-format', 'image-format']);
  });

  it('当前 Tab 消失时回落到第一个非 contextual Tab', () => {
    // 这是白屏级 bug 的防线：取消选择后 activeId 不能指向一个不存在的 Tab。
    const r = resolveVisibleTabs(tabs, new Set(), 'shape-format');
    expect(r.activeId).toBe('home');
  });

  it('当前 Tab 还在时保持不变', () => {
    const r = resolveVisibleTabs(tabs, new Set(['shape-format']), 'shape-format');
    expect(r.activeId).toBe('shape-format');
  });


  it('没有任何可见 Tab 时不抛错', () => {
    const r = resolveVisibleTabs([], new Set(), 'home');
    expect(r.visible).toEqual([]);
    expect(r.activeId).toBe('');
  });
});

describe('contextualTabIds', () => {
  it('空选择 → 空集合', () => {
    expect(contextualTabIds([]).size).toBe(0);
  });

  it('只有图形 → 图形格式', () => {
    expect([...contextualTabIds([{ kind: 'shape' }])]).toEqual(['shape-format']);
  });

  it('只有图片 → 图片格式', () => {
    expect([...contextualTabIds([{ kind: 'image' }])]).toEqual(['image-format']);
  });

  it('混合选择 → 两个都要（与 PowerPoint 一致）', () => {
    const ids = contextualTabIds([{ kind: 'text' }, { kind: 'shape' }, { kind: 'image' }]);
    expect([...ids].sort()).toEqual(['image-format', 'shape-format']);
  });

  it('只有文本 → 不出 contextual Tab（文本属性在「开始」里）', () => {
    expect(contextualTabIds([{ kind: 'text' }]).size).toBe(0);
  });
});

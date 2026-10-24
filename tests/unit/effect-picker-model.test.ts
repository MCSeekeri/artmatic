import { describe, expect, it } from 'vitest';
import {
  EMPTY_FILTER,
  activeFilterCount,
  buildItems,
  categoryChips,
  filterItems,
  groupItems,
  sortItems,
  tagChips,
  toggleIn,
  type EffectItem,
} from '../../src/ui/effect-picker/picker-model';
import { EFFECT_CATEGORIES, EFFECT_TAGS } from '../../src/effects/catalog';
import { LOCALES } from '../../src/i18n/locales';
import type { MessageKey } from '../../src/i18n/locales';

/**
 * 选择器的纯逻辑。搜索 / 筛选 / 排序全在这里，所以「搜不到某个特效」这类问题
 * 能在单测里复现，不用开浏览器。
 *
 * 翻译函数用真表（`LOCALES['zh-CN']`）而不是假函数：这样 `haystack` 里进的是
 * 用户真正会去搜的中文，而不是「fx.desc.bleach」这种键名 —— 用假的话，
 * 「按说明能搜到」这条断言就变成在测一个不存在的场景。
 */
const tr = (key: MessageKey): string => LOCALES['zh-CN'][key];

const ITEMS = buildItems(tr);
const byId = (id: string): EffectItem => {
  const hit = ITEMS.find((i) => i.id === id);
  if (!hit) throw new Error(`没有 ${id}`);
  return hit;
};

describe('选择器模型：建造条目', () => {
  it('条目数与注册表一致（目录缺项由 effect-catalog 的守卫负责）', () => {
    expect(ITEMS.length).toBeGreaterThan(50);
    expect(new Set(ITEMS.map((i) => i.id)).size).toBe(ITEMS.length);
  });

  it('名称 / 说明 / 分类名都是翻译过的中文，不是文案键', () => {
    const it0 = byId('bleach');
    expect(it0.name).toBe('去饱和度');
    expect(it0.desc).toContain('颜色');
    expect(it0.categoryLabel).toBe('调色');
    // 键名漏翻译的表现就是界面上出现 `fx.desc.xxx`，所以这里挡一道
    for (const item of ITEMS) {
      expect(item.name.startsWith('fx.'), `${item.id} 的名称没翻译`).toBe(false);
      expect(item.desc.startsWith('fx.'), `${item.id} 的说明没翻译`).toBe(false);
      expect(item.categoryLabel.startsWith('fx.'), `${item.id} 的分类没翻译`).toBe(false);
    }
  });

  it('tagLabels 与 tags 同序同长', () => {
    for (const item of ITEMS) expect(item.tagLabels.length).toBe(item.tags.length);
  });
});

describe('选择器模型：搜索', () => {
  it('按名称搜', () => {
    const hit = filterItems(ITEMS, { ...EMPTY_FILTER, query: '霓虹' });
    expect(hit.map((i) => i.id)).toContain('neon-edges');
  });

  it('按 id 搜（知道上游名字的人直接打 id）', () => {
    const hit = filterItems(ITEMS, { ...EMPTY_FILTER, query: 'kino' });
    expect(hit.map((i) => i.id).sort()).toEqual(['kino-datamosh', 'kino-feedback']);
  });

  it('按拼音搜：全拼 / 连写 / 首字母都能命中', () => {
    const hit = (q: string): string[] => filterItems(ITEMS, { ...EMPTY_FILTER, query: q }).map((i) => i.id);
    expect(hit('xiang su hua')).toContain('pixelate');
    expect(hit('xiangsuhua')).toContain('pixelate');
    expect(hit('xsh')).toContain('pixelate');
  });

  it('拼音连写不会误伤：搜 `gao si mo hu` 只该落在高斯模糊，而不是命中全部', () => {
    const hit = filterItems(ITEMS, { ...EMPTY_FILTER, query: 'gao si mo hu' });
    expect(hit.map((i) => i.id)).toContain('blur');
    expect(hit.length).toBeLessThan(ITEMS.length);
  });

  it('按说明里的词搜（搜「黑白色」能搜到去饱和度）', () => {
    const hit = filterItems(ITEMS, { ...EMPTY_FILTER, query: '颜色' });
    expect(hit.map((i) => i.id)).toContain('bleach');
  });

  it('大小写与首尾空格不影响', () => {
    const a = filterItems(ITEMS, { ...EMPTY_FILTER, query: 'VHS' });
    const b = filterItems(ITEMS, { ...EMPTY_FILTER, query: '  vhs ' });
    expect(a.map((i) => i.id)).toEqual(b.map((i) => i.id));
    expect(a.length).toBeGreaterThan(0);
  });

  it('搜不到就是空（不是退回全部）', () => {
    expect(filterItems(ITEMS, { ...EMPTY_FILTER, query: 'zzzz-not-a-thing' })).toEqual([]);
  });
});

describe('选择器模型：筛选', () => {
  it('分类维度内部取 OR', () => {
    const hit = filterItems(ITEMS, { ...EMPTY_FILTER, categories: ['color', 'blur'] });
    expect(hit.length).toBeGreaterThan(0);
    for (const i of hit) expect(['color', 'blur']).toContain(i.category);
    const colorOnly = filterItems(ITEMS, { ...EMPTY_FILTER, categories: ['color'] });
    expect(hit.length).toBeGreaterThan(colorOnly.length);
  });

  it('标签维度要求**全部命中**（不是命中任一）', () => {
    const fb = filterItems(ITEMS, { ...EMPTY_FILTER, tags: ['feedback'] });
    const fbAudio = filterItems(ITEMS, { ...EMPTY_FILTER, tags: ['feedback', 'audio'] });
    expect(fb.length).toBeGreaterThan(0);
    // 两个条件比一个更严，不能变成并集
    expect(fbAudio.length).toBeLessThanOrEqual(fb.length);
    for (const i of fb) expect(i.tags).toContain('feedback');
    for (const i of fbAudio) {
      expect(i.tags).toContain('feedback');
      expect(i.tags).toContain('audio');
    }
  });

  it('分类与搜索之间取 AND', () => {
    const both = filterItems(ITEMS, { query: '抖', categories: ['glitch'], tags: [] });
    for (const i of both) {
      expect(i.category).toBe('glitch');
      expect(i.haystack).toContain('抖');
    }
  });

  it('筛选面板的 chip 覆盖全部取值', () => {
    expect(categoryChips(tr).length).toBe(6);
    expect(tagChips(tr).map((t) => t.id)).toEqual(EFFECT_TAGS);
    for (const c of [...categoryChips(tr), ...tagChips(tr)]) {
      expect(c.label.startsWith('fx.'), `${c.id} 的标签没翻译`).toBe(false);
    }
  });
});

describe('选择器模型：排序', () => {
  it('名称排序按本地化比较，且是稳定的全序', () => {
    const sorted = sortItems(ITEMS, 'name');
    expect(sorted.length).toBe(ITEMS.length);
    for (let i = 1; i < sorted.length; i += 1) {
      expect(sorted[i - 1]!.name.localeCompare(sorted[i]!.name, 'zh-Hans-CN')).toBeLessThanOrEqual(0);
    }
  });

  it('默认顺序不动原数组，且不改动入参', () => {
    const input = ITEMS.slice(0, 10);
    const snapshot = input.map((i) => i.id);
    const out = sortItems(input, 'default');
    expect(out.map((i) => i.id)).toEqual(snapshot);
    sortItems(input, 'name');
    expect(input.map((i) => i.id)).toEqual(snapshot); // 排序是拷贝，不是原地
  });
});

describe('选择器模型：分组', () => {
  it('组序恒为分类表顺序，且把全部条目**恰好一次**分完', () => {
    const groups = groupItems(ITEMS, tr);
    expect(groups.map((g) => g.id)).toEqual([...EFFECT_CATEGORIES]);
    expect(groups.reduce((n, g) => n + g.items.length, 0)).toBe(ITEMS.length);
    for (const g of groups) {
      for (const it of g.items) expect(it.category).toBe(g.id);
    }
  });

  it('空组不出现，且组内保持传入顺序（排序只决定组内顺序）', () => {
    const only = ITEMS.filter((i) => i.category === 'glitch');
    const groups = groupItems(only, tr);
    expect(groups.map((g) => g.id)).toEqual(['glitch']);
    expect(groups[0]!.items.map((i) => i.id)).toEqual(only.map((i) => i.id));
  });


});

describe('选择器模型：工具', () => {
  it('toggleIn 逐项切换，保持原有顺序', () => {
    let list: string[] = [];
    list = toggleIn(list, 'a');
    list = toggleIn(list, 'b');
    expect(list).toEqual(['a', 'b']);
    list = toggleIn(list, 'a');
    expect(list).toEqual(['b']);
  });

  it('activeFilterCount 把搜索也算一项（按钮上的计数要真的反映"筛了什么"）', () => {
    expect(activeFilterCount(EMPTY_FILTER)).toBe(0);
    expect(activeFilterCount({ ...EMPTY_FILTER, query: 'a' })).toBe(1);
    expect(activeFilterCount({ ...EMPTY_FILTER, query: '   ' })).toBe(0);
    expect(activeFilterCount({ ...EMPTY_FILTER, categories: ['color'], tags: ['audio'] })).toBe(2);
  });
});

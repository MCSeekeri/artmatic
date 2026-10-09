import { describe, expect, it } from 'vitest';
import {
  buildItems,
  filterItems,
  labelOf,
  sortItems,
  type TransitionItem,
} from '../../src/ui/transition-picker/picker-model';
import { listTransitions } from '../../src/effects/transitions/registry';
import type { MessageKey } from '../../src/i18n/locales';

/**
 * 转场选择器的纯逻辑。翻译函数从外面传进来，所以这里能用一个**受控的假文案表**
 * 断言「搜索命中中文名 / 说明 / id / 作者」这几条 —— 不依赖真实语言表的内容
 * （那份由 `transition-catalog-info.test.ts` 守）。
 */
const FAKE: Record<string, string> = {
  'tns.name.crossZoom': '交叉缩放',
  'tns.desc.crossZoom': '径向模糊下的交叉缩放。',
  'tns.name.wipeLeft': '向左擦除',
  'tns.desc.wipeLeft': '从右往左擦除。',
};
const tr = (key: MessageKey): string => FAKE[key] ?? key;

const ALL = listTransitions().length;

describe('buildItems', () => {
  it('每条转场一条，id / 作者非空', () => {
    const items = buildItems(tr);
    expect(items.length).toBe(ALL);
    for (const it of items) {
      expect(it.id, 'id 不能为空').not.toBe('');
      expect(it.author, `${it.id} 缺作者`).not.toBe('');
    }
  });

  it('名称与说明取自已翻译的目录，不是 id 本身', () => {
    const items = buildItems(tr);
    const cz = items.find((i) => i.id === 'CrossZoom')!;
    expect(cz.name).toBe('交叉缩放');
    expect(cz.desc).toBe('径向模糊下的交叉缩放。');
    // 目录里没有中文名的条目退回显示 id（不留下空名字）
    const other = items.find((i) => i.id !== 'CrossZoom')!;
    expect(other.name.length).toBeGreaterThan(0);
  });

  it('haystack 已折叠成小写，包含 id / 名称 / 说明 / 作者', () => {
    const items = buildItems(tr);
    for (const it of items) {
      expect(it.haystack).toBe(it.haystack.toLowerCase());
      expect(it.haystack).toContain(it.id.toLowerCase());
      expect(it.haystack).toContain(it.author.toLowerCase());
    }
    const cz = items.find((i) => i.id === 'CrossZoom')!;
    expect(cz.haystack).toContain('交叉缩放');
    expect(cz.haystack).toContain('径向模糊');
  });
});

describe('filterItems', () => {
  const items = buildItems(tr);

  it('空查询返回全部（浅拷，不改原数组）', () => {
    const out = filterItems(items, { query: '   ' });
    expect(out.length).toBe(items.length);
    expect(out).not.toBe(items);
  });

  it('中文名、说明、id 都能命中', () => {
    expect(filterItems(items, { query: '交叉缩放' }).map((i) => i.id)).toContain('CrossZoom');
    expect(filterItems(items, { query: '径向模糊' }).map((i) => i.id)).toContain('CrossZoom');
    expect(filterItems(items, { query: 'crosszoom' }).map((i) => i.id)).toEqual(['CrossZoom']);
  });

  it('大小写不敏感；搜不到就是空数组（不许悄悄退回全部）', () => {
    expect(filterItems(items, { query: 'WIPELEFT' }).map((i) => i.id)).toContain('wipeLeft');
    expect(filterItems(items, { query: 'zzz-no-such-thing' })).toEqual([]);
  });

  it('按作者也能搜（名字记不住时这条路最短）', () => {
    const author = items[0]!.author;
    const hit = filterItems(items, { query: author.toLowerCase() });
    expect(hit.length).toBeGreaterThan(0);
    expect(hit.every((i) => i.author.toLowerCase().includes(author.toLowerCase()))).toBe(true);
  });
});

describe('sortItems', () => {
  const items = buildItems(tr);

  it('id 排序 = 目录的原生顺序（未排序时不保证，排序后必须升序）', () => {
    const ids = sortItems(items, 'id').map((i) => i.id);
    const sorted = ids.slice().sort((a, b) => a.localeCompare(b));
    expect(ids).toEqual(sorted);
  });

  it('name / author 排序都是全量、确定性的重排', () => {
    for (const sort of ['name', 'author'] as const) {
      const out = sortItems(items, sort);
      expect(out.length).toBe(items.length);
      expect(new Set(out.map((i) => i.id)).size).toBe(items.length);
    }
  });

  it('author 排序按作者分组（组内再按名）', () => {
    const out = sortItems(items, 'author');
    for (let i = 1; i < out.length; i += 1) {
      const prev = out[i - 1]!;
      const cur = out[i]!;
      expect(prev.author.localeCompare(cur.author) <= 0).toBe(true);
    }
  });
});

describe('labelOf', () => {
  const items: TransitionItem[] = buildItems(tr);

  it('已知 id → 显示名；未知 id → null（调用方自行退回显示 id）', () => {
    expect(labelOf(items, 'wipeLeft')).toBe('向左擦除');
    expect(labelOf(items, 'no-such')).toBeNull();
  });
});

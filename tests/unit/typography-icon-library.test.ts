import { describe, expect, it } from 'vitest';
import { ICON_NAMES, loadIconPath, searchIcons } from '../../src/ui/typography/icon-library';

describe('searchIcons', () => {
  const names = ['arrow-up', 'arrow-down-big', 'search', 'file-search-2', 'circle-dot', 'bar-chart-3'];

  it('空查询返回全部（保序）', () => {
    expect(searchIcons(names, '')).toEqual(names);
    expect(searchIcons(names, '   ')).toEqual(names);
  });

  it('子串命中，且前缀命中排在前面', () => {
    const hits = searchIcons(names, 'search');
    expect(hits).toEqual(['search', 'file-search-2']);
  });

  it('归一化：连字符 / 下划线 / 大小写等价', () => {
    expect(searchIcons(names, 'ARROW_DOWN')).toEqual(['arrow-down-big']);
    expect(searchIcons(names, 'arrow down')).toEqual(['arrow-down-big']);
    expect(searchIcons(names, 'arrowup')).toEqual(['arrow-up']);
  });

  it('多词是 AND', () => {
    expect(searchIcons(names, 'search file')).toEqual(['file-search-2']);
    expect(searchIcons(names, 'zzz search')).toEqual([]);
  });

  it('前缀命中优先于中段命中，同 rank 短的在前', () => {
    const hits = searchIcons(['chart-bar-chart', 'bar-chart-3', 'chart'], 'chart');
    expect(hits).toEqual(['chart', 'chart-bar-chart', 'bar-chart-3']);
  });

  it('没有字母数字的查询（中文 / 纯符号）返回空，而不是「静默返回全量」', () => {
    expect(searchIcons(names, '不存在的图标')).toEqual([]);
    expect(searchIcons(names, '---')).toEqual([]);
  });
});

describe('图标清单与懒加载', () => {
  it('清单是全量图标（不是项目自用的几十个）', () => {
    expect(ICON_NAMES.length).toBeGreaterThan(1000);
    expect(ICON_NAMES).toContain('search');
    expect(ICON_NAMES).toContain('arrow-up');
  });

  it('清单有序且无重复', () => {
    const sorted = [...ICON_NAMES].sort();
    expect(ICON_NAMES).toEqual(sorted);
    expect(new Set(ICON_NAMES).size).toBe(ICON_NAMES.length);
  });

  it('懒加载真实图标：产出 0..100 坐标系的路径', async () => {
    const d = await loadIconPath('search');
    expect(d).toBeTruthy();
    // 坐标经过 parse → mapNodes(×100/24) → serialize，全部落在 0..100 内
    const nums = [...d!.matchAll(/-?\d+(?:\.\d+)?/g)].map(Number);
    expect(nums.length).toBeGreaterThan(4);
    for (const v of nums) {
      expect(v).toBeGreaterThanOrEqual(-1);
      expect(v).toBeLessThanOrEqual(101);
    }
    expect(d).not.toContain('NaN');
  });

  it('重复加载命中缓存（返回同一个字符串）', async () => {
    const a = await loadIconPath('search');
    const b = await loadIconPath('search');
    expect(a).toBe(b);
  });

  it('不存在的名字返回 null 而不是抛错', async () => {
    await expect(loadIconPath('definitely-not-an-icon')).resolves.toBeNull();
  });
});

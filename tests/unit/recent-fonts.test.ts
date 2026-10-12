import { describe, expect, it } from 'vitest';
import { loadRecentFonts, orderByRecent, rememberFont } from '../../src/ui/typography/recent-fonts';

describe('orderByRecent', () => {
  it('把最近用过的族排到最前，其余保持原顺序', () => {
    const all = ['Inter', 'Arial', 'Helvetica', 'SimSun'];
    expect(orderByRecent(all, ['SimSun', 'Arial'])).toEqual(['SimSun', 'Arial', 'Inter', 'Helvetica']);
  });

  it('忽略已不在候选集里的最近项（字体被删掉）', () => {
    expect(orderByRecent(['Inter', 'Arial'], ['Gone', 'Arial'])).toEqual(['Arial', 'Inter']);
  });

  it('没有最近项时原样返回；重复的最近项只保留一次', () => {
    expect(orderByRecent(['a', 'b'], [])).toEqual(['a', 'b']);
    expect(orderByRecent(['a', 'b', 'c'], ['b', 'b'])).toEqual(['b', 'a', 'c']);
  });
});

describe('最近字体持久化：无 localStorage 时静默降级', () => {
  it('load 返回空数组而不是抛错', () => {
    expect(loadRecentFonts()).toEqual([]);
  });

  it('remember 不抛错（Node / 隐私模式下不该打断 Ribbon 渲染）', () => {
    expect(() => rememberFont('Inter')).not.toThrow();
  });
});

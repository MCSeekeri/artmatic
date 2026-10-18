import { describe, expect, it } from 'vitest';
import {
  RECENT_LIMIT,
  pushRecent,
  readRecent,
  writeRecent,
} from '../../src/ui/recent-defs';

/** 极简 Storage 替身：只实现用到的两个方法。 */
function fakeStorage(initial: Record<string, string> = {}): {
  data: Record<string, string>;
  getItem(k: string): string | null;
  setItem(k: string, v: string): void;
} {
  const data = { ...initial };
  return {
    data,
    getItem: (k) => (k in data ? data[k]! : null),
    setItem: (k, v) => {
      data[k] = v;
    },
  };
}

describe('pushRecent', () => {
  it('新 id 进最前，重复的提上来而不是再占一格', () => {
    expect(pushRecent(['a', 'b', 'c'], 'b')).toEqual(['b', 'a', 'c']);
    expect(pushRecent(['a', 'b'], 'x')).toEqual(['x', 'a', 'b']);
  });

  it('裁到上限，且上限就是菜单里展示的 5 项', () => {
    expect(RECENT_LIMIT).toBe(5);
    const list = pushRecent(['a', 'b', 'c', 'd', 'e'], 'f');
    expect(list).toEqual(['f', 'a', 'b', 'c', 'd']);
    expect(list).toHaveLength(RECENT_LIMIT);
  });

  it('空 id 不改变列表（也不写一条空串进去）', () => {
    expect(pushRecent(['a'], '')).toEqual(['a']);
    expect(pushRecent(['a'], '   ')).toEqual(['a']);
  });

  it('返回新数组：调用方可以靠引用判断「有没有变」', () => {
    const list = ['a'];
    const next = pushRecent(list, 'a');
    expect(next).not.toBe(list);
    expect(next).toEqual(['a']);
  });
});

describe('readRecent', () => {
  it('没有存储 / 没有键 → 空列表', () => {
    expect(readRecent(null, 'k')).toEqual([]);
    expect(readRecent(fakeStorage(), 'k')).toEqual([]);
  });

  it('坏 JSON / 非数组 → 空列表，而不是抛异常', () => {
    expect(readRecent(fakeStorage({ k: '{oops' }), 'k')).toEqual([]);
    expect(readRecent(fakeStorage({ k: '{"id":"a"}' }), 'k')).toEqual([]);
    expect(readRecent(fakeStorage({ k: '"a"' }), 'k')).toEqual([]);
  });

  it('过滤非字符串、去重、裁到上限', () => {
    const raw = JSON.stringify(['a', 3, 'a', null, 'b', 'c', 'd', 'e', 'f']);
    expect(readRecent(fakeStorage({ k: raw }), 'k')).toEqual(['a', 'b', 'c', 'd', 'e']);
  });
});

describe('writeRecent', () => {
  it('写进去的是 JSON 数组', () => {
    const s = fakeStorage();
    writeRecent(s, 'k', ['a', 'b']);
    expect(JSON.parse(s.data.k!)).toEqual(['a', 'b']);
  });

  it('存储抛错时静默降级（隐私模式不该打断插入片段）', () => {
    const throwing = {
      setItem: () => {
        throw new Error('quota');
      },
    };
    expect(() => writeRecent(throwing, 'k', ['a'])).not.toThrow();
  });
});

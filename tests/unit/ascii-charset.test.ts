import { describe, expect, it } from 'vitest';
import {
  ASCII_CHARSETS,
  MAX_CHARSET_LENGTH,
  asciiCharsetText,
  compactChars,
} from '../../src/effects/ascii-charsets';

/**
 * ASCII 字符集的解析规则（纯函数）。
 *
 * 守的是**静默退化**那一类：自定义输入被清空 / 只输入了空格时，画面会从
 * 「一张字符画」变成「一片纯底色」而没有任何报错；字符没去重则会让图集里
 * 出现面积完全相同的两格，白白吃掉一格索引。
 */
describe('ASCII 字符集', () => {
  it('内置预设非空，且不含空白与重复字符', () => {
    for (const [id, text] of Object.entries(ASCII_CHARSETS)) {
      expect(text.length, `${id} 是空的`).toBeGreaterThan(1);
      expect(/\s/.test(text), `${id} 里含空白`).toBe(false);
      expect(new Set(Array.from(text)).size, `${id} 里有重复字符`).toBe(Array.from(text).length);
    }
  });

  it('自定义字符去空白、去重，且保持首次出现顺序', () => {
    expect(compactChars('0 0 1  1')).toBe('01');
    expect(compactChars('ab\nab c')).toBe('abc');
    expect(compactChars('@@@#')).toBe('@#');
  });

  it('空输入退回经典集（否则画面只剩纯底色）', () => {
    expect(compactChars('')).toBe(ASCII_CHARSETS.classic);
    expect(compactChars('   ')).toBe(ASCII_CHARSETS.classic);
    expect(asciiCharsetText({ charset: 'custom', custom: '  ' })).toBe(ASCII_CHARSETS.classic);
  });

  it('未知预设退回经典集', () => {
    expect(asciiCharsetText({ charset: 'nope' })).toBe(ASCII_CHARSETS.classic);
  });

  it('自定义优先于预设，且超长截断到上限', () => {
    expect(asciiCharsetText({ charset: 'custom', custom: 'ab' })).toBe('ab');
    const many = Array.from({ length: 100 }, (_, i) => String.fromCharCode(33 + i)).join('');
    expect(Array.from(compactChars(many)).length).toBe(MAX_CHARSET_LENGTH);
  });
});

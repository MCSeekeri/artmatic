/**
 * pinyin.ts — 拼音搜索的运行时部分：把中文串摊成可 `includes` 的形态。
 *
 * 数据在 `locales/zh-CN/pinyin.ts`（键是中文，只能放语言目录下），这里只做
 * 「取出拼音 → 派生全拼与首字母」。
 *
 * 三个形态都要进 haystack，因为用户三种都会打：
 * - `sheng ming you xi`（带空格）
 * - `shengmingyouxi`（全拼，最常见）
 * - `smyx`（首字母）
 *
 * 没有对应条目时返回空串 —— 拉丁文名字（`kino-datamosh`）本来就靠 id 命中，
 * 插件生成器的中文名没有条目，也只是搜不到拼音，不影响中文与 id 搜索。
 */

import { PINYIN_NAMES } from './locales/zh-CN/pinyin';

/** 一个中文串的全部拼音形态，用空格连接。没有条目时是空串。 */
export function pinyinHaystack(text: string): string {
  const syllables = PINYIN_NAMES[text];
  if (!syllables) return '';
  const flat = syllables.replace(/ /g, '');
  const initials = syllables.replace(/ /g, '').length > 0
    ? syllables
        .split(' ')
        .map((s) => s[0])
        .join('')
    : '';
  return `${syllables} ${flat} ${initials}`;
}

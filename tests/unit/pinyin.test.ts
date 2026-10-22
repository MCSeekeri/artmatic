import { describe, expect, it } from 'vitest';
import { PINYIN_NAMES } from '../../src/i18n/locales/zh-CN/pinyin';
import { pinyinHaystack } from '../../src/i18n/pinyin';
import { buildItems as effectItems } from '../../src/ui/effect-picker/picker-model';
import { buildItems as algoItems, groupItems } from '../../src/ui/algo-picker/picker-model';
import { LOCALES } from '../../src/i18n/locales';
import type { MessageKey } from '../../src/i18n/locales';

/**
 * 拼音搜索的两条守卫，缺了都会变成**静默缺口**：
 *
 * 1. **覆盖**：每个能搜到的中文名都要有拼音条目。漏一条的症状只是「打拼音
 *    搜不到那一个」，不报错不崩 —— 只有这条测试能把「新加了特效忘了补表」
 *    变成一声明确的失败。
 * 2. **无孤儿**：表里的键必须还能对上真名字。名字改了（比如「逐行抖动」改成
 *    「行抖动」）而表没跟着改，旧条目就永远命中不了，同样静默。
 *
 * 名字集合是从**真实目录 + 真实语言表**里取的，不是从表本身反推 —— 否则
 * 断言会退化成「表包含自己」的恒真句。
 */
const tr = (key: MessageKey): string => LOCALES['zh-CN'][key];

/** 会进 `haystack` 的全部名字（`buildItems` 里被 `pinyinHaystack` 包的那几个字段）。 */
function namesInUse(): string[] {
  const out = new Set<string>();
  // 特效：名称、分类名、标签名。说明是整句，不查拼音。
  for (const item of effectItems(tr)) {
    out.add(item.name);
    out.add(item.categoryLabel);
    for (const l of item.tagLabels) out.add(l);
  }
  // 生成器：名称（分组小标题也进搜索框将来的用法，一并要求）。
  for (const item of algoItems(tr)) out.add(item.name);
  for (const g of groupItems(algoItems(tr), tr)) out.add(g.label);
  return [...out];
}

describe('拼音表：覆盖', () => {
  const names = namesInUse();

  it('每个可搜到的中文名都有拼音条目', () => {
    const missing = names.filter((n) => !PINYIN_NAMES[n]);
    expect(missing, '这些名字没有拼音 → 打拼音搜不到，且不会报错').toEqual([]);
  });

  it('没有孤儿条目（名字改过而表没跟着改）', () => {
    const known = new Set(names);
    const orphan = Object.keys(PINYIN_NAMES).filter((k) => !known.has(k));
    expect(orphan, '这些拼音条目的键已经对不上任何名字').toEqual([]);
  });

  it('每条拼音只由小写字母和单个空格组成（首字母缩写由运行时算）', () => {
    const bad = Object.entries(PINYIN_NAMES)
      .filter(([, v]) => !/^[a-z]+( [a-z]+)*$/.test(v))
      .map(([k, v]) => `${k} → "${v}"`);
    expect(bad).toEqual([]);
  });
});

describe('拼音表：运行时形态', () => {
  it('同时给出带空格全拼、连写全拼、首字母三种形态', () => {
    const h = pinyinHaystack('生命游戏');
    expect(h).toContain('sheng ming you xi');
    expect(h).toContain('shengmingyouxi');
    expect(h.split(' ')).toContain('smyx');
  });

  it('拉丁名 / 表里没有的名字返回空串（不影响中文与 id 搜索）', () => {
    expect(pinyinHaystack('kino-datamosh')).toBe('');
    expect(pinyinHaystack('A Plugin Name')).toBe('');
  });

  it('三种形态都能在 haystack 里被 includes 命中', () => {
    const h = pinyinHaystack('镜头光晕');
    for (const q of ['jing tou guang yun', 'jingtouguangyun', 'jtgy']) {
      expect(h.includes(q), `「${q}」搜不到`).toBe(true);
    }
  });
});

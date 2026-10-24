import { describe, expect, it } from 'vitest';
import {
  TRANSITION_CATALOG,
  transitionCatalogInfo,
} from '../../src/effects/transitions/catalog-info';
import { getTransition, listTransitions } from '../../src/effects/transitions/registry';
import { transitions } from '../../src/i18n/locales/zh-CN/transitions';
import type { MessageKey } from '../../src/i18n/locales';

/**
 * 转场展示信息（中文名 + 一句话说明）与运行期目录的**对齐守卫**。
 *
 * 上游是自动生成的集合，条目随时会加、会删。没有这条测试，漏项的表现是
 * **选择器里那一条悄悄退回英文 id**（`buildItems` 的兜底）—— 不报错、也不明显，
 * 只有盯着列表一行行看才发现。删条目的表现则是语言表里留一堆没人用的键。
 *
 * 两份数据分居两个文件（表在 `effects/transitions/`、文案在 `i18n/locales/`），
 * 所以「对齐」只能靠测试守。
 */

const IDS = listTransitions().map((e) => e.id);
const LOCALE_KEYS = new Set<string>(Object.keys(transitions));

/** 目录表里引用到的全部文案键。 */
const REFERENCED = new Set<string>();
for (const entry of Object.values(TRANSITION_CATALOG)) {
  REFERENCED.add(entry.nameKey);
  REFERENCED.add(entry.descKey);
}

describe('转场展示信息：与目录对齐', () => {
  it('目录非空（守卫本身要有覆盖面）', () => {
    expect(IDS.length).toBeGreaterThan(100);
  });

  it('每条转场都有展示信息', () => {
    const missing = IDS.filter((id) => !transitionCatalogInfo(id));
    expect(
      missing,
      '这些转场没有中文名/说明 → 选择器里会显示英文 id。去 effects/transitions/catalog-info.ts 补一条',
    ).toEqual([]);
  });

  it('没有孤儿条目（表里的 id 都对应真实转场）', () => {
    const known = new Set(IDS);
    const orphans = Object.keys(TRANSITION_CATALOG).filter((id) => !known.has(id));
    expect(orphans, '这些条目对应的转场已经不在目录里了（上游删了？）').toEqual([]);
  });

  it('未知 id 返回 null，不抛（工程可能来自更新的版本）', () => {
    expect(transitionCatalogInfo('no-such-transition')).toBeNull();
    expect(transitionCatalogInfo('')).toBeNull();
  });
});

describe('转场展示信息：文案键与语言表对齐', () => {
  it('引用的每个键都在语言表里，且值非空、不是键本身', () => {
    const table = transitions as Record<string, string>;
    const problems: string[] = [];
    for (const key of REFERENCED) {
      const v = table[key];
      if (typeof v !== 'string' || v.trim() === '') problems.push(`${key} 缺失或为空`);
      else if (v === key) problems.push(`${key} 的值就是键本身`);
    }
    expect(problems).toEqual([]);
  });

  it('语言表里没有孤儿键（改了 id 或删了条目后留下的）', () => {
    const orphans = [...LOCALE_KEYS].filter((k) => !REFERENCED.has(k));
    expect(orphans, '这些 tns.* 键没有任何条目引用它们').toEqual([]);
  });



});

describe('转场展示信息：内容质量', () => {
  it('中文名互不重复（复制粘贴改漏一个 id 会在这里现形）', () => {
    const names = Object.values(TRANSITION_CATALOG).map((e) => e.nameKey);
    expect(new Set(names).size, '有两条转场共用了同一个中文名').toBe(names.length);
    const descs = Object.values(TRANSITION_CATALOG).map((e) => e.descKey);
    expect(new Set(descs).size, '有两条转场共用了同一句说明').toBe(descs.length);
  });

  it('名字是短名，说明是一句话', () => {
    const table = transitions as Record<string, string>;
    const bad: string[] = [];
    for (const entry of Object.values(TRANSITION_CATALOG)) {
      const n = table[entry.nameKey]!;
      const d = table[entry.descKey]!;
      // 名字长度**没有下限**：单字的「风」就是这条转场最好的名字。
      if (n.length > 12) bad.push(`名字太长：${entry.nameKey} = ${n}`);
      // 说明要能在卡片里占一两行：6..40 个字，且不带换行。
      if (d.length < 6 || d.length > 40) bad.push(`说明长度异常：${entry.descKey} = ${d}`);
      if (/[\n\r]/.test(d)) bad.push(`说明里有换行：${entry.descKey}`);
    }
    expect(bad).toEqual([]);
  });

  it('说明不是名字的复读（「向左擦除 → 向左擦除。」这种等于没写）', () => {
    const table = transitions as Record<string, string>;
    const bad: string[] = [];
    for (const entry of Object.values(TRANSITION_CATALOG)) {
      const n = table[entry.nameKey]!;
      const d = table[entry.descKey]!.replace(/[。.\s]/g, '');
      if (d === n.replace(/[。.\s]/g, '')) bad.push(`${entry.nameKey}: ${n} / ${d}`);
    }
    expect(bad, '说明只是把名字重复了一遍').toEqual([]);
  });

  it('示例抽查：几条常见转场对得上', () => {
    const id = getTransition('wipeLeft')?.id;
    expect(id).toBe('wipeLeft');
    expect(transitionCatalogInfo('wipeLeft')?.nameKey).toBe('tns.name.wipeLeft');
    // 中文名不是 id（本轮本地化的核心诉求）
    const table = transitions as Record<string, string>;
    expect(table['tns.name.wipeLeft']).not.toBe('wipeLeft');
  });
});

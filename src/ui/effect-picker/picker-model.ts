/**
 * picker-model.ts — 特效选择器的**纯逻辑**：建造条目、搜索、筛选、排序。
 *
 * 全部是纯函数（翻译函数从外面传进来），所以可以脱离 DOM 单测。UI 组件只负责
 * 把状态喂进来、把结果画出来 —— 「搜不到某个特效」这类问题因此可以在单测里
 * 复现，不用开浏览器。
 */

import {
  DEFAULT_EFFECT_CATEGORY,
  EFFECT_CATALOG,
  EFFECT_CATEGORIES,
  EFFECT_TAGS,
  effectTags,
  pluginEffectTags,
  type EffectCategory,
  type EffectTag,
} from '../../effects/catalog';
import { getEffect, listEffects } from '../../effects/registry';
import { resolveLabel } from '../../i18n/label';
import type { MessageKey } from '../../i18n/locales';

export type Translate = (key: MessageKey) => string;

export interface EffectItem {
  id: string;
  /** 已翻译的显示名。 */
  name: string;
  /** 已翻译的一句话说明。插件没写说明时是空串（卡片据此不画那一行）。 */
  desc: string;
  category: EffectCategory;
  tags: EffectTag[];
  /** 已翻译的分类名（排序与筛选标签要用）。 */
  categoryLabel: string;
  /** tags 的已翻译名，**同序**。放在这里而不是让卡片自己 tr()：卡片就拿不到
   *  那个带 `as MessageKey` 的字符串拼装了（模板里做类型转换很难看）。 */
  tagLabels: string[];
  /** 搜索用的**预折叠**小写串：id + 名称 + 说明 + 分类名 + 标签名。 */
  haystack: string;
  /** 提供者：`null` = 内置，否则是插件 id。卡片据此打「插件」标。 */
  pluginId: string | null;
}

export type PickerView = 'grid' | 'list';
export type PickerSort = 'default' | 'name' | 'category';

export const PICKER_SORTS: PickerSort[] = ['default', 'name', 'category'];

/**
 * 建造全部条目。
 *
 * `haystack` 在这里**一次算好**而不是每次按键现拼：面板一打开会调好几遍
 * （筛选变化、排序变化），而 73 条 × 5 个字段的拼接没必要重复。
 * 折叠成小写也是为了 `includes` 能直接吃 —— 大小写不敏感是搜索的基本预期。
 *
 * ## 内置与插件走同一张清单，但元数据来源不同
 *
 * 内置条目的说明/分类/缩略图底图在 `EFFECT_CATALOG`；插件条目自带
 * `entry.meta`（本来就是分开发布的，没法进构建期的目录表）。两者的**结构标签**
 * 都从 shader def 推导，所以「有哪些吃音频」「哪些带反馈」这类筛选对插件同样有效。
 */
export function buildItems(tr: Translate): EffectItem[] {
  const out: EffectItem[] = [];
  for (const { id, pluginId } of listEffects()) {
    const entry = getEffect(id);
    // 目录与注册表都是本模块的输入，理论上同源；但插件条目**没有**目录项，
    // 所以这里只能对 entry 做存在性检查，不能再要求 meta 存在。
    if (!entry) continue;
    const meta = EFFECT_CATALOG[id] ?? null;
    const category = meta?.category ?? entry.meta?.category ?? DEFAULT_EFFECT_CATEGORY;
    const tags = meta
      ? effectTags(entry.shader, meta)
      : pluginEffectTags(entry.shader, entry.meta?.tags ?? []);
    const descLabel = meta ? null : (entry.meta?.desc ?? null);
    const name = resolveLabel(entry.nameKey, tr);
    const desc = meta ? tr(meta.descKey) : descLabel ? resolveLabel(descLabel, tr) : '';
    const categoryLabel = tr(`fx.cat.${category}` as MessageKey);
    const tagLabels = tags.map((t) => tr(`fx.tag.${t}` as MessageKey));
    out.push({
      id,
      name,
      desc,
      category,
      tags,
      categoryLabel,
      tagLabels,
      haystack: [id, name, desc, categoryLabel, ...tagLabels].join(' ').toLowerCase(),
      pluginId,
    });
  }
  return out;
}

export interface FilterState {
  query: string;
  categories: readonly EffectCategory[];
  tags: readonly EffectTag[];
}

export const EMPTY_FILTER: FilterState = { query: '', categories: [], tags: [] };

/**
 * 筛选。三个维度之间是 **AND**，每个维度**内部**是 OR。
 *
 * 每个维度内部取 OR 是「多选就是放宽」的直觉；维度之间取 AND 才是「条件」的意思。
 * 标签这一维要求**全部命中**（而不是命中任一）：勾了「带反馈」+「吃音频」的人
 * 要的是同时满足两条的那几个，不是并集 —— 并集会让第二个勾选项变成噪声。
 */
export function filterItems(items: readonly EffectItem[], f: FilterState): EffectItem[] {
  const q = f.query.trim().toLowerCase();
  const cats = new Set(f.categories);
  return items.filter((it) => {
    if (cats.size > 0 && !cats.has(it.category)) return false;
    for (const t of f.tags) if (!it.tags.includes(t)) return false;
    if (q && !it.haystack.includes(q)) return false;
    return true;
  });
}

/** 排序。`name` 走本地化比较，中文按拼音、西文按字母表。 */
export function sortItems(items: readonly EffectItem[], sort: PickerSort): EffectItem[] {
  const out = items.slice();
  if (sort === 'name') {
    out.sort((a, b) => a.name.localeCompare(b.name, 'zh-Hans-CN'));
  } else if (sort === 'category') {
    out.sort((a, b) => {
      const d = EFFECT_CATEGORIES.indexOf(a.category) - EFFECT_CATEGORIES.indexOf(b.category);
      return d !== 0 ? d : a.name.localeCompare(b.name, 'zh-Hans-CN');
    });
  }
  // 'default' = 目录表的顺序（作者按「相邻的放一起」编过），原样不动。
  return out;
}

/** 当前筛选条件里有几项是「非默认」的 —— 用来在「条件筛选」按钮上打计数。 */
export function activeFilterCount(f: FilterState): number {
  return f.categories.length + f.tags.length + (f.query.trim() ? 1 : 0);
}

/** 逐项依次切换：给筛选面板的 chip 用。 */
export function toggleIn<T>(list: readonly T[], value: T): T[] {
  return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
}

/** 供筛选面板渲染的分类/标签清单（带已翻译名）。 */
export function categoryChips(tr: Translate): { id: EffectCategory; label: string }[] {
  return EFFECT_CATEGORIES.map((id) => ({ id, label: tr(`fx.cat.${id}` as MessageKey) }));
}

export function tagChips(tr: Translate): { id: EffectTag; label: string }[] {
  return EFFECT_TAGS.map((id) => ({ id, label: tr(`fx.tag.${id}` as MessageKey) }));
}

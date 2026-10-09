/**
 * picker-model.ts — 转场选择器的**纯逻辑**：建造条目、搜索、排序。
 *
 * 与 `ui/effect-picker/picker-model.ts` 同构：全部是纯函数（翻译函数从外面传进来），
 * 可以脱离 DOM 单测。
 *
 * ## 名称与说明来自目录表，参数名不翻译
 *
 * 中文名 / 一句话说明存在 `effects/transitions/catalog-info.ts`（`nameKey` / `descKey`），
 * 由这里解析 —— 与 `effects/catalog.ts` 同一分工：表是模块加载时求值一次的，
 * 里面直接写 `tr()` 会把值冻结在导入那一刻的语言上。
 *
 * **参数名**（`pixelSize` / `blocksize`…）照旧显示原文：它们是 GLSL uniform 的名字，
 * 翻译之后就对着上游文档找不到那一行了。
 *
 * 目录里没有的条目（上游刚加、文案还没补）**退回显示 id**，而不是空名字 ——
 * 但 `transition-catalog-info.test.ts` 会先把这种情况挡在提交之前。
 */

import { transitionCatalogInfo } from '../../effects/transitions/catalog-info';
import { listTransitions } from '../../effects/transitions/registry';
import type { MessageKey } from '../../i18n/locales';

export type Translate = (key: MessageKey) => string;

export type TransitionView = 'grid' | 'list';
export type TransitionSort = 'name' | 'author' | 'id';

export const TRANSITION_SORTS: TransitionSort[] = ['name', 'author', 'id'];

export interface TransitionItem {
  /** 上游 id，也是工程里 `TransitionRef.defId` 与缩略图文件名。 */
  id: string;
  /** 已翻译的中文名。 */
  name: string;
  /** 已翻译的一句话说明。 */
  desc: string;
  author: string;
  license: string;
  /** 可编辑参数个数。列表视图里给出「这条转场有几条参数」。 */
  paramCount: number;
  /** 搜索用的**预折叠**小写串：id + 中文名 + 说明 + 作者。 */
  haystack: string;
}

/** 建造全部条目。跟目录顺序（已按 id 排序）。 */
export function buildItems(tr: Translate): TransitionItem[] {
  return listTransitions().map((e) => {
    const info = transitionCatalogInfo(e.id);
    const name = info ? tr(info.nameKey) : e.id;
    const desc = info ? tr(info.descKey) : '';
    return {
      id: e.id,
      name,
      desc,
      author: e.author,
      license: e.license,
      paramCount: e.params.length,
      haystack: [e.id, name, desc, e.author].join(' ').toLowerCase(),
    };
  });
}

export interface TransitionFilterState {
  query: string;
}

export const EMPTY_TRANSITION_FILTER: TransitionFilterState = { query: '' };

/** 只按关键词过滤（中文名 / 说明 / id / 作者）。空查询返回原数组的浅拷。 */
export function filterItems(
  items: readonly TransitionItem[],
  f: TransitionFilterState,
): TransitionItem[] {
  const q = f.query.trim().toLowerCase();
  if (!q) return items.slice();
  return items.filter((it) => it.haystack.includes(q));
}

/**
 * 排序。`name` 走本地化比较（中文按拼音）；`id` 是目录的原生顺序（本已是 id 升序）；
 * `author` 按作者分组、组内按中文名。
 */
export function sortItems(items: readonly TransitionItem[], sort: TransitionSort): TransitionItem[] {
  const out = items.slice();
  const byName = (a: TransitionItem, b: TransitionItem): number =>
    a.name.localeCompare(b.name, 'zh-Hans-CN') || a.id.localeCompare(b.id);
  if (sort === 'author') {
    out.sort((a, b) => a.author.localeCompare(b.author) || byName(a, b));
  } else if (sort === 'name') {
    out.sort(byName);
  } else {
    out.sort((a, b) => a.id.localeCompare(b.id));
  }
  return out;
}

/** 供底部读数用：本次选中的显示名（`''` = 无转场，由调用方给文案）。 */
export function labelOf(items: readonly TransitionItem[], id: string): string | null {
  return items.find((it) => it.id === id)?.name ?? null;
}

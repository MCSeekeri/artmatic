/**
 * locales/index.ts — 语言注册表。
 *
 * 现在只有中文。**这一步先把文案抽出来，翻译是后面的事** ——
 * 抽的时候才会发现哪些句子是拼字符串拼出来的（那种结构问题拖得越久越贵）。
 */
import { zhCN } from './zh-CN';

export const LOCALES = { 'zh-CN': zhCN } as const;

export type LocaleId = keyof typeof LOCALES;

/**
 * 全部可用文案键。所有语言表都必须完整覆盖这个集合。
 *
 * 它由 zh-CN 派生，所以「加了一句中文却忘了加语言」不可能发生 ——
 * 反过来的方向（语言表缺项）由单测挡。
 */
export type MessageKey = keyof typeof zhCN;

/** 一门语言的完整文案表。新语言用 `const x = {...} satisfies Catalog` 来写。 */
export type Catalog = Record<MessageKey, string>;

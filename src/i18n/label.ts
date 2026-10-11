/**
 * label.ts — 内置与插件统一的「展示名 / 参数标签」契约。
 *
 * ## 为什么需要这一层
 *
 * 内置定义的 `nameKey` / `labelKey` 存的是**文案键**（`MessageKey`，编译期由
 * `zh-CN` 的键集派生）—— 这样切语言时定义表不必重建（理由见 `effects/types.ts`）。
 * 但插件是**运行期**加载的外部文件，它不可能知道编译期的 `MessageKey`，
 * 只能带一个字面量字符串。
 *
 * 于是引入 `Label`：要么是文案键，要么是一段已经写好的文本。**字段名保持
 * `labelKey` / `nameKey` 不变**，只把类型放宽 —— 内置的七十多个特效文件与
 * 二十多个生成器文件因此一行都不用改（字符串字面量天然满足 `MessageKey`
 * 分支）；而所有 `tr(x.labelKey)` 的调用点会因 `Label` 不能赋给 `MessageKey`
 * 而**编译报错**，强制改走 `resolveLabel()`。这是刻意的：加宽类型而不改名，
 * 让「漏改」在编译期就暴露，而不是等到界面上出现一个键名。
 *
 * ## 运行期的兜底（重要）
 *
 * `tr()` 在键不存在时**返回键本身**（见 `i18n/index.svelte.ts` 的理由注释）。
 * 所以哪怕有人（比如一个用 JS 直接写的插件）塞进来一个普通的未知字符串，
 * `resolveLabel` 也会原样显示它，而不是空串 —— 与 `tr` 的既有语义一致。
 */

import type { MessageKey } from './locales';

/**
 * 展示名 / 参数标签。
 *
 * - `string`（= `MessageKey`）：内置走文案表，可跟随语言切换；
 * - `{ text }`：运行期来源（插件）自带的字面量，不随语言切换。
 */
export type Label = MessageKey | { text: string };

/** 翻译函数的最小形态。与 `ui/effect-picker/picker-model.ts` 的 `Translate` 同构。 */
export type Translate = (key: MessageKey) => string;

/** 解析一个 `Label` 成可显示的字符串。 */
export function resolveLabel(label: Label, tr: Translate): string {
  if (typeof label === 'string') return tr(label);
  return label && typeof label.text === 'string' ? label.text : '';
}

/**
 * 造一个字面量标签 —— 插件与运行期数据用。
 *
 * 单独一个函数是为了让调用点读起来是「这里是文本」而不是「这里有个对象」，
 * 也方便将来统一加清洗（比如去首尾空白）。
 */
export function labelText(text: string): Label {
  return { text: String(text ?? '') };
}

/** 是不是字面量标签（用于选择展示样式，比如给插件项打标）。 */
export function isTextLabel(label: Label): label is { text: string } {
  return typeof label !== 'string';
}

/**
 * 把**不可信输入**（插件清单、手改过的 JSON）规范成 `Label`。
 *
 * 与 `resolveLabel` 的区别：这里不做翻译解析，只回答「它能不能当标签用」。
 * 不认识的一律返回 `null`，由调用方决定是拒绝整条还是丢弃这一项 ——
 * 静默把对象 `String()` 成 `[object Object]` 显示给用户是最坏的结果。
 */
export function normalizeLabel(raw: unknown): Label | null {
  if (typeof raw === 'string') return raw as MessageKey;
  if (raw && typeof raw === 'object') {
    const text = (raw as { text?: unknown }).text;
    if (typeof text === 'string') return { text };
  }
  return null;
}

/**
 * select-model.ts — 自绘下拉的索引与键盘意图（纯函数，可单测）。
 *
 * 组件负责画与事件绑定，**索引怎么走**全部在这里。这样「方向键必须跳过
 * disabled 项」「Home/End 定位到首个/末个可选」「输入字母跳转」这些规则
 * 不依赖浏览器就能测。
 */

export interface SelectOption<T = string> {
  value: T;
  label: string;
  disabled?: boolean;
  /**
   * 用这个字族渲染 `label` 自己（字体下拉专用）。
   *
   * 值必须**已经是合法的 CSS `font-family`**（含引号），由调用方过一遍
   * `typography/font/css-family.ts::cssFamily` —— 控件不认识字体注册表。
   */
  fontFamily?: string;
}

/** 连打字母的合并窗口。比操作系统的 500ms 略宽，中文输入法切换时更宽容。 */
export const TYPEAHEAD_RESET_MS = 600;

export function isSelectable(o: SelectOption<unknown>): boolean {
  return !o.disabled;
}

/** 当前值在选项里的下标；找不到（或值非法）返回 -1。 */
export function indexOfValue<T>(options: SelectOption<T>[], value: T): number {
  return options.findIndex((o) => o.value === value);
}

/**
 * 从 `from` 走 `delta` 步，跳过 disabled 项并环绕。
 * 整张表都不可选时返回 -1——组件据此不移动高亮。
 */
export function stepIndex(
  options: SelectOption<unknown>[],
  from: number,
  delta: number,
): number {
  const n = options.length;
  if (n === 0) return -1;
  const dir = delta >= 0 ? 1 : -1;
  let i = from;
  for (let guard = 0; guard < n; guard += 1) {
    i = (i + dir + n) % n;
    if (isSelectable(options[i]!)) return i;
  }
  return isSelectable(options[Math.max(0, from)]!) ? from : -1;
}

export function edgeIndex(
  options: SelectOption<unknown>[],
  edge: 'first' | 'last',
): number {
  if (options.length === 0) return -1;
  const range =
    edge === 'first'
      ? Array.from({ length: options.length }, (_, i) => i)
      : Array.from({ length: options.length }, (_, i) => options.length - 1 - i);
  return range.find((i) => isSelectable(options[i]!)) ?? -1;
}

/**
 * 打字跳转：找 label 以 `buffer` 开头的项，从 `from` 的下一项开始找并环绕。
 * 这样连按同一个字母可以在多个同前缀项之间轮转（原生 select 的行为）。
 */
export function typeaheadIndex(
  options: SelectOption<unknown>[],
  buffer: string,
  from: number,
): number {
  if (!buffer) return from;
  const needle = buffer.toLowerCase();
  const n = options.length;
  if (n === 0) return -1;
  for (let k = 1; k <= n; k += 1) {
    const i = (from + k + n) % n;
    const o = options[i]!;
    if (isSelectable(o) && o.label.toLowerCase().startsWith(needle)) return i;
  }
  return from;
}

export type SelectIntent =
  | 'next'
  | 'prev'
  | 'first'
  | 'last'
  | 'commit'
  | 'cancel'
  | 'open'
  | 'type';

/**
 * 按查询串过滤选项（大小写不敏感的子串匹配）。
 *
 * 为 122 条转场而加：typeahead 只能「按首字母跳到下一项」，在一个上百项、
 * 命名风格还很杂（`CrossZoom` / `burn` / `x_axis_translation`）的列表里不够用。
 *
 * 纯函数，索引语义与 `Select.svelte` 的 `visible` 一致 —— 过滤后**下标会变**，
 * 所以 `active` / `indexOfValue` 都必须作用在过滤后的数组上，不能混用。
 * 空查询原样返回（不产生新数组，便于 `$derived` 省掉一次重算）。
 */
export function filterOptions<T>(
  options: SelectOption<T>[],
  query: string,
): SelectOption<T>[] {
  const q = query.trim().toLowerCase();
  if (!q) return options;
  return options.filter((o) => o.label.toLowerCase().includes(q));
}

/**
 * 键 → 意图。合上时只有「开」这一类；打开后才有导航。
 * 返回 null 表示这个键不归下拉管（放行给页面）。
 */
export function keyIntent(key: string, open: boolean): SelectIntent | null {
  if (!open) {
    if (key === 'Enter' || key === ' ' || key === 'ArrowDown' || key === 'ArrowUp') {
      return 'open';
    }
    if (key === 'Escape') return 'cancel';
    return null;
  }
  switch (key) {
    case 'ArrowDown':
      return 'next';
    case 'ArrowUp':
      return 'prev';
    case 'Home':
      return 'first';
    case 'End':
      return 'last';
    case 'Enter':
    case ' ':
      return 'commit';
    case 'Escape':
    case 'Tab':
      return 'cancel';
    default:
      return key.length === 1 ? 'type' : null;
  }
}

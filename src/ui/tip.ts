/**
 * tip.ts — `use:tip={{ text, shortcut }}` 的 Svelte action。
 *
 * 用 action 而不是包一层组件：调用点往往是 `<button>` 或 `<div>`，
 * 包组件会多一层 DOM 并影响布局（尤其是 flex 行里的对齐）。
 * action 挂在原元素上，零结构变化。
 */

import { tooltip, type TipPlacement } from './tooltip.svelte';

export interface TipOptions {
  text: string;
  shortcut?: string | null;
  /** 气泡方位。工具条贴着轨道区、下方空间紧，用 top 更合适。 */
  placement?: TipPlacement;
  /** 置真时完全不响应（例如 disabled 状态想给别的提示）。 */
  disabled?: boolean;
}

export function tip(node: HTMLElement, options: TipOptions) {
  let opts = options;

  const enter = (): void => {
    if (opts.disabled || !opts.text) return;
    tooltip.hint(opts.text, opts.shortcut ?? null, node, opts.placement ?? 'bottom');
  };
  const leave = (): void => tooltip.clear(node);
  /** 按下就收起气泡：否则点开的下拉/菜单会被悬停气泡挡住第一项。 */
  const press = (): void => tooltip.hideBubble();

  node.addEventListener('pointerenter', enter);
  node.addEventListener('pointerleave', leave);
  // 键盘用户同样要看得到提示——原生 title 在聚焦时是不显示的，这里补上。
  node.addEventListener('focus', enter);
  node.addEventListener('blur', leave);
  node.addEventListener('pointerdown', press);

  return {
    update(next: TipOptions) {
      const textChanged = next.text !== opts.text;
      opts = next;
      // 内容变了而指针还在上面：刷新底栏文字，气泡不重开（避免跳动）。
      if (textChanged && tooltip.owner === node) {
        tooltip.text = opts.disabled ? null : opts.text;
        tooltip.shortcut = opts.shortcut ?? null;
      }
    },
    destroy() {
      node.removeEventListener('pointerenter', enter);
      node.removeEventListener('pointerleave', leave);
      node.removeEventListener('focus', enter);
      node.removeEventListener('blur', leave);
      node.removeEventListener('pointerdown', press);
      // 这里处在卸载流程里，但 clear() 内部把状态写入异步化了，
      // 所以直接调是安全的（见 tooltip.svelte.ts 的 clear 注释）。
      tooltip.clear(node);
    },
  };
}

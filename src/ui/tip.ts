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
    /**
     * 只换掉以后要用的参数，**不去动已经挂出的气泡**。
     *
     * 内容变了而指针还在上面时「就地刷新」曾经是必要的 —— 那时底栏在读这份文字，
     * 不刷新底栏就会停在旧文案上。现在气泡是唯一消费者，而它的字取自进入那一刻
     * （指针没离开，说的就还是同一个控件），点击又会 `hideBubble` ——
     * 为了「动态文案」多写一条同步写 `$state` 的路径，风险大于收益
     * （Svelte 的 `state_unsafe_mutation` 就是这么踩到的，见 tooltip.svelte.ts 的 clear）。
     */
    update(next: TipOptions) {
      opts = next;
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

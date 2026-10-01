/**
 * tooltip.svelte.ts — 提示状态。
 *
 * 用户拍板的形式是**悬浮气泡 + 底栏同步显示**：
 *   - 鼠标进入/键盘聚焦 → 立刻把文字写到 hint（底栏马上显示，零延迟，
 *     因为底栏是「我现在指着什么」的即时反馈，不该等）；
 *   - 悬浮约 350ms 后才浮出气泡（延迟是为了不被快速划过时的气泡雨糊满屏）。
 *
 * 取代全仓库 29 处原生 `title=`：原生气泡不可控（字体/延迟/位置由浏览器决定）、
 * 不能带快捷键角标、也不显示在底栏。
 */

export const TIP_DELAY_MS = 350;

/** 气泡方位：默认在锚点下方；靠近屏幕底部的区域（如轨道工具条）用 top。 */
export type TipPlacement = 'top' | 'bottom';

export interface TipBubble {
  text: string;
  shortcut: string | null;
  placement: TipPlacement;
  /** 锚点矩形（视口坐标）。贴边收敛在 Tip.svelte 里做。 */
  anchor: { left: number; top: number; right: number; bottom: number };
}

class TooltipState {
  /** 底栏同步用的即时提示。 */
  text = $state<string | null>(null);
  shortcut = $state<string | null>(null);
  /** 浮出的气泡（延迟后才有）。 */
  bubble = $state<TipBubble | null>(null);
  /** 当前「持有」提示的元素，用于避免嵌套元素的进入/离开互相打断。 */
  owner: Element | null = null;

  private timer: ReturnType<typeof setTimeout> | null = null;
  /** 清空的代际号：微任务里比对，避免迟到的 clear 抹掉新的 hint。 */
  private seq = 0;

  hint(text: string, shortcut: string | null, el: Element, placement: TipPlacement = 'bottom'): void {
    this.seq += 1;
    this.owner = el;
    this.text = text;
    this.shortcut = shortcut;
    this.cancelTimer();
    this.bubble = null;
    if (!text) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      // 期间提示可能已被换掉/清空，落笔前再确认一次。
      if (this.owner !== el || this.text !== text) return;
      const r = el.getBoundingClientRect();
      this.bubble = {
        text,
        shortcut,
        placement,
        anchor: { left: r.left, top: r.top, right: r.right, bottom: r.bottom },
      };
    }, TIP_DELAY_MS);
  }

  /**
   * 只收起气泡，保留底栏的提示文字。
   *
   * 点击时必须调用：气泡是 `pointer-events: none` 的浮层，点开下拉/菜单后它会
   * 继续悬在那里挡住刚弹出的第一个选项（实测踩到）。底栏文字保持不动是对的
   * ——鼠标还在这个控件上，底栏本来就该继续说明它是什么。
   */
  hideBubble(): void {
    this.cancelTimer();
    this.bubble = null;
  }

  /**
   * 清空提示。
   *
   * **状态写入必须异步**。`pointerleave` 会在节点被 `remove()` 时**被动触发**，
   * 而那一刻仍在 Svelte 的卸载流程里、`active_reaction` 还是渲染 effect——
   * 同步写 `text`（StatusBar 正在读它）会抛
   * `state_unsafe_mutation`。实测「关掉检查器抽屉」必现。
   * 挪到微任务后，写入发生在本轮同步 flush 之外。
   */
  clear(el?: Element): void {
    // 只有「当前持有者」能清，避免父子元素进出顺序错乱时闪断。
    if (el && this.owner && this.owner !== el) return;
    this.cancelTimer();
    const seq = (this.seq += 1);
    queueMicrotask(() => {
      if (seq !== this.seq) return; // 期间又有新的 hint/clear，这次作废
      this.owner = null;
      this.text = null;
      this.shortcut = null;
      this.bubble = null;
    });
  }

  private cancelTimer(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }
}

export const tooltip = new TooltipState();

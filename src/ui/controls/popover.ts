/**
 * popover.ts — 浮层的定位与关闭。
 *
 * 定位逻辑是**纯函数**，因为这块出过真事故：右键菜单在窗口右下角会整个溢出到
 * 视口外，按钮点不到（当时是 E2E 抓到的）。抽成纯函数之后可以单测各种边缘，
 * 不必靠人肉拖到屏幕角落去试。
 *
 * 关闭逻辑（外点 / 滚轮 / Esc）原来长在 Timeline.svelte 里，现在抽到这里，
 * 让菜单、下拉、侧栏面板共用一份——三处各写一套必然出现行为不一致。
 */

export type PopoverPlacement = 'bottom-start' | 'bottom-end' | 'right-start';

export interface Rect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface Size {
  width: number;
  height: number;
}

export interface Placement {
  x: number;
  y: number;
  /** 实际采用的方位（可能与请求的不同，被翻转了）。 */
  placement: PopoverPlacement;
  flipped: boolean;
}

/** 贴着视口边缘留白，避免面板紧贴边界看起来像被裁掉。 */
export const EDGE_MARGIN = 6;
/** 浮层与锚点之间的间隙。 */
export const ANCHOR_GAP = 4;

function clampAxis(v: number, size: number, viewport: number): number {
  const max = Math.max(EDGE_MARGIN, viewport - EDGE_MARGIN - size);
  return Math.min(Math.max(v, EDGE_MARGIN), max);
}

/**
 * 计算浮层左上角坐标。
 *
 * 规则：先按请求方位摆；若该方向放不下，**翻转**到反方向；翻转后仍放不下
 * 就沿该轴钳进视口。所以「在屏幕最底下的那个轨道上右键」不会再溢出。
 */
export function computePopoverPosition(
  anchor: Rect,
  panel: Size,
  viewport: Size,
  placement: PopoverPlacement = 'bottom-start',
  gap = ANCHOR_GAP,
): Placement {
  if (placement === 'right-start') {
    const rightX = anchor.right + gap;
    const fitsRight = rightX + panel.width <= viewport.width - EDGE_MARGIN;
    // 子菜单向右放不下就翻到左侧（父菜单通常是往右展开的。
    // 这里左侧位置 = 锚点左边再减一个面板宽）
    const x = fitsRight ? rightX : anchor.left - panel.width - gap;
    return {
      x: clampAxis(x, panel.width, viewport.width),
      y: clampAxis(anchor.top, panel.height, viewport.height),
      placement: fitsRight ? 'right-start' : 'right-start',
      flipped: !fitsRight,
    };
  }

  const belowY = anchor.bottom + gap;
  const fitsBelow = belowY + panel.height <= viewport.height - EDGE_MARGIN;
  const y = fitsBelow ? belowY : anchor.top - panel.height - gap;

  const wantedX = placement === 'bottom-end' ? anchor.right - panel.width : anchor.left;

  return {
    x: clampAxis(wantedX, panel.width, viewport.width),
    y: clampAxis(y, panel.height, viewport.height),
    placement,
    flipped: !fitsBelow,
  };
}

/* ------------------------------------------------------------ 关闭 */

export interface DismissOptions {
  onclose: () => void;
  /** 允许这些元素内部的点击不触发关闭（一般是浮层自身）。 */
  isInside?: (target: Node) => boolean;
  closeOnWheel?: boolean;
  closeOnEscape?: boolean;
  /** 右键不关闭：它要开的是新菜单。 */
  keepOnRightButton?: boolean;
  /** 面板打开时刚发生的那次 pointerdown 不该立刻关掉它。 */
  ignoreNextPointerDown?: boolean;
}

export interface DismissHandle {
  destroy(): void;
}

/** 挂一组 window 级监听，任一触发就 onclose。返回的 handle 由调用方 destroy。 */
export function attachDismiss(opts: DismissOptions): DismissHandle {
  let skipNext = opts.ignoreNextPointerDown === true;

  const onPointerDown = (e: PointerEvent): void => {
    if (skipNext) {
      skipNext = false;
      return;
    }
    if (opts.keepOnRightButton && e.button !== 0) return;
    if (opts.isInside?.(e.target as Node)) return;
    opts.onclose();
  };

  const onWheel = (): void => opts.onclose();
  const onKey = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') opts.onclose();
  };

  window.addEventListener('pointerdown', onPointerDown, true);
  if (opts.closeOnWheel !== false) window.addEventListener('wheel', onWheel, true);
  if (opts.closeOnEscape !== false) window.addEventListener('keydown', onKey);

  return {
    destroy() {
      window.removeEventListener('pointerdown', onPointerDown, true);
      if (opts.closeOnWheel !== false) window.removeEventListener('wheel', onWheel, true);
      if (opts.closeOnEscape !== false) window.removeEventListener('keydown', onKey);
    },
  };
}

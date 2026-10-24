<script lang="ts">
  /**
   * ImagePopShell — 「图片格式」四个浮层共用的外壳（定位 / 关闭 / 标题）。
   *
   * 四份浮层各自抄一遍 `computePopoverPosition` + `attachDismiss` 的话，
   * 关闭手势迟早会有一份漏掉（滚轮、外点、Esc 三种），表现是「某个浮层点不动
   * 也关不掉」。定位与关闭只在这里写一次。
   *
   * 锚点由编辑器按 `IMAGE_TOOL_TESTIDS` 现查后传进来：Ribbon 的按钮只能发
   * 无参意图（见 `ribbon-defs.ts`）。与 `CanvasSizePopover` 同一套写法。
   */
  import type { Snippet } from 'svelte';
  import Icon from '../Icon.svelte';
  import { attachDismiss, computePopoverPosition } from '../controls/popover';
  import { tr } from '../../i18n/index.svelte';

  interface Props {
    anchor: HTMLElement;
    onclose: () => void;
    title: string;
    testid: string;
    width?: number;
    children: Snippet;
    footer?: Snippet;
  }
  const { anchor, onclose, title, testid, width = 268, children, footer }: Props = $props();

  let panelEl = $state<HTMLDivElement | undefined>(undefined);
  const pos = $state({ x: -1, y: -1 });
  const positioned = $derived(pos.x >= 0 && pos.y >= 0);

  $effect(() => {
    if (!panelEl) return;
    // 触发按钮在 Ribbon 顶部，所以往下弹；放不下时自己翻到上方并钳进视口。
    const p = computePopoverPosition(
      anchor.getBoundingClientRect(),
      { width: panelEl.offsetWidth, height: panelEl.offsetHeight },
      { width: window.innerWidth, height: window.innerHeight },
      'bottom-start',
    );
    if (pos.x !== p.x || pos.y !== p.y) {
      pos.x = p.x;
      pos.y = p.y;
    }
  });

  $effect(() => {
    const handle = attachDismiss({
      onclose,
      // 锚点也算「里面」：再点一次按钮是编辑器的开合手势，这里不要抢先关。
      isInside: (t) => panelEl?.contains(t) === true || anchor.contains(t),
      /*
       * 右键**不关**：曲线编辑器里右键删控制点（与图库的右键菜单同一条理由）。
       * 默认行为是按下即关，那样 contextmenu 根本落不到画布上。
       */
      keepOnRightButton: true,
    });
    return () => handle.destroy();
  });
</script>

<div
  class="ipop"
  bind:this={panelEl}
  role="dialog"
  aria-label={title}
  data-testid={testid}
  style:left={`${pos.x}px`}
  style:top={`${pos.y}px`}
  style:width={`${width}px`}
  style:visibility={positioned ? undefined : 'hidden'}
  onwheel={(e) => e.stopPropagation()}
>
  <div class="ipop-head">
    <span class="ipop-title">{title}</span>
    <button
      type="button"
      class="ipop-x"
      title={tr('rib.imgClose')}
      aria-label={tr('rib.imgClose')}
      data-testid={`${testid}-close`}
      onclick={onclose}
    >
      <Icon name="x" size={12} />
    </button>
  </div>
  <div class="ipop-body">
    {@render children()}
  </div>
  {#if footer}
    <div class="ipop-foot">{@render footer()}</div>
  {/if}
</div>

<style>
  .ipop {
    position: fixed;
    z-index: var(--z-menu);
    padding: var(--sp-2) var(--sp-3) var(--sp-3);
    background: var(--menu-bg);
    border: 1px solid var(--menu-border);
    border-radius: var(--radius-md);
    box-shadow: var(--menu-shadow);
  }
  .ipop-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--sp-2);
    margin-bottom: var(--sp-1);
  }
  .ipop-title {
    color: var(--text-secondary);
    font-size: var(--fs-xs);
    letter-spacing: 0.02em;
  }
  .ipop-x {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 18px;
    height: 18px;
    padding: 0;
    background: transparent;
    border: none;
    border-radius: var(--radius-sm);
    color: var(--text-muted);
    cursor: pointer;
  }
  .ipop-x:hover {
    background: var(--surface-hover);
    color: var(--text-primary);
  }
  .ipop-body {
    display: flex;
    flex-direction: column;
    gap: var(--sp-1);
  }
  .ipop-foot {
    display: flex;
    justify-content: flex-end;
    gap: var(--sp-1);
    margin-top: var(--sp-2);
    padding-top: var(--sp-2);
    border-top: 1px solid var(--border);
  }
</style>

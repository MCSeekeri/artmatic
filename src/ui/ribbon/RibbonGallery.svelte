<script lang="ts">
  /**
   * RibbonGallery — 以**预览图**为内容的插入面板（插入形状用）。
   *
   * 为什么不用 Select：形状靠名字挑不出来。「圆角矩形 / 梯形 / 平行四边形」
   * 这些名字摆在下拉里，用户还得在脑子里把名字翻成图形；PPT 的做法是直接
   * 给一排缩略图，看一眼就知道要哪个。
   *
   * 缩略图**就是形状本身**：同一条 `shapeGeometry` 生成 `d`，与舞台上渲染的
   * 是同一份几何 —— 面板里看到的形状与插出来的形状不可能不一致。
   * 不给文字说明，`label` 只作 tooltip 与无障碍名。
   *
   * 定位复用 popover.ts（含贴边翻转），与 Select 的弹层同一套。
   */
  import Icon from '../Icon.svelte';
  import { attachDismiss, computePopoverPosition } from '../controls/popover';
  import type { GalleryCard } from './ribbon-model';

  interface Props {
    cards: GalleryCard[];
    label: string;
    icon?: 'shapes';
    columns?: number;
    disabled?: boolean;
    testid?: string;
    onselect: (id: string) => void;
  }
  const { cards, label, icon = 'shapes', columns = 6, disabled = false, testid = 'gallery', onselect }: Props = $props();

  let open = $state(false);
  let triggerEl = $state<HTMLDivElement | undefined>(undefined);
  let panelEl = $state<HTMLDivElement | undefined>(undefined);
  const pos = $state({ x: -1, y: -1 });

  /** 弹层 id，供 aria-controls 指向（combobox 角色要求它存在）。 */
  const listboxId = $props.id();

  const positioned = $derived(pos.x >= 0 && pos.y >= 0);

  function close(): void {
    open = false;
    pos.x = -1;
    pos.y = -1;
  }

  $effect(() => {
    void open;
    if (!open) return;
    if (!panelEl || !triggerEl) return;
    const anchor = triggerEl.getBoundingClientRect();
    const p = computePopoverPosition(
      anchor,
      { width: panelEl.offsetWidth, height: panelEl.offsetHeight },
      { width: window.innerWidth, height: window.innerHeight },
    );
    if (pos.x !== p.x || pos.y !== p.y) {
      pos.x = p.x;
      pos.y = p.y;
    }
  });

  $effect(() => {
    if (!open) return;
    const handle = attachDismiss({
      onclose: close,
      isInside: (t) => panelEl?.contains(t) === true || triggerEl?.contains(t) === true,
    });
    return () => handle.destroy();
  });

  function pick(card: GalleryCard): void {
    close();
    onselect(card.id);
  }
</script>

<div
  class="rg"
  role="combobox"
  aria-expanded={open}
  aria-haspopup="listbox"
  aria-controls={open ? listboxId : undefined}
  aria-label={label}
  aria-disabled={disabled}
  tabindex={disabled ? -1 : 0}
  bind:this={triggerEl}
  data-exempt
  data-testid={testid}
  onclick={() => !disabled && (open ? close() : (open = true))}
  onkeydown={(e) => {
    if (disabled) return;
    if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown') {
      e.preventDefault();
      open ? close() : (open = true);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      close();
    }
  }}
>
  <span class="rg-icon"><Icon name={icon} size={16} /></span>
  <span class="rg-label">{label}</span>
</div>

{#if open}
  <div
    class="rg-pop"
    id={listboxId}
    bind:this={panelEl}
    role="listbox"
    data-testid={`${testid}-pop`}
    style:left={`${pos.x}px`}
    style:top={`${pos.y}px`}
    style:visibility={positioned ? undefined : 'hidden'}
  >
    <div class="rg-grid" style:--gallery-cols={String(columns)}>
      {#each cards as card (card.id)}
        <button
          type="button"
          class="rg-card"
          role="option"
          aria-selected="false"
          title={card.label}
          aria-label={card.label}
          data-testid={`${testid}-card-${card.id}`}
          onclick={() => pick(card)}
        >
          <!--
            缩略图默认**实心填充、不描边**。

            原来的描边写法有两个叠加的问题：`vector-effect="non-scaling-stroke"`
            + `stroke-width="3"` 让线宽是**屏幕**像素，在 34px 的卡片上占掉内容的
            八分之一（看着就是一圈极粗的框）；而图形的顶点本来就在 viewBox 边界上
            （`M0,0 … H100`），线宽的一半落到框外**直接被裁掉** —— 八边形、菱形、
            扇形的尖角因此看起来是平的。

            填充没有这两个问题：没有线宽，也就没有溢出。颜色走 `currentColor`，
            跟着按钮的 `color` 走（普通态是次级文字色，hover 变主题色）。
          -->
          <svg viewBox={card.viewBox} preserveAspectRatio="xMidYMid meet" aria-hidden="true">
            {#if card.outline}
              <path d={card.d} fill="none" stroke="currentColor" stroke-width="7" />
            {:else}
              <path
                d={card.d}
                fill="currentColor"
                fill-rule={card.evenOdd ? 'evenodd' : 'nonzero'}
                stroke="none"
              />
            {/if}
          </svg>
        </button>
      {/each}
    </div>
  </div>
{/if}

<style>
  .rg {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 2px;
    min-width: 46px;
    height: 100%;
    padding: 0 6px;
    background: transparent;
    border: 1px solid transparent;
    border-radius: var(--radius-sm);
    color: var(--text-secondary);
    cursor: pointer;
    user-select: none;
  }
  /* 兜底表（app.css 的 button/div hover）不会给这里加背景，自己写。
     变量与 RibbonButton 共用同一套 —— 新增一套「面板按钮 hover 色」
     等于把同一个视觉决定拆成两份真源。 */
  .rg:hover:not([aria-disabled='true']) {
    background: var(--ribbon-btn-bg-hover);
    color: var(--ribbon-btn-fg-hover);
  }
  .rg[aria-expanded='true'] {
    background: var(--ribbon-btn-bg-active);
    color: var(--ribbon-btn-fg-active);
    border-color: var(--accent-border);
  }
  .rg[aria-disabled='true'] {
    color: var(--text-disabled);
    cursor: default;
  }
  .rg-icon {
    display: inline-flex;
  }
  .rg-label {
    font-size: var(--fs-xs);
    line-height: 1.1;
    white-space: nowrap;
  }

  .rg-pop {
    position: fixed;
    z-index: var(--z-menu);
    padding: var(--sp-2);
    background: var(--menu-bg);
    border: 1px solid var(--menu-border);
    border-radius: var(--radius-md);
  }
  .rg-grid {
    display: grid;
    grid-template-columns: repeat(var(--gallery-cols, 6), 34px);
    gap: 2px;
  }
  .rg-card {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 34px;
    height: 34px;
    padding: 4px;
    background: transparent;
    border: 1px solid transparent;
    border-radius: var(--radius-sm);
    color: var(--text-secondary);
    cursor: pointer;
  }
  .rg-card:hover {
    background: var(--surface-hover);
    border-color: var(--border);
    color: var(--accent);
  }
  .rg-card svg {
    width: 100%;
    height: 100%;
    display: block;
  }
</style>

<script lang="ts">
  /**
   * Tip — 悬浮提示气泡（根级单例）。
   *
   * 只在 App 根部渲染一次；任何元素用 `use:tip={{ text, shortcut }}` 挂上即可。
   * 与底栏（StatusBar 的提示段）**不是同一件事**：气泡说的是「这个控件是什么」，
   * 底栏说的是「现在能做什么」。底栏原来抄气泡的文字，现在两边各管各的
   * —— 见 `tooltip.svelte.ts` 与 `hints.ts` 的注释。
   *
   * 位置：默认在锚点正下方居中，贴边时钳进视口（复用 popover 的边距常量）。
   */
  import { EDGE_MARGIN, computePopoverPosition } from './controls/popover';
  import { tooltip } from './tooltip.svelte';

  let el = $state<HTMLDivElement | undefined>(undefined);
  const pos = $state({ x: -1, y: -1 });

  $effect(() => {
    const b = tooltip.bubble;
    if (!b || !el) return;
    const size = { width: el.offsetWidth, height: el.offsetHeight };
    const vp = { width: window.innerWidth, height: window.innerHeight };
    const place = b.placement;
    // 先按「下方」算一次拿到 y，再按需要的方位翻过去并钳进视口。
    const base = computePopoverPosition(b.anchor, size, vp, 'bottom-start', 6);
    const rawY = place === 'top' ? b.anchor.top - size.height - 6 : base.y;
    const y = Math.min(Math.max(rawY, EDGE_MARGIN), Math.max(EDGE_MARGIN, vp.height - EDGE_MARGIN - size.height));
    // 气泡是对称的：水平居中于锚点，而不是左对齐
    const centered = b.anchor.left + (b.anchor.right - b.anchor.left) / 2 - size.width / 2;
    const maxX = Math.max(EDGE_MARGIN, vp.width - EDGE_MARGIN - size.width);
    const x = Math.min(Math.max(centered, EDGE_MARGIN), maxX);
    if (pos.x !== x || pos.y !== y) {
      pos.x = x;
      pos.y = y;
    }
  });
</script>

{#if tooltip.bubble}
  <div
    class="tip"
    bind:this={el}
    role="tooltip"
    data-testid="tip-bubble"
    style:left={`${pos.x}px`}
    style:top={`${pos.y}px`}
    style:visibility={pos.x >= 0 ? undefined : 'hidden'}
  >
    {tooltip.bubble.text}
    {#if tooltip.bubble.shortcut}<span class="tip-key">{tooltip.bubble.shortcut}</span>{/if}
  </div>
{/if}

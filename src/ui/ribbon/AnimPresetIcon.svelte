<script lang="ts">
  /**
   * AnimPresetIcon — 一个动画预设的**示意图形**（Ribbon 里那两张脸共用这一份）。
   *
   * 为什么单独一个组件：同一个图标要出现在「动画」页的宽条里（30px）和
   * 「添加动画」弹层里（30px），两处都手写一遍图元循环的话，改一次描边宽度
   * 就要改两处 —— 而视觉上它们必须**逐像素相同**（用户会并列看到）。
   *
   * 图元坐标系是 `0 0 32 32`（见 `ui/typography/anim-catalog.ts`），
   * 颜色只走 `currentColor`：图标不自己决定颜色，跟着宿主按钮的 `color` 走。
   */
  import { animIconOf } from '../typography/anim-catalog';
  import type { AnimPreset } from '../../typography/animation';

  interface Props {
    id: AnimPreset;
    /** 边长（px）。图元按 viewBox 等比缩放，改这个不必改图标表。 */
    size?: number;
  }
  const { id, size = 30 }: Props = $props();
</script>

<svg
  class="preset-ico"
  viewBox="0 0 32 32"
  aria-hidden="true"
  style:width={`${size}px`}
  style:height={`${size}px`}
>
  {#each animIconOf(id) as prim, i (i)}
    {#if prim.k === 'sq'}
      <rect
        x={prim.x}
        y={prim.y}
        width={prim.w}
        height={prim.h}
        rx={prim.r}
        fill={prim.dashed ? 'none' : 'currentColor'}
        stroke={prim.dashed ? 'currentColor' : 'none'}
        stroke-width={prim.dashed ? 1.8 : 0}
        stroke-dasharray={prim.dashed ? '3 2.6' : undefined}
        opacity={prim.o ?? 1}
      />
    {:else}
      <path
        d={prim.d}
        fill="none"
        stroke="currentColor"
        stroke-width={prim.sw ?? 1.6}
        stroke-linecap="round"
        stroke-linejoin="round"
        opacity={prim.o ?? 1}
      />
    {/if}
  {/each}
</svg>

<style>
  .preset-ico {
    display: block;
    flex: none;
  }
</style>

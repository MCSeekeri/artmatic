<script lang="ts">
  /**
   * ImageSizePopover — 调整图片大小（文档 px）。
   *
   * 与「画布大小」浮层同一套版式：宽 / 高 + 比例锁 + 一排百分比。差别是这里
   * 改的是**元素框**（不是文档），而且写入一律**保持中心不动**（见
   * `image-geometry.ts::resizeFrameCentered`）：锚在左上角的话缩小时图会往
   * 左上「跑」，用户会以为「调大小把位置也改了」。
   */
  import NumberInput from '../controls/NumberInput.svelte';
  import IconButton from '../controls/IconButton.svelte';
  import Field from '../controls/Field.svelte';
  import ImagePopShell from './ImagePopShell.svelte';
  import type { Size, TextureFrame } from '../../typography/document';
  import { tr } from '../../i18n/index.svelte';

  interface Props {
    anchor: HTMLElement;
    onclose: () => void;
    frame: TextureFrame;
    /** 素材原始像素尺寸（「原始大小」与百分比的口径）；未知时按当前框算。 */
    natural: Size | null;
    /** 写入新宽高（`lock` 由本组件维护，动作层只负责居中与钳制）。 */
    onresize: (next: { w?: number; h?: number }, lockAspect: boolean) => void;
  }
  const { anchor, onclose, frame, natural, onresize }: Props = $props();

  let lock = $state(true);
  const base = $derived(natural && natural.w > 0 && natural.h > 0 ? natural : { w: frame.w, h: frame.h });
  const PERCENTS = [25, 50, 100, 200];
</script>

<ImagePopShell {anchor} {onclose} title={tr('rib.imageSize')} testid="img-size-pop" width={252}>
  <Field label={tr('rib.imgSizeWidth')} labelWidth={24}>
    <NumberInput
      value={Math.round(frame.w)}
      min={1}
      step={1}
      width={62}
      testid="img-size-w"
      onchange={(v) => onresize({ w: Math.max(1, v) }, lock)}
    />
    <IconButton
      icon={lock ? 'lock' : 'lock-open'}
      label={tr('rib.imgSizeLock')}
      tipText={tr('rib.imgSizeLock')}
      size="sm"
      active={lock}
      testid="img-size-lock"
      onclick={() => (lock = !lock)}
    />
  </Field>
  <Field label={tr('rib.imgSizeHeight')} labelWidth={24}>
    <NumberInput
      value={Math.round(frame.h)}
      min={1}
      step={1}
      width={62}
      testid="img-size-h"
      onchange={(v) => onresize({ h: Math.max(1, v) }, lock)}
    />
  </Field>

  <div class="row">
    <span class="cap">{tr('rib.imgSizePercent')}</span>
    {#each PERCENTS as p (p)}
      <button
        type="button"
        class="chip"
        data-testid={`img-size-pct-${p}`}
        onclick={() => onresize({ w: Math.max(1, (base.w * p) / 100) }, true)}
      >
        {p}%
      </button>
    {/each}
  </div>

  <button
    type="button"
    class="chip wide"
    data-testid="img-size-original"
    onclick={() => onresize({ w: base.w, h: base.h }, false)}
  >
    {tr('rib.imgSizeOriginal')}
  </button>
</ImagePopShell>

<style>
  .row {
    display: flex;
    align-items: center;
    gap: var(--sp-1);
    margin-top: var(--sp-2);
  }
  .cap {
    margin-right: 2px;
    color: var(--text-secondary);
    font-size: var(--fs-xs);
  }
  .chip {
    padding: 1px 7px;
    background: var(--surface-2);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    color: var(--text-secondary);
    font-size: var(--fs-xs);
    cursor: pointer;
  }
  .chip:hover {
    background: var(--surface-hover);
    border-color: var(--border-strong);
    color: var(--text-primary);
  }
  .wide {
    width: 100%;
    margin-top: var(--sp-2);
    padding: 3px 0;
  }
</style>

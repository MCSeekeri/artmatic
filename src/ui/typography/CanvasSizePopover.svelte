<script lang="ts">
  /**
   * CanvasSizePopover — 「画幅」与「上屏大小」的浮层（受控，触发按钮在 Ribbon 里）。
   *
   * 触发器是「设计」Ribbon 里的「画布大小」（`ribbon-canvas-size`）：编辑器把
   * 那个按钮的 DOM 当锚点传进来。触发器不在这个组件里，是因为 Ribbon 的按钮由
   * `ribbon-defs` 描述生成、只能发意图（`onOpenCanvasSize`）—— 把浮层做成受控的，
   * 比让 Ribbon 认识「画布」这件事便宜得多。
   *
   * 两个概念必须分开，混起来就会互相骗：
   *  - **画布**（`doc.size`）= 设计分辨率，决定版式与比例；改它可以让片段不再是
   *    工程比例（9:16 竖条、1:1 方块）。
   *  - **大小**（`clip.transform.sx/sy`）= 上屏缩放。
   * 因为 `fit: 'contain'` 会把画布等比放大，**同比例改画布像素上屏大小不变**
   * （1920×1080 与 1280×720 在 1920×1080 工程里都铺满）。这是最容易当成 bug 的
   * 一条，所以下面有一行「画面上 …」的实时读数，直接给出结果。
   *
   * 写入：画布走 `onsize`（编辑器里是 `editorState.commit`，一笔撤销），大小走
   * `onscale`（片段属性）。两条都**实时生效**，没有确定按钮 —— 与项目里其它
   * 弹层（取色卡、下拉）一致。
   */
  import NumberInput from '../controls/NumberInput.svelte';
  import Slider from '../controls/Slider.svelte';
  import Checkbox from '../controls/Checkbox.svelte';
  import IconButton from '../controls/IconButton.svelte';
  import Field from '../controls/Field.svelte';
  import { attachDismiss, computePopoverPosition } from '../controls/popover';
  import {
    CANVAS_RATIOS,
    MIN_CANVAS_EDGE,
    footprintOf,
    sizeForRatio,
    withLockedAspect,
  } from '../../typography/canvas-size';
  import type { Size } from '../../typography/document';
  import type { SourceClip } from '../../core/schema';
  import { tr } from '../../i18n/index.svelte';

  interface Props {
    /** 锚点元素（Ribbon 里那个按钮）。浮层贴着它向下展开。 */
    anchor: HTMLElement;
    /** 关闭（外点 / 滚轮 / Esc；再点一次按钮由编辑器负责开合）。 */
    onclose: () => void;
    /** 当前画布尺寸（`doc.size`）。 */
    size: Size;
    /** 工程分辨率（比例预设与读数都以它为画面）。 */
    frame: Size;
    /** 片段的适配方式与缩放（读数与实际摆放共用同一份算式）。 */
    fit: SourceClip['fit'];
    sx: number;
    sy: number;
    /** 画布尺寸变化。`scaleContent` = 元素跟着按比例重排。 */
    onsize: (next: Size, scaleContent: boolean) => void;
    /** 上屏缩放（写 `transform.sx/sy`，两轴同一个值）。 */
    onscale: (v: number) => void;
    /** 缩放被关键帧曲线接管时置真 —— 提示「这个数值会被曲线覆盖」。 */
    keyed?: boolean;
  }
  const {
    anchor,
    onclose,
    size,
    frame,
    fit,
    sx,
    sy,
    onsize,
    onscale,
    keyed = false,
  }: Props = $props();

  /** 改画布时是否按比例重排元素（默认是；不勾就只改画布，元素留在原像素位置）。 */
  let scaleContent = $state(true);
  /** 比例锁：改一边另一边跟着变。 */
  let lock = $state(true);
  let panelEl = $state<HTMLDivElement | undefined>(undefined);
  const pos = $state({ x: -1, y: -1 });
  const positioned = $derived(pos.x >= 0 && pos.y >= 0);
  const panelId = $props.id();

  /** 上屏占位：与 `typography/runtime.ts` 的光栅尺寸推导同一份算式。 */
  const foot = $derived(footprintOf(size, frame, fit, sx, sy));
  /** 两轴缩放不一致时读数只反映 X —— 要分轴调去检查器的「缩放 X / Y」。 */
  const scalePct = $derived(Math.round((Number.isFinite(sx) ? sx : 1) * 100));

  /** 改一条边（`'w'` / `'h'`）。锁着比例时另一边跟着变。 */
  function setEdge(edge: 'w' | 'h', v: number): void {
    const next = lock
      ? withLockedAspect(size, edge, v)
      : { ...size, [edge]: Math.max(MIN_CANVAS_EDGE, Math.round(v)) };
    if (next.w === size.w && next.h === size.h) return;
    onsize(next, scaleContent);
  }

  function applyRatio(preset: (typeof CANVAS_RATIOS)[number]): void {
    const next = preset.ratio === null ? { w: frame.w, h: frame.h } : sizeForRatio(preset.ratio, frame);
    if (next.w === size.w && next.h === size.h) return;
    onsize(next, scaleContent);
  }

  $effect(() => {
    if (!panelEl) return;
    // 锚点在 Ribbon 顶部，所以往下弹；放不下时 `computePopoverPosition` 自己翻。
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
    });
    return () => handle.destroy();
  });
</script>

<div
  class="cs-pop"
  id={panelId}
  bind:this={panelEl}
  role="dialog"
  aria-label={tr('typo.canvasSize')}
  data-testid="typo-canvas-pop"
  style:left={`${pos.x}px`}
  style:top={`${pos.y}px`}
  style:visibility={positioned ? undefined : 'hidden'}
  onwheel={(e) => e.stopPropagation()}
>
  <div class="cs-row">
    <Field label={tr('typo.canvasWidth')} labelWidth={40}>
      <NumberInput
        value={size.w}
        min={MIN_CANVAS_EDGE}
        step={2}
        width={62}
        testid="typo-canvas-w"
        onchange={(v) => setEdge('w', v)}
      />
      <IconButton
        icon={lock ? 'lock' : 'lock-open'}
        label={tr('typo.canvasLock')}
        tipText={tr('typo.canvasLockTip')}
        size="sm"
        active={lock}
        testid="typo-canvas-lock"
        onclick={() => (lock = !lock)}
      />
    </Field>
    <Field label={tr('typo.canvasHeight')} labelWidth={40}>
      <NumberInput
        value={size.h}
        min={MIN_CANVAS_EDGE}
        step={2}
        width={62}
        testid="typo-canvas-h"
        onchange={(v) => setEdge('h', v)}
      />
    </Field>
  </div>

  <div class="cs-presets" data-testid="typo-canvas-presets">
    {#each CANVAS_RATIOS as p (p.id)}
      <button
        type="button"
        class="cs-preset"
        data-testid={`typo-canvas-ratio-${p.id}`}
        onclick={() => applyRatio(p)}
      >
        {p.id === 'project' ? tr('typo.canvasRatioProject') : p.id}
      </button>
    {/each}
  </div>

  <div class="cs-checks">
    <Checkbox
      checked={scaleContent}
      label={tr('typo.canvasScaleContent')}
      tipText={tr('typo.canvasScaleContentTip')}
      testid="typo-canvas-scale-content"
      onchange={(v) => (scaleContent = v)}
    />
  </div>

  <Field label={tr('typo.canvasScale')} labelWidth={40} tipText={tr('typo.canvasScaleTip')}>
    <Slider
      min={10}
      max={200}
      step={1}
      value={scalePct}
      ariaLabel={tr('typo.canvasScale')}
      testid="typo-canvas-scale"
      oninput={(v) => onscale(v / 100)}
    />
    <NumberInput
      value={scalePct}
      min={10}
      max={200}
      step={1}
      width={54}
      suffix="%"
      testid="typo-canvas-scale-num"
      onchange={(v) => onscale(v / 100)}
    />
  </Field>

  <!-- 上屏占位读数：contain 会把画布等比放大，画布像素 ≠ 上屏像素。 -->
  <p class="cs-foot mono" data-testid="typo-canvas-footprint">
    {tr('typo.canvasFootprint', { w: foot.w, h: foot.h, pw: foot.pctW, ph: foot.pctH })}
  </p>
  {#if keyed}
    <p class="cs-note">{tr('typo.canvasScaleKeyed')}</p>
  {/if}
</div>

<style>
  .cs-pop {
    position: fixed;
    z-index: var(--z-menu);
    width: 268px;
    padding: var(--sp-3);
    background: var(--menu-bg);
    border: 1px solid var(--menu-border);
    border-radius: var(--radius-md);
  }
  .cs-row :global(.field + .field) {
    margin-top: var(--sp-1);
  }
  .cs-presets {
    display: flex;
    flex-wrap: wrap;
    gap: var(--sp-1);
    margin: var(--sp-2) 0 var(--sp-1);
  }
  .cs-preset {
    padding: 1px 6px;
    background: var(--surface-2);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    color: var(--text-secondary);
    font-size: var(--fs-xs);
    cursor: pointer;
  }
  .cs-preset:hover {
    background: var(--surface-hover);
    border-color: var(--border-strong);
    color: var(--text-primary);
  }
  .cs-checks {
    margin: var(--sp-1) 0;
  }
  .cs-foot {
    margin: var(--sp-1) 0 0;
    color: var(--text-muted);
    font-size: var(--fs-xs);
  }
  .cs-note {
    margin: var(--sp-1) 0 0;
    color: var(--warning);
    font-size: var(--fs-xs);
  }
</style>

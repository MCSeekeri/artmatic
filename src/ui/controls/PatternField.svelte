<script lang="ts">
  /**
   * PatternField — `pattern` 参数的行内控件：缩略图 + 「编辑」+「清空」。
   *
   * 缩略图是**必须的**，不是装饰：参数值是一串 base64，不留一个可视的
   * 缩略图，用户就只能靠「打开编辑器看一眼」来确认自己画的是不是还在。
   * 它同时也是 E2E 唯一能断言的「界面真的更新了」的抓手（`toDataURL` 前后
   * 不一样）—— 只断言 store 的话，「改了文档没改 DOM」这类 bug 一条都抓不到。
   */
  import Button from './Button.svelte';
  import PatternEditorModal from '../pattern/PatternEditorModal.svelte';
  import type { PatternAssetSource } from '../pattern/pattern-import';
  import { tr } from '../../i18n/index.svelte';
  import { decodePattern, liveCount } from '../../algos/pattern-codec';

  interface Props {
    value: string;
    label: string;
    mode?: '2d' | '1d';
    editorSize?: number;
    /** 模拟网格尺寸：编辑器里的「从素材导入」按它采样（见 PatternEditorModal）。 */
    grid?: { w: number; h: number };
    /** 「从素材导入」的数据源。不给 = 编辑器里没有这个按钮（lab 走这条）。 */
    source?: PatternAssetSource;
    colors: { bg: string; live: string };
    disabled?: boolean;
    testid?: string;
    onchange: (v: string) => void;
  }
  const {
    value,
    label,
    mode = '2d',
    editorSize = 32,
    grid,
    source,
    colors,
    disabled = false,
    testid = 'pattern',
    onchange,
  }: Props = $props();

  /** 1D 的模式很扁。用 `$derived`：`mode` 是 prop，直接读会被记成「只捕获初值」。 */
  const THUMB = $derived(mode === '1d' ? { w: 96, h: 18 } : { w: 48, h: 48 });

  let canvas: HTMLCanvasElement;
  let open = $state(false);

  function draw(): void {
    const c = canvas;
    if (!c) return;
    const dpr = window.devicePixelRatio || 1;
    const bw = Math.round(THUMB.w * dpr);
    const bh = Math.round(THUMB.h * dpr);
    if (c.width !== bw || c.height !== bh) {
      c.width = bw;
      c.height = bh;
    }
    const ctx = c.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = colors.bg;
    ctx.fillRect(0, 0, THUMB.w, THUMB.h);

    const bm = decodePattern(value); // 读 `value` —— 这个 effect 的依赖由它建立
    if (!bm) return;
    // contain 适配：图案比例与缩略图框不一致时留边，不拉伸（拉伸会让
    // 非方形图案看起来「变形了」，用户会以为是自己画错了）。
    const k = Math.min(THUMB.w / bm.w, THUMB.h / bm.h);
    const sx = -Math.floor((bm.w * k - THUMB.w) / 2);
    const sy = -Math.floor((bm.h * k - THUMB.h) / 2);
    ctx.fillStyle = colors.live;
    for (let y = 0; y < bm.h; y++) {
      for (let x = 0; x < bm.w; x++) {
        if (!bm.data[y * bm.w + x]) continue;
        ctx.fillRect(sx + x * k, sy + y * k, Math.max(1, k), Math.max(1, k));
      }
    }
  }

  $effect(() => {
    draw();
  });

  const decoded = $derived(decodePattern(value));
  const alive = $derived(decoded ? liveCount(decoded) : 0);
  const hasPattern = $derived(decoded !== null);
</script>

<div class="pf" data-testid={testid}>
  <canvas class="pf-thumb" bind:this={canvas} data-testid={`${testid}-thumb`}></canvas>
  <div class="pf-btns">
    <Button
      label={tr('algo.pattern.edit')}
      variant="outline"
      size="sm"
      {disabled}
      testid={`${testid}-edit`}
      onclick={() => (open = true)}
    />
    {#if hasPattern}
      <Button
        label={tr('algo.pattern.clear')}
        variant="ghost"
        size="sm"
        {disabled}
        testid={`${testid}-clear`}
        onclick={() => onchange('')}
      />
    {:else}
      <span class="pf-empty">{tr('algo.pattern.none')}</span>
    {/if}
  </div>
  <span class="pf-count" data-testid={`${testid}-alive`}>{alive}</span>
</div>

{#if open}
  <PatternEditorModal
    title={label}
    {mode}
    {editorSize}
    {grid}
    {source}
    {colors}
    initial={() => value}
    onclose={() => (open = false)}
    onapply={(v) => {
      onchange(v);
      open = false;
    }}
  />
{/if}

<style>
  .pf {
    display: flex;
    align-items: center;
    gap: var(--sp-2);
    min-width: 0;
  }
  .pf-thumb {
    display: block;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
  }
  .pf-btns {
    display: flex;
    align-items: center;
    gap: 2px;
  }
  .pf-empty {
    color: var(--text-muted);
    font-size: var(--fs-xs);
  }
  .pf-count {
    color: var(--text-muted);
    font-size: var(--fs-xs);
    font-variant-numeric: tabular-nums;
    min-width: 18px;
  }
</style>

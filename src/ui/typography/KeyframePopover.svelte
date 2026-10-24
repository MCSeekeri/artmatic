<script lang="ts">
  /**
   * KeyframePopover — 选中关键帧时浮出来的小卡片：**值 + 这段的缓动**。
   *
   * 为什么合进一个浮层而不是摊在面板里：
   *   · 面板宽度要留给「元素 / 属性 / 时间轴」三列，摊开会把轨道挤没；
   *   · 值只属于**当前这一帧**，把它放进一条常驻底栏等于让大部分时间显示着
   *     与当前操作无关的控件。
   *
   * 缓动是**出向**语义（本帧 → 下一帧，与 `core/curve.ts` 的 `interp` 一致），
   * 所以入口长在关键帧上；末帧没有下一段，缓动控件呈禁用态。
   *
   * 拖动 = 一笔撤销（beginGesture → live → endGesture），点按钮 / 数字 = 一次 commit。
   */
  import IconButton from '../controls/IconButton.svelte';
  import NumberInput from '../controls/NumberInput.svelte';
  import { editorState } from './editor-state.svelte';
  import { createTypographyActions } from './actions';
  import { easingCss } from '../../typography/animation';
  import {
    easeKindOf,
    type StepEase,
    type TrackEase,
  } from '../../typography/animation-tracks';
  import { tr } from '../../i18n/index.svelte';

  interface Props {
    animId: string;
    /** 关键帧时刻（秒）。写入按 `t` 匹配 —— 索引会被重排。 */
    t: number;
    value: number | string;
    /** 数值通道才有单位与范围。 */
    unit: string;
    min?: number;
    max?: number;
    step: number;
    /** `false` = 任意属性，值用文本框。 */
    numeric: boolean;
    ease: TrackEase | null;
    /** 是否还有下一帧（末帧不能设出向缓动）。 */
    hasNext: boolean;
    /** 菱形中心的视口坐标。 */
    at: { x: number; y: number };
    onclose: () => void;
  }
  const { animId, t, value, unit, min, max, step, numeric, ease, hasNext, at, onclose }: Props =
    $props();

  const actions = createTypographyActions();

  const WIDTH = 248;
  const PLOT_W = 216;
  const PLOT_H = 112;
  const CARD_H = 232;

  type Curve = [number, number, number, number];

  const KEYWORD_CURVES: Record<string, Curve> = {
    linear: [0, 0, 1, 1],
    ease: [0.25, 0.1, 0.25, 1],
    'ease-in': [0.42, 0, 1, 1],
    'ease-out': [0, 0, 0.58, 1],
    'ease-in-out': [0.42, 0, 0.58, 1],
  };

  function toCurve(e: TrackEase | null): Curve {
    if (Array.isArray(e)) return [e[0], e[1], e[2], e[3]];
    if (typeof e === 'object' && e) return KEYWORD_CURVES['ease-in-out']!;
    if (typeof e === 'string' && KEYWORD_CURVES[e]) return [...KEYWORD_CURVES[e]] as Curve;
    return KEYWORD_CURVES['ease-in-out']!;
  }

  let curve = $state<Curve>(KEYWORD_CURVES['ease-in-out']!);
  let drag = $state<0 | 1 | null>(null);
  let svgEl = $state<SVGSVGElement | null>(null);
  let cardEl = $state<HTMLDivElement | null>(null);

  // 换了一个关键帧（浮层没关、只是目标变了）时同步一次。
  $effect(() => {
    curve = toCurve(ease);
  });

  const kind = $derived(easeKindOf(ease));
  const stepEase = $derived(kind === 'step' ? (ease as StepEase) : null);
  const stepN = $derived(stepEase ? Math.max(1, Math.round(stepEase.steps)) : 4);
  const stepJump = $derived(stepEase?.jump ?? 'end');
  /** 数值通道传进来的 `value` 一定是 number；这里兜一层只为类型收窄。 */
  const numValue = $derived(typeof value === 'number' ? value : Number(value) || 0);

  const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);
  const X = (x: number): number => x * PLOT_W;
  const Y = (y: number): number => PLOT_H - y * PLOT_H;

  const curvePath = $derived(
    `M ${X(0)} ${Y(0)} C ${X(curve[0])} ${Y(curve[1])}, ${X(curve[2])} ${Y(curve[3])}, ${X(1)} ${Y(1)}`,
  );

  /** 阶梯的示意路径：N 级台阶（与 CSS `steps(n, jump-end)` 的形态一致）。 */
  const stepPath = $derived.by(() => {
    const n = stepN;
    const pts: string[] = [`M ${X(0)} ${Y(0)}`];
    for (let i = 0; i < n; i += 1) {
      const x0 = X(i / n);
      const x1 = X((i + 1) / n);
      const y0 = Y(i / n);
      pts.push(`L ${x1} ${y0}`, `L ${x1} ${Y((i + 1) / n)}`);
      void x0;
    }
    return pts.join(' ');
  });

  function pointerCurve(e: PointerEvent): { x: number; y: number } {
    const el = svgEl;
    if (!el) return { x: 0, y: 0 };
    const r = el.getBoundingClientRect();
    return {
      x: clamp01((e.clientX - r.left) / r.width),
      y: clamp01(1 - (e.clientY - r.top) / r.height),
    };
  }

  function onHandleDown(which: 0 | 1, e: PointerEvent): void {
    if (e.button !== 0 || !hasNext) return;
    e.preventDefault();
    e.stopPropagation();
    drag = which;
    editorState.beginGesture();
    let moved = false;
    const move = (ev: PointerEvent): void => {
      const p = pointerCurve(ev);
      const next: Curve = [...curve] as Curve;
      next[which === 0 ? 0 : 2] = Math.round(p.x * 1000) / 1000;
      next[which === 0 ? 1 : 3] = Math.round(p.y * 1000) / 1000;
      curve = next;
      moved = true;
      actions.liveKeyEase(animId, t, next);
    };
    const up = (): void => {
      drag = null;
      window.removeEventListener('pointermove', move);
      if (moved) editorState.endGesture(tr('typo.undo.keyEase'));
      else editorState.cancelGesture();
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up, { once: true });
  }

  function setEase(next: TrackEase | null): void {
    if (!hasNext) return;
    curve = toCurve(next);
    actions.setKeyEase(animId, t, next);
  }

  function setCurve(next: Curve): void {
    curve = next;
    setEase(next);
  }

  const left = $derived(
    Math.min(Math.max(8, at.x - WIDTH / 2), (globalThis.innerWidth || 1280) - WIDTH - 8),
  );
  /** 先往下开（锚在菱形下方），放不下就翻到上方 —— 两头都不许溢出页面。 */
  const top = $derived(
    at.y + 16 + CARD_H <= (globalThis.innerHeight || 800) - 8
      ? at.y + 16
      : Math.max(8, at.y - CARD_H - 16),
  );
</script>

<svelte:window
  onpointerdown={(e) => {
    if (cardEl && !cardEl.contains(e.target as Node)) onclose();
  }}
  onkeydown={(e) => {
    if (e.key === 'Escape') onclose();
  }}
/>

<div
  class="kf-pop"
  bind:this={cardEl}
  data-testid="typo-kf-pop"
  role="dialog"
  aria-label={tr('typo.kfKey')}
  style:left={`${left}px`}
  style:top={`${top}px`}
  style:width={`${WIDTH}px`}
>
  <div class="row">
    <span class="lab">{tr('typo.kfKeyValue')}</span>
    {#if numeric}
      <NumberInput
        value={numValue}
        {min}
        {max}
        {step}
        suffix={unit}
        width={92}
        testid="typo-kf-key-value"
        onchange={(v) => actions.setKeyValue(animId, t, v)}
      />
    {:else}
      <input
        class="txt"
        value={String(value)}
        data-testid="typo-kf-key-value"
        onchange={(e) => actions.setKeyValue(animId, t, e.currentTarget.value)}
      />
    {/if}
    <span class="spacer"></span>
    <IconButton icon="x" label={tr('common.close')} size="sm" onclick={onclose} />
  </div>

  <svg
    bind:this={svgEl}
    class="plot"
    class:disabled={!hasNext}
    viewBox={`0 0 ${PLOT_W} ${PLOT_H}`}
    role="presentation"
    onpointerdown={(e) => e.stopPropagation()}
  >
    <line class="ref" x1={X(0)} y1={Y(0)} x2={X(1)} y2={Y(1)} />
    {#each [0.25, 0.5, 0.75] as g}
      <line class="grid" x1={X(g)} y1={Y(0)} x2={X(g)} y2={Y(1)} />
      <line class="grid" x1={X(0)} y1={Y(g)} x2={X(1)} y2={Y(g)} />
    {/each}

    {#if kind === 'step'}
      <path class="curve" d={stepPath} />
    {:else}
      <path class="curve" d={curvePath} />
      <line class="arm" x1={X(0)} y1={Y(0)} x2={X(curve[0])} y2={Y(curve[1])} />
      <circle
        class="handle"
        class:on={drag === 0}
        cx={X(curve[0])}
        cy={Y(curve[1])}
        r="4"
        role="presentation"
        onpointerdown={(e) => onHandleDown(0, e)}
      />
      <line class="arm" x1={X(1)} y1={Y(1)} x2={X(curve[2])} y2={Y(curve[3])} />
      <circle
        class="handle"
        class:on={drag === 1}
        cx={X(curve[2])}
        cy={Y(curve[3])}
        r="4"
        role="presentation"
        onpointerdown={(e) => onHandleDown(1, e)}
      />
    {/if}
  </svg>

  <div class="chips">
    <button
      type="button"
      class="chip"
      class:on={ease === 'linear'}
      disabled={!hasNext}
      data-testid="typo-kf-ease-linear"
      onclick={() => setEase('linear')}
    >
      {tr('typo.kfEaseLinear')}
    </button>
    <button
      type="button"
      class="chip"
      class:on={kind === 'curve' && ease !== 'linear'}
      disabled={!hasNext}
      data-testid="typo-kf-ease-curve"
      onclick={() => setEase([0.42, 0, 0.58, 1])}
    >
      {tr('typo.kfEase')}
    </button>
    <button
      type="button"
      class="chip"
      class:on={kind === 'step'}
      disabled={!hasNext}
      data-testid="typo-kf-ease-step"
      onclick={() => setEase({ steps: 4, jump: 'end' })}
    >
      {tr('typo.kfEaseStep')}
    </button>
    <button
      type="button"
      class="chip"
      class:on={!ease}
      disabled={!hasNext}
      data-testid="typo-kf-ease-inherit"
      onclick={() => setEase(null)}
    >
      {tr('typo.kfEaseInherit')}
    </button>
  </div>

  {#if kind === 'step'}
    <div class="row">
      <span class="lab">{tr('typo.kfStepCount')}</span>
      <NumberInput
        value={stepN}
        min={1}
        max={99}
        step={1}
        precision={0}
        width={52}
        testid="typo-kf-step-n"
        onchange={(n) => setEase({ steps: Math.max(1, Math.round(n)), jump: stepJump } as StepEase)}
      />
      <span class="spacer"></span>
      <span class="hint mono">{easingCss(ease ?? 'linear')}</span>
    </div>
  {:else if kind === 'curve'}
    <div class="row">
      {#each [0, 1, 2, 3] as i}
        <NumberInput
          value={curve[i]!}
          min={i % 2 === 0 ? 0 : -2}
          max={i % 2 === 0 ? 1 : 3}
          step={0.01}
          precision={2}
          width={44}
          testid={`typo-kf-ease-n${i}`}
          onchange={(v) => {
            const next: Curve = [...curve] as Curve;
            next[i] = i % 2 === 0 ? clamp01(v) : v;
            setCurve(next);
          }}
        />
      {/each}
    </div>
  {/if}

  {#if !hasNext}
    <p class="note">{tr('typo.kfLastKey')}</p>
  {/if}
</div>

<style>
  .kf-pop {
    position: fixed;
    z-index: var(--z-popover);
    display: flex;
    flex-direction: column;
    gap: var(--sp-1);
    padding: var(--sp-2);
    background: var(--surface-2);
    border: 1px solid var(--border);
    /* 项目视觉纪律的唯一例外（根级浮动面板没有布局槽位）。 */
    box-shadow: var(--shadow-float);
    border-radius: 6px;
  }
  .row {
    display: flex;
    align-items: center;
    gap: var(--sp-2);
    min-height: 20px;
  }
  .lab {
    font-size: var(--fs-xs);
    color: var(--text-secondary);
  }
  .spacer {
    flex: 1;
  }
  .hint {
    font-size: 9px;
    color: var(--text-muted);
  }
  .plot {
    display: block;
    width: 100%;
    height: auto;
    background: var(--surface-0);
    border: 1px solid var(--border);
    border-radius: 4px;
    touch-action: none;
  }
  .plot.disabled {
    opacity: 0.45;
  }
  .grid {
    stroke: var(--border);
    stroke-width: 1;
  }
  .ref {
    stroke: var(--border);
    stroke-dasharray: 3 3;
    stroke-width: 1;
  }
  .curve {
    fill: none;
    stroke: var(--accent);
    stroke-width: 1.5;
  }
  .arm {
    stroke: var(--text-muted);
    stroke-width: 1;
  }
  .handle {
    fill: var(--surface-0);
    stroke: var(--text-secondary);
    stroke-width: 1.5;
    cursor: grab;
  }
  .handle.on {
    fill: var(--accent);
    stroke: var(--accent);
    cursor: grabbing;
  }
  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: var(--sp-1);
  }
  .chip {
    padding: 1px 7px;
    font-size: var(--fs-xs);
    color: var(--text-secondary);
    background: var(--surface-1);
    border: 1px solid var(--border);
    border-radius: 4px;
    cursor: pointer;
  }
  .chip:hover:not(:disabled) {
    background: var(--surface-hover);
    color: var(--text-primary);
  }
  .chip.on {
    color: var(--accent);
    border-color: var(--accent);
  }
  .chip:disabled {
    opacity: 0.4;
    cursor: default;
  }
  .txt {
    height: 20px;
    width: 110px;
    padding: 0 var(--sp-1);
    font-size: var(--fs-xs);
    color: var(--text-primary);
    background: var(--surface-0);
    border: 1px solid var(--border);
    border-radius: 4px;
  }
  .note {
    margin: 0;
    font-size: 9px;
    color: var(--text-muted);
  }
</style>

<script lang="ts">
  /**
   * ImageAdjustPopover — 色彩校正（亮度 / 对比度 / 饱和度 / 锐化 / 柔化 + RGB 曲线）。
   *
   * 曲线放在**这个浮层里**而不是 Ribbon 上：横向条带装不下四条曲线，而曲线
   * 编辑需要一块能拖画布的区域。曲线自己还是一条二级入口（浮层内的通道页签 +
   * 一块 canvas），Ribbon 上只有「色彩校正」一个按钮。
   *
   * 写入分两条路（与右侧面板的抠图滑杆同一套）：
   *  - 拖动滑杆 / 曲线 = `onlive`（不入撤销栈），松手 `onliveend` / `onend` 结算；
   *  - 数字框 / 重置 = `oncommit`（一笔撤销）。
   */
  import NumericField from '../controls/NumericField.svelte';
  import CurveEditor from './CurveEditor.svelte';
  import ImagePopShell from './ImagePopShell.svelte';
  import {
    curvesEmpty,
    type CurveChannel,
    type CurvePoint,
    type ImageAdjust,
    type ImageAdjustPatch,
  } from '../../typography/image-effects';
  import { tr } from '../../i18n/index.svelte';

  interface Props {
    anchor: HTMLElement;
    onclose: () => void;
    adjust: ImageAdjust;
    /** 拖动中（连续写，不入撤销栈）。 */
    onlive: (patch: ImageAdjustPatch) => void;
    /** 离散提交。 */
    oncommit: (patch: ImageAdjustPatch) => void;
    /** 拖动结束（结算成一笔）。 */
    onliveend: () => void;
    /** 曲线通道整体替换（离散提交）。`null` / 空 = 重置该通道。 */
    oncurve: (channel: CurveChannel, points: CurvePoint[] | null) => void;
    /** 曲线拖动中。 */
    oncurvelive: (channel: CurveChannel, points: CurvePoint[]) => void;
    /** 曲线拖动结束。 */
    oncurveend: () => void;
  }
  const {
    anchor,
    onclose,
    adjust,
    onlive,
    oncommit,
    onliveend,
    oncurve,
    oncurvelive,
    oncurveend,
  }: Props = $props();

  let channel = $state<CurveChannel>('master');

  const CHANNELS: { id: CurveChannel; labelKey: 'rib.imgCurveMaster' | 'rib.imgCurveR' | 'rib.imgCurveG' | 'rib.imgCurveB'; color: string }[] = [
    { id: 'master', labelKey: 'rib.imgCurveMaster', color: 'var(--text-primary)' },
    { id: 'r', labelKey: 'rib.imgCurveR', color: '#ff6b6b' },
    { id: 'g', labelKey: 'rib.imgCurveG', color: '#7ee787' },
    { id: 'b', labelKey: 'rib.imgCurveB', color: '#79b8ff' },
  ];

  const active = $derived(CHANNELS.find((c) => c.id === channel) ?? CHANNELS[0]!);
  const points = $derived(adjust.curves?.[channel] ?? []);
  const hasCurve = $derived(!!adjust.curves && !curvesEmpty(adjust.curves));

  /** 滑杆：拖动实时、松手结算。数字框走 `oncommit`（NumericField 的语义）。 */
  function livePatch(patch: ImageAdjustPatch): void {
    onlive(patch);
  }
  function commitPatch(patch: ImageAdjustPatch): void {
    oncommit(patch);
  }
</script>

<ImagePopShell {anchor} {onclose} title={tr('rib.imageAdjust')} testid="img-adjust-pop" width={288}>
  <NumericField
    label={tr('rib.imgBrightness')}
    labelWidth={44}
    numberWidth={46}
    min={-100}
    max={100}
    step={1}
    value={Math.round(adjust.brightness)}
    sliderTestid="img-adjust-brightness"
    numberTestid="img-adjust-brightness-num"
    oninput={(v) => livePatch({ brightness: v })}
    onchange={(v) => commitPatch({ brightness: v })}
  />
  <NumericField
    label={tr('rib.imgContrast')}
    labelWidth={44}
    numberWidth={46}
    min={-100}
    max={100}
    step={1}
    value={Math.round(adjust.contrast)}
    sliderTestid="img-adjust-contrast"
    numberTestid="img-adjust-contrast-num"
    oninput={(v) => livePatch({ contrast: v })}
    onchange={(v) => commitPatch({ contrast: v })}
  />
  <NumericField
    label={tr('rib.imgSaturation')}
    labelWidth={44}
    numberWidth={46}
    min={-100}
    max={100}
    step={1}
    value={Math.round(adjust.saturation)}
    sliderTestid="img-adjust-saturation"
    numberTestid="img-adjust-saturation-num"
    oninput={(v) => livePatch({ saturation: v })}
    onchange={(v) => commitPatch({ saturation: v })}
  />
  <NumericField
    label={tr('rib.imgSharpen')}
    labelWidth={44}
    numberWidth={46}
    min={0}
    max={100}
    step={1}
    value={Math.round(adjust.sharpen)}
    sliderTestid="img-adjust-sharpen"
    numberTestid="img-adjust-sharpen-num"
    oninput={(v) => livePatch({ sharpen: v })}
    onchange={(v) => commitPatch({ sharpen: v })}
  />
  <NumericField
    label={tr('rib.imgSoften')}
    labelWidth={44}
    numberWidth={46}
    min={0}
    max={100}
    step={1}
    value={Math.round(adjust.soften)}
    sliderTestid="img-adjust-soften"
    numberTestid="img-adjust-soften-num"
    oninput={(v) => livePatch({ soften: v })}
    onchange={(v) => commitPatch({ soften: v })}
  />

  <div class="curves">
    <div class="curves-head">
      <span class="curves-title">{tr('rib.imgCurves')}</span>
      <div class="chan">
        {#each CHANNELS as c (c.id)}
          <button
            type="button"
            class="chan-btn"
            class:on={channel === c.id}
            data-testid={`img-curve-ch-${c.id}`}
            aria-pressed={channel === c.id}
            onclick={() => (channel = c.id)}
          >
            {tr(c.labelKey)}
          </button>
        {/each}
      </div>
    </div>
    <CurveEditor
      {points}
      color={active.color}
      onlive={(pts) => oncurvelive(channel, pts)}
      onend={oncurveend}
      oncommit={(pts) => oncurve(channel, pts.length ? pts : null)}
    />
    <div class="curves-foot">
      <button
        type="button"
        class="link"
        data-testid="img-curve-reset"
        disabled={!points.length}
        onclick={() => oncurve(channel, null)}
      >
        {tr('rib.imgCurveReset')}
      </button>
      {#if hasCurve}
        <button
          type="button"
          class="link"
          data-testid="img-curve-reset-all"
          onclick={() => oncommit({ curves: null })}
        >
          {tr('rib.imgResetAll')}
        </button>
      {/if}
    </div>
  </div>
</ImagePopShell>

<style>
  .curves {
    margin-top: var(--sp-2);
    padding-top: var(--sp-2);
    border-top: 1px solid var(--border);
  }
  .curves-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: var(--sp-1);
  }
  .curves-title {
    color: var(--text-secondary);
    font-size: var(--fs-xs);
  }
  .chan {
    display: flex;
    gap: 2px;
  }
  .chan-btn {
    padding: 1px 6px;
    background: var(--surface-2);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    color: var(--text-secondary);
    font-size: var(--fs-xs);
    cursor: pointer;
  }
  .chan-btn.on {
    border-color: var(--accent);
    color: var(--text-primary);
  }
  .curves-foot {
    display: flex;
    justify-content: flex-end;
    gap: var(--sp-2);
    margin-top: var(--sp-1);
  }
  .link {
    padding: 0;
    background: transparent;
    border: none;
    color: var(--text-secondary);
    font-size: var(--fs-xs);
    cursor: pointer;
  }
  .link:hover:not(:disabled) {
    color: var(--accent);
  }
  .link:disabled {
    color: var(--text-muted);
    cursor: default;
  }
</style>

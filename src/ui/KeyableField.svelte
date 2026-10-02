<script lang="ts">
  /**
   * KeyableField — 可打关键帧的数值参数行。
   *
   * 行为约定（沿用原实现，语义未改）：
   *   无曲线：滑杆/数字框改基值。
   *   有曲线：它们改的是**播放头处那个关键帧**（upsertKey）。
   *   ◆ 按钮：播放头处有 key 就删，没有就打（值取当前求值结果）。
   *   「锚到拍」勾选切换 beatAnchor——锚定后曲线的 t=0 对齐 anchor 拍，
   *   改 BPM / offset 时卡点自动跟随（AGENTS.md §5）。
   *
   * 硬契约：滑杆拖动时数字框必须与 store 逐帧一致（|shown - stored| < 1e-6）。
   * 两者读同一个 `value` 派生，所以天然 lock-step；别在这里给滑杆加节流。
   * 控件已全部换成自研件（原生 range/number/checkbox 在本项目禁用）。
   *
   * 数字框的 `oninput` 与 `onchange` 都接到 slide：拖拽时要有实时反馈（否则
   * 松手才出结果，drag-to-tweak 的手感就没了），松手再提交一次是幂等的
   * （updateClip 比对快照，值没变就不入撤销栈）。
   */
  import Checkbox from './controls/Checkbox.svelte';
  import Field from './controls/Field.svelte';
  import IconButton from './controls/IconButton.svelte';
  import NumberInput from './controls/NumberInput.svelte';
  import Slider from './controls/Slider.svelte';
  import { appState } from './app-state.svelte';
  import { evalCurve, type Curve } from '../core/curve';
  import { beatAtTime, snapBeat, timeAtBeat } from '../core/time';
  import { tr } from '../i18n/index.svelte';

  interface Props {
    label: string;
    min: number;
    max: number;
    step: number;
    base: number;
    curve?: Curve;
    clipStart: number;
    onBase: (v: number) => void;
    onKey: (v: number, beatAnchor: { beat: number } | null) => void;
    onRemoveKey: (index: number) => void;
    onAnchorChange: (anchor: { beat: number } | null) => void;
    onClearCurve: () => void;
    /** 额外的说明，进 tooltip 与底栏。 */
    tipText?: string;
  }
  const {
    label,
    min,
    max,
    step,
    base,
    curve,
    clipStart,
    onBase,
    onKey,
    onRemoveKey,
    onAnchorChange,
    onClearCurve,
    tipText,
  }: Props = $props();

  const grid = $derived(appState.project.beatGrid);
  const playT = $derived(appState.playT);
  const value = $derived(curve ? evalCurve(curve, playT, { grid, clipStart }) : base);
  const localT = $derived(
    curve?.beatAnchor ? playT - timeAtBeat(curve.beatAnchor.beat, grid) : playT - clipStart,
  );
  const keyHereIndex = $derived(
    curve ? curve.keys.findIndex((k) => Math.abs(k.t - localT) < Math.max(step / 2, 0.02)) : -1,
  );

  function slide(v: number): void {
    if (curve) onKey(v, curve.beatAnchor ?? null);
    else onBase(v);
  }

  function toggleKey(): void {
    if (!curve) {
      onKey(
        value,
        appState.beatAnchorNewKeys
          ? { beat: snapBeat(beatAtTime(playT, grid), 'beat', grid.beatsPerBar) }
          : null,
      );
      return;
    }
    if (keyHereIndex >= 0) onRemoveKey(keyHereIndex);
    else onKey(value, curve.beatAnchor ?? null);
  }

  const keyTip = $derived(
    curve
      ? keyHereIndex >= 0
        ? tr('ctl.keyframeTipDelete')
        : tr('ctl.keyframeTipAdd')
      : tr('ctl.keyframeTipCreate'),
  );
</script>

<Field label={label} tipText={tipText ?? label}>
  <Slider
    {min}
    {max}
    {step}
    value={Math.max(min, Math.min(max, value))}
    ariaLabel={label}
    oninput={slide}
  />
  <NumberInput
    value={value}
    {min}
    {max}
    {step}
    width={58}
    ariaLabel={tr('ctl.valueAria', { label })}
    oninput={slide}
    onchange={slide}
  />
  {#snippet trailing()}
    <IconButton
      icon="diamond"
      label={keyTip}
      size="sm"
      active={keyHereIndex >= 0}
      testid="keyframe-toggle"
      onclick={toggleKey}
    />
  {/snippet}
</Field>

{#if curve}
  <div class="keys">
    <Checkbox
      checked={!!curve.beatAnchor}
      label={tr('insp.anchorBeat')}
      tipText={tr('insp.anchorTip')}
      testid="anchor-beat"
      onchange={(v) =>
        onAnchorChange(
          v ? { beat: snapBeat(beatAtTime(playT, grid), 'beat', grid.beatsPerBar) } : null,
        )}
    />
    <span class="list">
      {#each curve.keys as k, i (i)}
        <button
          type="button"
          class="key"
          data-testid="curve-key"
          title={tr('ctl.keyframeDeleteTip')}
          onclick={() => onRemoveKey(i)}
        >
          {k.t.toFixed(2)}s={k.v.toFixed(2)}
        </button>
      {/each}
      <IconButton
        icon="trash"
        label={tr('ctl.clearCurve')}
        size="sm"
        variant="danger"
        testid="curve-clear"
        onclick={onClearCurve}
      />
    </span>
  </div>
{/if}

<style>
  .keys {
    display: flex;
    align-items: center;
    gap: var(--sp-3);
    margin: 0 0 var(--sp-2) var(--sp-6);
    flex-wrap: wrap;
  }
  .list {
    display: flex;
    gap: var(--sp-1);
    flex-wrap: wrap;
    align-items: center;
  }
  .key {
    height: 16px;
    padding: 0 var(--sp-1);
    background: transparent;
    border: 1px solid var(--input-border);
    border-radius: 3px;
    color: var(--text-secondary);
    font-family: 'Cascadia Code', Consolas, monospace;
    font-size: var(--fs-xs);
    cursor: pointer;
  }
  .key:hover {
    color: var(--danger);
    border-color: var(--danger);
  }
</style>

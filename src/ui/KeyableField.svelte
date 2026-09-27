<script lang="ts">
  /**
   * KeyableField — 可打关键帧的数值参数行。
   *
   * 行为约定：
   *   无曲线：滑杆改基值。
   *   有曲线：滑杆在播放头处打点（upsertKey）。
   *   ◆ 按钮：播放头处有 key 就删，没有就打（值取当前求值结果）。
   *   「锚到拍」勾选切换 beatAnchor——锚定后曲线的 t=0 对齐 anchor 拍，
   *   改 BPM / offset 时卡点自动跟随（AGENTS.md §5）。
   */
  import { appState } from './app-state.svelte';
  import { evalCurve, type Curve } from '../core/curve';
  import { beatAtTime, snapBeat, timeAtBeat } from '../core/time';

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
      onKey(value, appState.beatAnchorNewKeys ? { beat: snapBeat(beatAtTime(playT, grid), 'beat', grid.beatsPerBar) } : null);
      return;
    }
    if (keyHereIndex >= 0) onRemoveKey(keyHereIndex);
    else onKey(value, curve.beatAnchor ?? null);
  }
</script>

<div class="kf">
  <div class="row">
    <span class="lbl" title={label}>{label}</span>
    <input
      type="range"
      {min}
      {max}
      {step}
      value={Math.max(min, Math.min(max, value))}
      oninput={(e) => slide(+e.currentTarget.value)}
    />
    <input
      class="num"
      type="number"
      {min}
      {max}
      {step}
      value={+value.toFixed(4)}
      onchange={(e) => slide(+e.currentTarget.value)}
    />
    <button
      class="dia"
      class:active={keyHereIndex >= 0}
      title={curve ? (keyHereIndex >= 0 ? '删除播放头处的关键帧' : '在播放头处打关键帧') : '创建曲线并打第一个关键帧'}
      onclick={toggleKey}
    >
      <i class="fa-solid fa-diamond"></i>
    </button>
  </div>
  {#if curve}
    <div class="keys">
      <label class="anchor" title="锚到拍：改 BPM/offset 时卡点自动跟随">
        <input
          type="checkbox"
          checked={!!curve.beatAnchor}
          onchange={(e) =>
            onAnchorChange(
              e.currentTarget.checked
                ? { beat: snapBeat(beatAtTime(playT, grid), 'beat', grid.beatsPerBar) }
                : null,
            )}
        />
        锚到拍
      </label>
      <span class="list">
        {#each curve.keys as k, i (i)}
          <button class="key" title="跳到此关键帧；× 删除" onclick={() => onRemoveKey(i)}>
            {k.t.toFixed(2)}s={k.v.toFixed(2)} <i class="fa-solid fa-xmark"></i>
          </button>
        {/each}
        <button class="clear" title="删除整条曲线（回到固定基值）" onclick={onClearCurve}>
          <i class="fa-solid fa-trash"></i>
        </button>
      </span>
    </div>
  {/if}
</div>

<style>
  .kf {
    margin-bottom: 4px;
  }
  .row {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .lbl {
    width: 64px;
    flex-shrink: 0;
    color: var(--text-1);
    font-size: 11px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  input[type='range'] {
    flex: 1;
    min-width: 0;
  }
  .num {
    width: 60px;
    font-size: 11px;
  }
  .dia {
    padding: 2px 6px;
    font-size: 9px;
    color: var(--text-2);
    background: transparent;
    border-color: transparent;
  }
  .dia.active {
    color: var(--accent);
  }
  .keys {
    display: flex;
    align-items: center;
    gap: 6px;
    margin: 2px 0 4px 70px;
    flex-wrap: wrap;
  }
  .anchor {
    display: flex;
    align-items: center;
    gap: 3px;
    font-size: 10px;
    color: var(--text-2);
    white-space: nowrap;
  }
  .list {
    display: flex;
    gap: 3px;
    flex-wrap: wrap;
  }
  .key {
    font-size: 9px;
    font-family: var(--font-mono);
    padding: 1px 4px;
    color: var(--text-1);
  }
  .clear {
    font-size: 9px;
    padding: 1px 4px;
    color: var(--danger);
    background: transparent;
    border-color: transparent;
  }
</style>

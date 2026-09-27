<script lang="ts">
  import { appState } from './app-state.svelte';
  import { beatAtTime } from '../core/time';
  import { SNAP_MODES, type SnapMode } from '../core/time';
  import type { OverlapBehavior } from '../core/schema';

  const grid = $derived(appState.store?.project.beatGrid);
  const playT = $derived(appState.playT);
  const beatPos = $derived(grid ? beatAtTime(playT, grid) : 0);
  const barBeat = $derived.by(() => {
    if (!grid) return '--';
    const b = Math.max(0, beatPos);
    const bar = Math.floor(b / grid.beatsPerBar) + 1;
    const beat = Math.floor(b % grid.beatsPerBar) + 1;
    return `${bar}.${beat}`;
  });

  function fmt(t: number): string {
    const m = Math.floor(t / 60);
    const s = (t % 60).toFixed(2).padStart(5, '0');
    return `${m}:${s}`;
  }

  function setGrid(patch: Parameters<typeof appState.store.setBeatGrid>[0]) {
    appState.store.setBeatGrid(patch);
  }
</script>

<div class="transport">
  <button class="play" onclick={() => appState.togglePlay()} title="播放/暂停 (Space)">
    <i class="fa-solid" class:fa-play={!appState.playing} class:fa-pause={appState.playing}></i>
  </button>
  <button onclick={() => appState.stop()} title="停止">
    <i class="fa-solid fa-stop"></i>
  </button>

  <span class="time" title="工程时间 / 小节.拍">{fmt(playT)} <em>{barBeat}</em></span>

  {#if grid}
    <label title="BPM（手动拍网格；自动估计在后续里程碑）">
      BPM
      <input
        type="number"
        min="20"
        max="300"
        step="0.1"
        value={grid.bpm}
        onchange={(e) => setGrid({ bpm: Math.max(20, Math.min(300, +e.currentTarget.value || 120)) })}
      />
    </label>
    <label title="offset：第 0 拍的秒数（ADR-002，独立参数）">
      offset
      <input
        type="number"
        step="0.01"
        value={grid.offset}
        onchange={(e) => setGrid({ offset: +e.currentTarget.value || 0 })}
      />
    </label>
    <label title="每小节拍数">
      拍/小节
      <select
        value={grid.beatsPerBar}
        onchange={(e) => setGrid({ beatsPerBar: +e.currentTarget.value })}
      >
        {#each [2, 3, 4, 6] as n (n)}
          <option value={n}>{n}</option>
        {/each}
      </select>
    </label>
  {/if}

  <label title="吸附档位（网格间距与吸附步长同源：core/time.ts 一张表）">
    吸附
    <select bind:value={appState.snap}>
      {#each Object.entries(SNAP_MODES) as [mode, def] (mode)}
        <option value={mode as SnapMode}>{def.label}</option>
      {/each}
    </select>
  </label>

  <label title="同轨重叠策略（可配置：挤开邻居 / 拒绝落点 / 吃掉邻居重叠部分）">
    重叠
    <select
      value={appState.project?.overlapBehavior}
      onchange={(e) =>
        appState.store.setOverlapBehavior(e.currentTarget.value as OverlapBehavior)}
    >
      <option value="reject">拒绝落点</option>
      <option value="push">挤开邻居</option>
      <option value="trim">吃掉重叠</option>
    </select>
  </label>

  <label class="zoom" title="时间轴缩放">
    <i class="fa-solid fa-magnifying-glass"></i>
    <input type="range" min="6" max="96" step="1" bind:value={appState.pxPerBeat} />
  </label>
</div>

<style>
  .transport {
    display: flex;
    align-items: center;
    gap: 10px;
    flex-wrap: wrap;
  }
  .play {
    width: 34px;
  }
  .time {
    font-family: var(--font-mono);
    color: var(--text-0);
    min-width: 110px;
  }
  .time em {
    font-style: normal;
    color: var(--accent);
    margin-left: 6px;
  }
  label {
    display: flex;
    align-items: center;
    gap: 5px;
    color: var(--text-1);
    white-space: nowrap;
  }
  input[type='number'] {
    width: 64px;
  }
  .zoom input {
    width: 110px;
  }
</style>

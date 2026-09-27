<script lang="ts">
  import { appState } from '../ui/app-state.svelte';
  import ClipView from './ClipView.svelte';
  import { drawGrid, drawRuler, type GridTrackRow } from './grid-draw';
  import { xOfTime, timeAtX, RULER_HEIGHT, ROW_HEIGHT } from './view-model';
  import { browserPlatform } from '../platform/browser';
  import { computeWaveform, decodeAudio } from '../audio/decode';
  import {
    newId,
    type AudioClip,
    type EffectClip,
    type SourceClip,
    type Track,
  } from '../core/schema';
  import { beatDur, snapTime } from '../core/time';
  import { defaultParams, getGenerator, listGenerators } from '../algos/registry';

  const generators = listGenerators();
  let algoMenuFor = $state<string | null>(null);

  /** 右键菜单：在鼠标位置（时间 + 轨道）新建片段。 */
  interface CtxMenu {
    x: number;
    y: number;
    trackId: string;
    kind: Track['kind'];
    name: string;
    time: number;
  }
  let ctxMenu = $state<CtxMenu | null>(null);
  let menuEl = $state<HTMLDivElement | undefined>();

  let rulerCanvas: HTMLCanvasElement;
  let gridCanvas: HTMLCanvasElement;
  let scrollEl: HTMLDivElement;

  /**
   * 响应式纪律（Svelte 5 陷阱）：store.project 是原地改的对象，
   * $derived 靠 === 判断传播——返回同一个引用就断更。
   * 所以从 store 读的派生都必须 ① 先 void appState.version 订阅版本
   * ② 返回新引用（浅拷贝），让变更真正流下去。
   */
  const tracks = $derived.by(() => {
    void appState.version;
    // 浅拷两层：track 与 clips 数组都是原地改的，给 each 新引用才会重渲染。
    return appState.store.project.tracks.map((t) => ({ ...t, clips: [...t.clips] }) as Track);
  });
  const grid = $derived.by(() => {
    void appState.version;
    return { ...appState.store.project.beatGrid };
  });
  const duration = $derived.by(() => {
    void appState.version;
    return appState.store.project.duration;
  });
  const totalWidth = $derived(Math.ceil(xOfTime(duration, appState.pxPerBeat, grid)) + 2);
  const playheadX = $derived(xOfTime(appState.playT, appState.pxPerBeat, grid));

  const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;

  function gridRows(): GridTrackRow[] {
    return tracks.map((t) => ({
      kind: t.kind,
      waveClips:
        t.kind === 'audio'
          ? (t.clips as AudioClip[]).map((c) => ({
              start: c.start,
              end: c.end,
              srcIn: c.srcIn,
              assetId: c.assetId,
            }))
          : [],
    }));
  }

  // 重绘订阅源：version / 缩放 / 吸附 / 波形。选中态刻意不在其中
  // （splitter 的教训：select 触发全量重建会在拖拽中换掉 DOM）。
  $effect(() => {
    void appState.version;
    void appState.pxPerBeat;
    void appState.snap;
    void appState.waveforms;
    if (rulerCanvas) drawRuler(rulerCanvas, appState.store.project, appState.pxPerBeat, dpr);
    if (gridCanvas) drawGrid(gridCanvas, appState.store.project, appState.pxPerBeat, gridRows(), appState.waveforms, dpr);
  });

  /** 菜单开着时：点别处 / 滚轮 / Esc 都关掉。菜单内部的点击放行给按钮自己处理。 */
  $effect(() => {
    if (!ctxMenu) return;
    const close = (e: Event): void => {
      // 右键不负责关闭：它要开的是新菜单（openMenu 会替换 ctxMenu）
      if (e instanceof PointerEvent && e.button !== 0) return;
      if (e.target instanceof Node && menuEl?.contains(e.target)) return;
      ctxMenu = null;
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') ctxMenu = null;
    };
    window.addEventListener('pointerdown', close, true);
    window.addEventListener('wheel', close, true);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointerdown', close, true);
      window.removeEventListener('wheel', close, true);
      window.removeEventListener('keydown', onKey);
    };
  });

  /**
   * 菜单贴着窗口边缘时要翻进来：固定定位的菜单直接放在鼠标点会
   * 在窗口底部/右侧溢出，按钮点不到（E2E 实测踩到）。
   * 这里做一次收敛的位置修正：算出钳制后的位置，不等就写回，
   * 写回后重算必然相等，不会来回抖。
   */
  $effect(() => {
    const m = ctxMenu;
    if (!m || !menuEl) return;
    const r = menuEl.getBoundingClientRect();
    const nx = Math.max(8, Math.min(m.x, window.innerWidth - 8 - r.width));
    const ny = Math.max(8, Math.min(m.y, window.innerHeight - 8 - r.height));
    if (nx !== m.x || ny !== m.y) ctxMenu = { ...m, x: nx, y: ny };
  });

  /* ------------------------------------------------------------ 新建 */

  function startAtPlayhead(): number {
    return Math.max(0, Math.min(duration - 0.25, snapTime(appState.playT, appState.snap, grid)));
  }

  /** 新建片段的起点：右键菜单给位置，按钮给播放头。 */
  function startFor(at?: number): number {
    return at === undefined ? startAtPlayhead() : Math.max(0, at);
  }

  function twoBeats(): number {
    return Math.max(0.25, beatDur(grid) * 2);
  }

  /** 新片段默认长度（秒）：纯色 2 拍，算法 / 特效 4 拍。 */
  function solidLen(): number {
    return twoBeats();
  }
  function longLen(): number {
    return twoBeats() * 2;
  }

  function addAlgo(trackId: string, genId: string, at?: number): void {
    const def = getGenerator(genId);
    if (!def) return;
    algoMenuFor = null;
    ctxMenu = null;
    const start = startFor(at);
    const clip: SourceClip = {
      kind: 'source',
      id: newId(),
      start,
      end: start + longLen(),
      label: def.name,
      fadeSec: 0,
      curves: {},
      source: { type: 'algo', generator: genId, params: defaultParams(genId) },
      blend: 'normal',
      opacity: 1,
      transform: { x: 0.5, y: 0.5, sx: 1, sy: 1, rot: 0 },
      fit: 'stretch',
    };
    appState.store.addClip(trackId, clip);
    appState.selectedClipId = clip.id;
  }

  function addSolid(trackId: string, at?: number): void {
    ctxMenu = null;
    const start = startFor(at);
    const clip: SourceClip = {
      kind: 'source',
      id: newId(),
      start,
      end: start + solidLen(),
      label: '纯色',
      fadeSec: 0,
      curves: {},
      source: { type: 'solid', color: '#3a6ea5' },
      blend: 'normal',
      opacity: 1,
      transform: { x: 0.5, y: 0.5, sx: 1, sy: 1, rot: 0 },
      fit: 'stretch',
    };
    appState.store.addClip(trackId, clip);
    appState.selectedClipId = clip.id;
  }

  function addEffect(trackId: string, at?: number): void {
    ctxMenu = null;
    const start = startFor(at);
    const clip: EffectClip = {
      kind: 'effect',
      id: newId(),
      start,
      end: start + longLen(),
      label: '特效',
      fadeSec: 0,
      curves: {},
      chain: [],
    };
    appState.store.addClip(trackId, clip);
    appState.selectedClipId = clip.id;
  }

  async function addAudio(trackId: string, at?: number): Promise<void> {
    ctxMenu = null;
    const picked = await browserPlatform.pickAudioFile();
    if (!picked) return;
    const buf = await decodeAudio(picked.data.slice(0));
    const assetId = newId();
    appState.player.register(assetId, buf);
    appState.waveforms = { ...appState.waveforms, [assetId]: await computeWaveform(buf) };
    appState.store.commit('导入音频', (p) => {
      p.assets[assetId] = { id: assetId, kind: 'audio', name: picked.name, durationSec: buf.duration };
    });
    const start = startFor(at);
    const clip: AudioClip = {
      kind: 'audio',
      id: newId(),
      start,
      // 不再被工程时长截断：addClip 会把工程撑到放得下（音频长度只是默认值）
      end: start + buf.duration,
      label: picked.name,
      fadeSec: 0,
      curves: {},
      assetId,
      srcIn: 0,
    };
    appState.store.addClip(trackId, clip);
    appState.selectedClipId = clip.id;
  }

  /* ------------------------------------------------------------ 交互 */

  /** 标尺按下 / 拖动 = scrub 播放头（吸附到当前档位）。 */
  function scrub(e: PointerEvent): void {
    e.preventDefault();
    const el = e.currentTarget as HTMLElement;
    el.setPointerCapture(e.pointerId);
    const seekTo = (ev: PointerEvent): void => {
      const rect = scrollEl.getBoundingClientRect();
      const x = ev.clientX - rect.left + scrollEl.scrollLeft;
      appState.seek(Math.max(0, timeAtX(x, appState.pxPerBeat, grid)), { snap: true });
    };
    seekTo(e);
    const mv = (ev: PointerEvent): void => seekTo(ev);
    const up = (): void => {
      el.removeEventListener('pointermove', mv);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
    };
    el.addEventListener('pointermove', mv);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
  }

  /** 滚轮：纵向滚 = 横向滚动；Ctrl+滚 = 以鼠标为锚缩放。 */
  function wheel(e: WheelEvent): void {
    if (e.ctrlKey) {
      e.preventDefault();
      const rect = scrollEl.getBoundingClientRect();
      const x = e.clientX - rect.left + scrollEl.scrollLeft;
      const tAnchor = timeAtX(x, appState.pxPerBeat, grid);
      const next = Math.max(6, Math.min(96, appState.pxPerBeat * (e.deltaY > 0 ? 0.85 : 1.18)));
      appState.pxPerBeat = next;
      // 缩放后把锚点时间放回鼠标下
      scrollEl.scrollLeft = Math.max(0, xOfTime(tAnchor, next, grid) - (e.clientX - rect.left));
      return;
    }
    scrollEl.scrollLeft += e.deltaY + e.deltaX;
    e.preventDefault();
  }

  function deselect(e: PointerEvent): void {
    if ((e.target as HTMLElement).classList.contains('row')) {
      appState.selectedClipId = null;
    }
  }

  /** 鼠标 x → 工程时间（吸附）。右键菜单与拖拽落点共用同一套换算。 */
  function timeAtClientX(clientX: number): number {
    const rect = scrollEl.getBoundingClientRect();
    const x = clientX - rect.left + scrollEl.scrollLeft;
    return Math.max(0, snapTime(timeAtX(x, appState.pxPerBeat, grid), appState.snap, grid));
  }

  function openMenu(e: MouseEvent, track: Track): void {
    e.preventDefault();
    e.stopPropagation();
    algoMenuFor = null;
    ctxMenu = {
      x: e.clientX,
      y: e.clientY,
      trackId: track.id,
      kind: track.kind,
      name: track.name,
      time: timeAtClientX(e.clientX),
    };
  }
</script>

<div class="tl">
  <div class="side">
    <div class="side-head" style:height={`${RULER_HEIGHT}px`}>
      <button data-testid="add-visual-track" title="新建视觉轨" onclick={() => appState.store.addTrack('visual')}>
        <i class="fa-solid fa-plus"></i> V
      </button>
      <button data-testid="add-audio-track" title="新建音频轨" onclick={() => appState.store.addTrack('audio')}>
        <i class="fa-solid fa-plus"></i> A
      </button>
    </div>
    {#each tracks as track (track.id)}
      <div
        class="side-row"
        style:height={`${ROW_HEIGHT}px`}
        class:muted={!track.enabled}
        data-track-id={track.id}
        role="presentation"
        oncontextmenu={(e) => openMenu(e, track)}
      >
        <input
          type="checkbox"
          checked={track.enabled}
          title="启用/禁用"
          onchange={(e) =>
            appState.store.commit('切换轨道启用', () => {
              track.enabled = e.currentTarget.checked;
            })}
        />
        <span class="tname" title={track.name}>{track.name}</span>
        <span class="tbtns">
          {#if track.kind === 'visual'}
            <button data-testid="add-solid" title="新建纯色片段" onclick={() => addSolid(track.id)}>
              <i class="fa-solid fa-square"></i>
            </button>
            <span class="algo-wrap">
              <button
                data-testid="add-algo"
                title="新建算法片段"
                onclick={() => (algoMenuFor = algoMenuFor === track.id ? null : track.id)}
              >
                <i class="fa-solid fa-flask"></i>
              </button>
              {#if algoMenuFor === track.id}
                <span class="algo-menu">
                  {#each generators as g (g.id)}
                    <button data-testid={`add-algo-${g.id}`} onclick={() => addAlgo(track.id, g.id)}>
                      {g.name}
                    </button>
                  {/each}
                </span>
              {/if}
            </span>
            <button data-testid="add-effect" title="新建特效片段" onclick={() => addEffect(track.id)}>
              <i class="fa-solid fa-wand-magic-sparkles"></i>
            </button>
          {:else}
            <button data-testid="import-audio" title="导入音频文件" onclick={() => void addAudio(track.id)}>
              <i class="fa-solid fa-music"></i>
            </button>
          {/if}
          <button
            title="删除轨道"
            onclick={() => {
              if (appState.selectedClipId && track.clips.some((c) => c.id === appState.selectedClipId)) {
                appState.selectedClipId = null;
              }
              appState.store.removeTrack(track.id);
            }}
          >
            <i class="fa-solid fa-trash"></i>
          </button>
        </span>
      </div>
    {/each}
  </div>

  <div class="scroll" bind:this={scrollEl} onwheel={wheel}>
    <div class="canvas-wrap" style:width={`${totalWidth}px`}>
      <canvas class="ruler" bind:this={rulerCanvas} onpointerdown={scrub}></canvas>
      <div class="rows" role="presentation" onpointerdown={deselect}>
        <canvas class="grid" bind:this={gridCanvas}></canvas>
        {#each tracks as track (track.id)}
          <div
            class="row"
            class:audio={track.kind === 'audio'}
            class:disabled={!track.enabled}
            style:height={`${ROW_HEIGHT}px`}
            data-track-id={track.id}
            role="presentation"
            oncontextmenu={(e) => openMenu(e, track)}
          >
            {#each track.clips as clip (clip.id)}
              <ClipView {track} {clip} />
            {/each}
          </div>
        {/each}
        <div class="playhead" style:left={`${playheadX}px`}></div>
      </div>
    </div>
  </div>
</div>

{#if ctxMenu}
  <div class="ctx" bind:this={menuEl} style:left={`${ctxMenu.x}px`} style:top={`${ctxMenu.y}px`} role="menu">
    <div class="ctx-head">
      <span class="ctx-track">{ctxMenu.name}</span>
      <span class="ctx-time">{ctxMenu.time.toFixed(2)}s</span>
    </div>
    {#if ctxMenu.kind === 'visual'}
      <div class="ctx-group">算法片段</div>
      {#each generators as g (g.id)}
        <button role="menuitem" data-testid={`ctx-algo-${g.id}`} onclick={() => addAlgo(ctxMenu!.trackId, g.id, ctxMenu!.time)}>
          <i class="fa-solid fa-flask"></i> {g.name}
        </button>
      {/each}
      <div class="ctx-sep"></div>
      <button role="menuitem" data-testid="ctx-solid" onclick={() => addSolid(ctxMenu!.trackId, ctxMenu!.time)}>
        <i class="fa-solid fa-square"></i> 纯色片段
      </button>
      <button role="menuitem" data-testid="ctx-effect" onclick={() => addEffect(ctxMenu!.trackId, ctxMenu!.time)}>
        <i class="fa-solid fa-wand-magic-sparkles"></i> 特效片段
      </button>
    {:else}
      <button role="menuitem" data-testid="ctx-audio" onclick={() => void addAudio(ctxMenu!.trackId, ctxMenu!.time)}>
        <i class="fa-solid fa-music"></i> 导入音频…
      </button>
    {/if}
  </div>
{/if}

<style>
  .tl {
    height: 100%;
    display: flex;
    overflow: hidden;
  }
  .side {
    width: 168px;
    flex-shrink: 0;
    border-right: 1px solid var(--line);
    background: var(--bg-2);
    overflow-y: auto;
  }
  .side-head {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 0 8px;
    border-bottom: 1px solid var(--line);
  }
  .side-head button {
    padding: 1px 8px;
    font-size: 11px;
  }
  .side-row {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 0 8px;
    border-bottom: 1px solid var(--line);
  }
  .side-row.muted .tname {
    opacity: 0.4;
  }
  .tname {
    flex: 1;
    font-size: 11px;
    color: var(--text-1);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .tbtns {
    display: flex;
    gap: 2px;
  }
  .tbtns button {
    padding: 1px 5px;
    font-size: 10px;
    background: transparent;
    border-color: transparent;
  }
  .tbtns button:hover {
    background: var(--line);
  }
  .algo-wrap {
    position: relative;
  }
  .algo-menu {
    position: absolute;
    top: 100%;
    left: 0;
    z-index: 20;
    display: flex;
    flex-direction: column;
    background: var(--bg-3);
    border: 1px solid var(--line);
    border-radius: var(--radius);
    min-width: 140px;
    box-shadow: 0 6px 20px rgba(0, 0, 0, 0.5);
  }
  .algo-menu button {
    text-align: left;
    border: none;
    border-radius: 0;
    background: transparent;
    padding: 6px 10px;
    font-size: 11px;
  }
  .algo-menu button:hover {
    background: var(--accent-dim);
  }
  .scroll {
    flex: 1;
    overflow-x: auto;
    overflow-y: auto;
  }
  .canvas-wrap {
    position: relative;
  }
  .ruler {
    display: block;
    cursor: ew-resize;
    position: sticky;
    top: 0;
    z-index: 5;
  }
  .rows {
    position: relative;
  }
  .grid {
    position: absolute;
    left: 0;
    top: 0;
    pointer-events: none;
  }
  .row {
    position: relative;
  }
  .row.disabled {
    opacity: 0.55;
  }
  .playhead {
    position: absolute;
    top: 0;
    bottom: 0;
    width: 0;
    border-left: 1.5px solid var(--danger);
    pointer-events: none;
    z-index: 4;
  }

  /* 自绘右键菜单：原生菜单在本工具里没有可用项，且样式不可控 */
  .ctx {
    position: fixed;
    z-index: 100;
    min-width: 168px;
    padding: 4px;
    display: flex;
    flex-direction: column;
    background: var(--bg-3);
    border: 1px solid var(--line);
    border-radius: var(--radius);
    box-shadow: 0 10px 28px rgba(0, 0, 0, 0.55);
  }
  .ctx-head {
    display: flex;
    justify-content: space-between;
    gap: 8px;
    padding: 3px 8px 5px;
    font-size: 10px;
    color: var(--text-2);
    border-bottom: 1px solid var(--line);
    margin-bottom: 3px;
  }
  .ctx-track {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .ctx-time {
    font-family: var(--font-mono);
    color: var(--accent);
  }
  .ctx-group {
    padding: 4px 8px 2px;
    font-size: 10px;
    letter-spacing: 0.06em;
    color: var(--text-2);
  }
  .ctx-sep {
    height: 1px;
    background: var(--line);
    margin: 4px 0;
  }
  .ctx button {
    display: flex;
    align-items: center;
    gap: 8px;
    text-align: left;
    border: none;
    border-radius: 4px;
    background: transparent;
    padding: 5px 8px;
    font-size: 12px;
  }
  .ctx button i {
    width: 12px;
    color: var(--text-2);
  }
  .ctx button:hover {
    background: var(--accent-dim);
  }
</style>

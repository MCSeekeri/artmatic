<script lang="ts">
  import Icon from '../ui/Icon.svelte';
  import IconButton from '../ui/controls/IconButton.svelte';
  import Menu from '../ui/controls/Menu.svelte';
  import { separator, submenu, type MenuItem } from '../ui/controls/menu-model';
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
  import { createTextElement, createTypographyDocument } from '../typography/document';
  import { canvasPalette } from '../ui/tokens';
  import { theme } from '../ui/theme.svelte';
  import { appState } from '../ui/app-state.svelte';
  import { tr } from '../i18n/index.svelte';

  const generators = listGenerators();

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

  /** 轨道行 ⋯ 菜单：{ 轨道 id, 锚点元素 }。 */
  let rowMenu = $state<{ trackId: string; kind: Track['kind']; anchor: HTMLElement } | null>(null);

  /** 正在重命名的轨道 id。 */
  let renaming = $state<string | null>(null);

  let rulerCanvas: HTMLCanvasElement;
  let gridCanvas: HTMLCanvasElement;
  let scrollEl: HTMLDivElement;

  /**
   * 滚动视口的宽度。画布要至少铺这么宽——否则工程末尾右侧会露一条底色空档
   * （时间轴横向只画到 totalWidth，而视口通常比它宽）。
   */
  let scrollW = $state(0);

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
  /** 实际绘制宽度：工程内容与滚动视口取大者。 */
  const drawWidth = $derived(Math.max(totalWidth, scrollW));
  const playheadX = $derived(xOfTime(appState.playT, appState.pxPerBeat, grid));

  const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;

  /** Canvas 写不了 var()，所以颜色必须由 TS 传进去。这里跟着主题一起派生。 */
  const palette = $derived(canvasPalette(theme.spec));

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

  // 重绘订阅源：version / 缩放 / 吸附 / 波形 / 主题 / 视口宽。选中态刻意不在其中
  // （splitter 的教训：select 触发全量重建会在拖拽中换掉 DOM）。
  $effect(() => {
    void appState.version;
    void appState.pxPerBeat;
    void appState.snap;
    void appState.waveforms;
    const pal = palette;
    const minW = drawWidth;
    if (rulerCanvas) {
      drawRuler(rulerCanvas, appState.store.project, appState.pxPerBeat, dpr, pal, minW);
    }
    if (gridCanvas) {
      drawGrid(gridCanvas, appState.store.project, appState.pxPerBeat, gridRows(), appState.waveforms, dpr, pal, minW);
    }
  });

  /** 跟踪滚动视口宽度，供 drawWidth 使用。 */
  $effect(() => {
    const el = scrollEl;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      if (el.clientWidth !== scrollW) scrollW = el.clientWidth;
    });
    ro.observe(el);
    scrollW = el.clientWidth;
    return () => ro.disconnect();
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
    closeMenus();
    const start = startFor(at);
    const clip: SourceClip = {
      kind: 'source',
      id: newId(),
      start,
      end: start + longLen(),
      label: tr(def.nameKey),
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
    closeMenus();
    const start = startFor(at);
    const clip: SourceClip = {
      kind: 'source',
      id: newId(),
      start,
      end: start + solidLen(),
      label: tr('tl.clipSolid'),
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

  /**
   * 排版片段。文档尺寸默认取当前工程分辨率 —— 这样新建出来的文本框是
   * 「1:1 摆在画面上」的，用户不必先算缩放。
   *
   * fit 用 contain 而不是 stretch：以后改工程分辨率时文字不会被拉变形
   * （contain 会等比缩放并留边），而 stretch 会把版式压扁。
   */
  function addText(trackId: string, at?: number): void {
    closeMenus();
    const start = startFor(at);
    const doc = createTypographyDocument(appState.store.project.resolution);
    doc.elements = [createTextElement(doc.size)];
    const clip: SourceClip = {
      kind: 'source',
      id: newId(),
      start,
      end: start + longLen(),
      label: tr('tl.clipText'),
      fadeSec: 0,
      curves: {},
      source: { type: 'text', doc },
      blend: 'normal',
      opacity: 1,
      transform: { x: 0.5, y: 0.5, sx: 1, sy: 1, rot: 0 },
      fit: 'contain',
    };
    appState.store.addClip(trackId, clip);
    appState.selectedClipId = clip.id;
  }

  function addEffect(trackId: string, at?: number): void {    closeMenus();
    const start = startFor(at);
    const clip: EffectClip = {
      kind: 'effect',
      id: newId(),
      start,
      end: start + longLen(),
      label: tr('tl.clipEffect'),
      fadeSec: 0,
      curves: {},
      chain: [],
    };
    appState.store.addClip(trackId, clip);
    appState.selectedClipId = clip.id;
  }

  async function addAudio(trackId: string, at?: number): Promise<void> {
    closeMenus();
    const picked = await browserPlatform.pickAudioFile();
    if (!picked) return;
    const buf = await decodeAudio(picked.data.slice(0));
    const assetId = newId();
    appState.player.register(assetId, buf);
    appState.waveforms = { ...appState.waveforms, [assetId]: await computeWaveform(buf) };
    // 素材字节进仓（**当前工程**的仓）。不存的话保存工程只留下一个 assetId
    // —— 引用还在、文件没有，重开就是一段哑音。用独立拷贝：decode 那一支
    // 已经吃掉了自己的 slice，剩下这份要留给保存，不能被任何下游 detach。
    appState.assets.put(assetId, new Uint8Array(picked.data.slice(0)), {
      kind: 'audio',
      name: picked.name,
      originName: picked.name,
    });
    appState.store.commit(tr('tl.importAudio'), (p) => {
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

  /* ------------------------------------------------------------ 轨道操作 */

  function removeTrack(track: Track): void {
    closeMenus();
    if (appState.selectedClipId && track.clips.some((c) => c.id === appState.selectedClipId)) {
      appState.selectedClipId = null;
    }
    appState.store.removeTrack(track.id);
  }

  function beginRename(trackId: string): void {
    closeMenus();
    renaming = trackId;
  }

  function commitRename(trackId: string, value: string): void {
    appState.store.renameTrack(trackId, value);
    renaming = null;
  }

  /* ------------------------------------------------------------ 菜单构造
   *
   * 轨道行 ⋯ 菜单与时间轴右键菜单是**同一套动作**（都是「在这条轨上新建片段 /
   * 改这条轨」），所以共用构造器，用一个 `prefix` 区分 testid：
   * 行菜单 `add-*`（add-solid / add-effect / add-algo-<id> / import-audio），
   * 右键菜单 `ctx-*`。测试要能分辨「从行菜单建的」与「从右键建的」两条入口。
   */

  /** 算法生成器的二级子菜单。放二级是为了将来加特效/素材类型时不撑爆一级。 */
  function generatorItems(at: number | undefined, prefix: string): MenuItem[] {
    return generators.map((g) => ({
      id: `${prefix}algo-${g.id}`,
      label: tr(g.nameKey),
      testid: `${prefix}algo-${g.id}`,
      onselect: () => addAlgo(currentTrackId!, g.id, at),
    }));
  }

  /** 右键菜单的 trackId 在构造时可能是动态的，用一个可变引用接住。 */
  let currentTrackId: string | null = null;

  function clipItems(track: Track, at: number | undefined, prefix: string): MenuItem[] {
    if (track.kind === 'audio') {
      return [
        {
          id: `${prefix}audio`,
          label: tr('tl.importAudioMenu'),
          icon: 'music',
          testid: prefix === 'ctx-' ? `${prefix}audio` : 'import-audio',
          onselect: () => void addAudio(track.id, at),
        },
      ];
    }
    /*
     * 一级平铺，只有「算法片段」再展开一级。
     * 曾经把三个都塞进「添加片段」二级里，反而多一次悬停才点得到；
     * 用户反馈要的是「+ 纯色片段 / + 特效片段 / + 算法片段」这种直接可点的形式，
     * 而真正会变长的是算法生成器列表（现在 3 个，以后只会更多），二级留给它。
     * 「排版片段」同理平铺 —— 它是最常用的一类源片段。
     */
    return [
      {
        id: `${prefix}solid`,
        label: tr('tl.addSolid'),
        icon: 'palette',
        testid: `${prefix}solid`,
        onselect: () => addSolid(track.id, at),
      },
      {
        id: `${prefix}text`,
        label: tr('tl.addText'),
        icon: 'type',
        testid: `${prefix}text`,
        onselect: () => addText(track.id, at),
      },
      {
        id: `${prefix}effect`,
        label: tr('tl.addEffect'),
        icon: 'flask-conical',
        testid: `${prefix}effect`,
        onselect: () => addEffect(track.id, at),
      },
      submenu(`${prefix}algo`, tr('tl.addAlgo'), generatorItems(at, prefix), 'sigma'),
    ];
  }

  function trackMenuItems(track: Track, at?: number, prefix = 'add-'): MenuItem[] {
    currentTrackId = track.id;
    return [
      ...clipItems(track, at, prefix),
      separator('s1'),
      { id: 'rename', label: tr('tl.renameTrack'), icon: 'pencil', testid: 'track-menu-rename', onselect: () => beginRename(track.id) },
      separator('s2'),
      { id: 'remove', label: tr('tl.removeTrack'), icon: 'trash', danger: true, testid: 'track-menu-remove', onselect: () => removeTrack(track) },
    ];
  }

  /** 右键菜单：与行菜单同动作，但 testid 带 ctx- 前缀（测试要能分辨入口）。 */
  function ctxItems(): MenuItem[] {
    const m = ctxMenu;
    if (!m) return [];
    const track = appState.store.track(m.trackId);
    if (!track) return [];
    return trackMenuItems(track, m.time, 'ctx-');
  }

  function closeMenus(): void {
    ctxMenu = null;
    rowMenu = null;
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
    if ((e.target as HTMLElement).hasAttribute('data-tl-row')) {
      appState.selectedClipId = null;
    }
  }

  /** 鼠标 x → 工程时间（吸附）。右键菜单与拖拽落点共用同一套换算。 */
  function timeAtClientX(clientX: number): number {
    const rect = scrollEl.getBoundingClientRect();
    const x = clientX - rect.left + scrollEl.scrollLeft;
    return Math.max(0, snapTime(timeAtX(x, appState.pxPerBeat, grid), appState.snap, grid));
  }

  function openCtx(e: MouseEvent, track: Track): void {
    e.preventDefault();
    e.stopPropagation();
    rowMenu = null;
    ctxMenu = {
      x: e.clientX,
      y: e.clientY,
      trackId: track.id,
      kind: track.kind,
      name: track.name,
      time: timeAtClientX(e.clientX),
    };
  }

  function openRowMenu(e: MouseEvent, track: Track): void {
    e.preventDefault();
    e.stopPropagation();
    ctxMenu = null;
    rowMenu = { trackId: track.id, kind: track.kind, anchor: e.currentTarget as HTMLElement };
  }
</script>

<div class="tl">
  <div class="side">
    <div class="side-head" style:height={`${RULER_HEIGHT}px`}>
      <span class="side-title">{tr('tl.sideTitle')}</span>
    </div>

    {#each tracks as track (track.id)}
      <div
        class="side-row"
        style:height={`${ROW_HEIGHT}px`}
        class:muted={!track.enabled}
        data-track-id={track.id}
        data-testid="track-side-row"
        role="presentation"
        oncontextmenu={(e) => openCtx(e, track)}
      >
        <IconButton
          icon={track.kind === 'audio'
            ? track.enabled
              ? 'megaphone'
              : 'megaphone-off'
            : track.enabled
              ? 'eye'
              : 'eye-off'}
          label={track.kind === 'audio'
            ? track.enabled
              ? tr('tl.muteAudioTrack')
              : tr('tl.unmuteAudioTrack')
            : track.enabled
              ? tr('tl.hideTrack')
              : tr('tl.showTrack')}
          size="sm"
          active={track.enabled}
          testid="track-enabled"
          onclick={() => appState.store.toggleTrackEnabled(track.id)}
        />

        {#if renaming === track.id}
          <!-- svelte-ignore a11y_autofocus -->
          <input
            class="rename"
            data-testid="track-rename-input"
            value={track.name}
            autofocus
            onblur={(e) => commitRename(track.id, e.currentTarget.value)}
            onkeydown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                commitRename(track.id, e.currentTarget.value);
              } else if (e.key === 'Escape') {
                e.preventDefault();
                renaming = null;
              }
            }}
            onpointerdown={(e) => e.stopPropagation()}
          />
        {:else}
          <span
            class="tname"
            data-testid="track-name"
            title={track.name}
            role="presentation"
            ondblclick={() => beginRename(track.id)}
          >{track.name}</span>
        {/if}

        <IconButton
          icon="ellipsis-vertical"
          label={tr('tl.trackMenu')}
          size="sm"
          testid="track-menu"
          onclick={(e) => openRowMenu(e, track)}
        />
      </div>
    {/each}

    <div class="side-add" style:height={`${ROW_HEIGHT}px`}>
      <span class="add-label">{tr('tl.addTrack')}</span>
      <button
        type="button"
        class="add-btn"
        data-testid="add-visual-track"
        onclick={() => appState.store.addTrack('visual')}
      >
        <Icon name="video" size={12} /> {tr('tl.addVisualTrack')}
      </button>
      <button
        type="button"
        class="add-btn"
        data-testid="add-audio-track"
        onclick={() => appState.store.addTrack('audio')}
      >
        <Icon name="audio-lines" size={12} /> {tr('tl.addAudioTrack')}
      </button>
    </div>
  </div>

  <div class="scroll" data-testid="tl-scroll" bind:this={scrollEl} onwheel={wheel}>
    <div class="canvas-wrap" data-testid="tl-canvas-wrap" style:width={`${drawWidth}px`}>
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
            data-tl-row
            data-testid="tl-row"
            role="presentation"
            oncontextmenu={(e) => openCtx(e, track)}
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
  <Menu
    items={ctxItems()}
    at={{ x: ctxMenu.x, y: ctxMenu.y }}
    head={{ label: ctxMenu.name, value: `${ctxMenu.time.toFixed(2)}s` }}
    testid="ctx-menu"
    onclose={closeMenus}
  />
{/if}

{#if rowMenu}
  {@const track = appState.store.track(rowMenu.trackId)}
  {#if track}
    <Menu
      items={trackMenuItems(track)}
      anchorEl={rowMenu.anchor}
      testid="track-menu-panel"
      onclose={closeMenus}
    />
  {/if}
{/if}

<style>
  .tl {
    height: 100%;
    display: flex;
    overflow: hidden;
  }
  .side {
    width: var(--tl-side-w);
    flex-shrink: 0;
    border-right: 1px solid var(--tl-border);
    background: var(--tl-side-bg);
    overflow-y: auto;
    overflow-x: hidden;
  }
  .side-head {
    display: flex;
    align-items: center;
    padding: 0 var(--sp-4);
    border-bottom: 1px solid var(--tl-border);
    position: sticky;
    top: 0;
    background: var(--tl-side-bg);
    z-index: 1;
  }
  .side-title {
    color: var(--text-muted);
    font-size: var(--fs-xs);
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }
  .side-row {
    display: flex;
    align-items: center;
    gap: var(--sp-1);
    padding: 0 var(--sp-2) 0 var(--sp-1);
    border-bottom: 1px solid var(--tl-gutter);
  }
  .side-row.muted .tname {
    color: var(--tl-name-muted);
  }
  .tname {
    flex: 1;
    min-width: 0;
    color: var(--tl-name);
    font-size: var(--fs-sm);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    cursor: text;
  }
  .rename {
    flex: 1;
    min-width: 0;
    height: 18px;
    padding: 0 var(--sp-1);
    font-size: var(--fs-sm);
  }

  .side-add {
    display: flex;
    align-items: center;
    gap: var(--sp-2);
    padding: 0 var(--sp-2) 0 var(--sp-3);
    border-bottom: 1px solid var(--tl-gutter);
  }
  .add-label {
    color: var(--text-muted);
    font-size: var(--fs-xs);
    white-space: nowrap;
  }
  .add-btn {
    display: inline-flex;
    align-items: center;
    gap: 3px;
    height: 18px;
    padding: 0 var(--sp-2);
    background: transparent;
    border: 1px solid var(--tl-border);
    border-radius: var(--radius-sm);
    color: var(--tl-name);
    font-size: var(--fs-xs);
    cursor: pointer;
  }
  .add-btn:hover {
    border-color: var(--border-focus);
    color: var(--accent);
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
    z-index: var(--z-ruler);
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
    opacity: 0.5;
  }
  .playhead {
    position: absolute;
    top: 0;
    bottom: 0;
    width: 0;
    border-left: 1.5px solid var(--accent);
    pointer-events: none;
    z-index: var(--z-playhead);
  }
</style>

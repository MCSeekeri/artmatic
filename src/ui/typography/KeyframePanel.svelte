<script lang="ts">
  /**
   * KeyframePanel — 预览下方、与预览同宽的关键帧面板。
   *
   * 三列：**元素列 | 属性列 | 时间轴**。属性列与右侧轨道都是同一份行列表、同一
   * `ROW_H`，但**属性列在横向滚动容器之外**（早期版本用 `sticky` 冻结，结果
   * 属性列只有「行」那么高，横向滚起来后播放头会从它下面露出来）。
   *
   * 交互与片段编辑器的时间轴对齐：
   *   · **标尺拖动 = 播放头**，**轨道上拖动 = 框选**；
   *   · 滚轮横向滚动（内容超出时），`⌘/Ctrl + 滚轮` 缩放；
   *   · 关键帧**自由拖曳**，按住 Shift 才吸附到拍。
   *
   * 其它纪律：一条动画 = 一个属性（见 `typography/AGENTS.md`）；拖动 = 一笔撤销；
   * 列表派生逐层浅拷贝（文档对象是原地改的）。
   */
  import Icon from '../Icon.svelte';
  import IconButton from '../controls/IconButton.svelte';
  import NumberInput from '../controls/NumberInput.svelte';
  import Select from '../controls/Select.svelte';
  import { tick } from 'svelte';
  import { appState } from '../app-state.svelte';
  import { editorState } from './editor-state.svelte';
  import { createTypographyActions } from './actions';
  import { kfPanel } from './keyframe-panel-state.svelte';
  import KeyframePopover from './KeyframePopover.svelte';
  import { statusHint } from '../status-hint.svelte';
  import {
    ANIM_CHANNELS,
    CHANNEL_META,
    easeKindOf,
    identityValue,
    isChannel,
    sampleKeys,
    type AnimChannel,
    type TracksAnimation,
  } from '../../typography/animation-tracks';
  import type { TypographyElement } from '../../typography/document';
  import { beatAtTime, beatDur, timeAtBeat } from '../../core/time';
  import { tr } from '../../i18n/index.svelte';

  const actions = createTypographyActions();

  const KIND_ICON: Record<TypographyElement['kind'], 'type' | 'shapes' | 'image'> = {
    text: 'type',
    shape: 'shapes',
    image: 'image',
  };

  const CHANNEL_LABEL: Record<AnimChannel, string> = {
    x: tr('typo.kfChX'),
    y: tr('typo.kfChY'),
    sx: tr('typo.kfChSx'),
    sy: tr('typo.kfChSy'),
    rot: tr('typo.kfChRot'),
    opacity: tr('typo.kfChOpacity'),
    blur: tr('typo.kfChBlur'),
  };

  const CUSTOM = '__custom';
  const PROPS_W = 132;
  const ROW_H = 24;

  const clip = $derived.by(() => {
    void appState.version;
    return editorState.clip;
  });
  const clipStart = $derived(clip?.start ?? 0);
  const clipDur = $derived(clip ? Math.max(0.001, clip.end - clip.start) : 1);
  const grid = $derived(appState.project.beatGrid);
  const localSec = $derived.by(() => {
    void appState.playT;
    return clip ? appState.playT - clip.start : 0;
  });
  /**
   * 播放头在片段内的位置。**夹进 [0, clipDur]** —— 打开编辑器时播放头可能停在
   * 片段之外（别的片段/工程起点），原样显示就是「-24.00s」加一根看不见的播放头
   * （底栏的 `bgLocalSec` 也是这么夹的）。
   */
  const playSec = $derived(Math.min(clipDur, Math.max(0, localSec)));

  /** 元素列：**有动画的 + 舞台上选中的**（否则新元素永远加不了第一条轨道）。 */
  const listed = $derived.by(() => {
    void appState.version;
    const picked = new Set(editorState.selectedIds);
    return editorState.elements
      .filter((e) => e.animations.length > 0 || picked.has(e.id))
      .map((e) => ({
        id: e.id,
        name: e.name || e.kind,
        kind: e.kind,
        animations: e.animations.map((a) =>
          a.kind === 'tracks' ? { ...a, keys: a.keys.map((k) => ({ ...k })) } : { ...a },
        ),
      }))
      .reverse();
  });

  const selEl = $derived.by(() => {
    const id = kfPanel.elId;
    if (id) {
      const found = listed.find((e) => e.id === id);
      if (found) return found;
    }
    const stage = editorState.selectedIds.find((sid) => listed.some((e) => e.id === sid));
    return listed.find((e) => e.id === stage) ?? listed[0] ?? null;
  });

  const tracks = $derived<TracksAnimation[]>(
    (selEl?.animations ?? []).filter((a): a is TracksAnimation => a.kind === 'tracks'),
  );
  /** 旧形态（预设 / 手写 CSS）。只读一行 + 可删，**排在轨道之后**。 */
  const legacy = $derived(
    (selEl?.animations ?? []).filter((a) => a.kind !== 'tracks'),
  );

  const selTrack = $derived(tracks.find((a) => a.id === kfPanel.animId) ?? tracks[0] ?? null);

  const keyIndex = (anim: TracksAnimation, t: number): number =>
    anim.keys.findIndex((x) => Math.abs(x.t - t) < 1e-6);

  /** 只有**恰好选中一帧**时才谈得上「这一帧的值/时刻」。 */
  const selKey = $derived.by(() => {
    if (kfPanel.keys.length !== 1) return null;
    const one = kfPanel.keys[0]!;
    const a = tracks.find((x) => x.id === one.animId);
    if (!a) return null;
    const i = keyIndex(a, one.t);
    if (i < 0) return null;
    return { anim: a, key: a.keys[i]!, index: i };
  });

  function isSel(animId: string, t: number): boolean {
    return kfPanel.keys.some((k) => k.animId === animId && Math.abs(k.t - t) < 1e-6);
  }

  /* ------------------------------------------------------------ 时间轴度量 */

  let vscrollEl = $state<HTMLElement | null>(null);
  let propsEl = $state<HTMLElement | null>(null);
  let barEl = $state<HTMLElement | null>(null);
  let viewW = $state(0);
  let scrollLeft = $state(0);
  let zoom = $state(1);

  const fitPx = $derived(viewW > 40 ? viewW / clipDur : 60);
  const px = $derived(fitPx * zoom);
  const contentW = $derived(Math.max(40, clipDur * px));

  $effect(() => {
    const el = vscrollEl;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      viewW = el.clientWidth;
      scrollLeft = el.scrollLeft;
    });
    ro.observe(el);
    viewW = el.clientWidth;
    return () => ro.disconnect();
  });

  function secAt(clientX: number): number {
    const el = vscrollEl;
    if (!el) return 0;
    const r = el.getBoundingClientRect();
    const x = clientX - r.left + el.scrollLeft;
    return Math.max(0, Math.min(clipDur, x / px));
  }

  /** 吸到最近的拍。**只在按住 Shift 时用**（默认自由拖曳）。 */
  function snapSec(sec: number): number {
    const beat = Math.round(beatAtTime(clipStart + sec, grid));
    return Math.max(0, Math.min(clipDur, timeAtBeat(beat, grid) - clipStart));
  }

  /** 主刻度：秒。步长取第一个「不小于 64px」的候选，否则数字会挤成一团。 */
  const STEPS = [0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10];
  const ticks = $derived.by(() => {
    const stepSec = STEPS.find((s) => s * px >= 64) ?? 10;
    const out: { x: number; label: string }[] = [];
    for (let t = 0; t <= clipDur + 1e-9; t += stepSec) {
      out.push({ x: t * px, label: String(Math.round(t * 1000) / 1000) });
    }
    return out;
  });

  /** 拍线：太密（< 6px）就不画 —— 那已经是一片灰。 */
  const beatTicks = $derived.by(() => {
    const bd = beatDur(grid);
    if (bd * px < 6) return [];
    const out: { x: number; bar: boolean }[] = [];
    const first = Math.ceil(beatAtTime(clipStart, grid) - 1e-6);
    const last = Math.floor(beatAtTime(clipStart + clipDur, grid) + 1e-6);
    for (let b = first; b <= last; b += 1) {
      const sec = timeAtBeat(b, grid) - clipStart;
      if (sec < -1e-6 || sec > clipDur + 1e-6) continue;
      out.push({ x: Math.max(0, sec) * px, bar: b % grid.beatsPerBar === 0 });
    }
    return out;
  });

  /** 纵向滚动同步到属性列（属性列在横向滚动容器之外，见文件头）。 */
  function onScroll(): void {
    const el = vscrollEl;
    if (!el) return;
    scrollLeft = el.scrollLeft;
    if (propsEl && propsEl.scrollTop !== el.scrollTop) propsEl.scrollTop = el.scrollTop;
  }

  /**
   * `ctrl/⌘ + 滚轮` = 以指针处的时间为锚缩放；其余滚轮横向滚动（内容超出时）。
   * 与 Ribbon / Transport 同一套「纵向滚轮改横向」的接管方式。
   */
  async function onWheel(e: WheelEvent): Promise<void> {
    const el = vscrollEl;
    if (!el) return;
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      const anchor = secAt(e.clientX);
      const d = e.clientX - r.left;
      zoom = Math.max(0.4, Math.min(12, zoom * Math.exp(-e.deltaY * 0.0016)));
      await tick();
      el.scrollLeft = Math.max(0, anchor * fitPx * zoom - d);
      return;
    }
    if (el.scrollWidth <= el.clientWidth) return;
    if (e.deltaY !== 0) el.scrollLeft += e.deltaY;
    if (e.deltaX !== 0) el.scrollLeft += e.deltaX;
    e.preventDefault();
  }

  /** 标尺拖动 = 播放头（与片段编辑器的时间轴一致）。 */
  function onRulerDown(e: PointerEvent): void {
    if (e.button !== 0) return;
    e.preventDefault();
    const seek = (cx: number): void => appState.seek(clipStart + secAt(cx));
    seek(e.clientX);
    const move = (ev: PointerEvent): void => seek(ev.clientX);
    const up = (): void => window.removeEventListener('pointermove', move);
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up, { once: true });
  }

  /* ------------------------------------------------------------ 框选 */

  let marquee = $state<{ x0: number; y0: number; x1: number; y1: number } | null>(null);

  function onLanesDown(e: PointerEvent): void {
    if (e.button !== 0) return;
    if ((e.target as HTMLElement).closest('[data-kf-key]')) return;
    const el = vscrollEl;
    if (!el) return;
    e.preventDefault();
    const r = el.getBoundingClientRect();
    const x0 = e.clientX - r.left + el.scrollLeft;
    const y0 = e.clientY - r.top + el.scrollTop;
    let moved = false;
    const move = (ev: PointerEvent): void => {
      const x1 = ev.clientX - r.left + el.scrollLeft;
      const y1 = ev.clientY - r.top + el.scrollTop;
      if (!moved && Math.abs(x1 - x0) + Math.abs(y1 - y0) < 3) return;
      moved = true;
      marquee = { x0, y0, x1, y1 };
    };
    const up = (): void => {
      window.removeEventListener('pointermove', move);
      const box = marquee;
      marquee = null;
      // 没拖动 = 点空白：清空选择。
      if (!moved || !box) {
        kfPanel.clearKeys();
        return;
      }
      const [xa, xb] = [Math.min(box.x0, box.x1), Math.max(box.x0, box.x1)];
      const [ya, yb] = [Math.min(box.y0, box.y1), Math.max(box.y0, box.y1)];
      const picked: { animId: string; t: number }[] = [];
      tracks.forEach((a, i) => {
        const top = i * ROW_H;
        if (top + ROW_H < ya || top > yb) return;
        for (const k of a.keys) {
          const x = keyX(k.t);
          if (x >= xa && x <= xb) picked.push({ animId: a.id, t: k.t });
        }
      });
      kfPanel.selectKeys(picked);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up, { once: true });
  }

  /* ------------------------------------------------------------ 关键帧手势 */

  /**
   * 关键帧的横坐标。**夹在轨道内**：`t = 0` 的菱形有一半会被左侧遮住，
   * `t = clipDur` 的在右边缘也一样。
   */
  function keyX(t: number): number {
    return Math.min(Math.max(t * px, 5), contentW - 5);
  }

  function onKeyDown(e: PointerEvent, animId: string, t: number): void {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const anchor = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    kfPanel.selectKey(animId, t, anchor);

    const startT = t;
    const startX = e.clientX;
    let moved = false;
    let snapped = false;
    editorState.beginGesture();
    statusHint.setGesture({
      actions: [{ keysKey: 'sc.key.shiftDrag', labelKey: 'typo.kfSnap' }],
    });
    const move = (ev: PointerEvent): void => {
      // **自由拖曳**；按住 Shift 才吸到拍（旧版无条件吸附，0.5s 一跳，像拖不动）。
      let next = Math.max(0, Math.min(clipDur, startT + (ev.clientX - startX) / px));
      if (ev.shiftKey) next = snapSec(next);
      snapped = ev.shiftKey;
      const current = kfPanel.keys[0]?.t;
      if (current === undefined || Math.abs(next - current) < 1e-9) return;
      // 索引会被重排，所以每次都用「当前时刻」定位这一帧（见 panel-state 的注释）。
      actions.moveKey(animId, current, next);
      kfPanel.moveSelection(next);
      moved = true;
    };
    const up = (): void => {
      window.removeEventListener('pointermove', move);
      statusHint.clearGesture();
      if (moved) {
        editorState.endGesture(tr('typo.undo.keyMove'));
        kfPanel.closePop();
      } else {
        editorState.cancelGesture();
        kfPanel.pop = anchor;
      }
      void snapped;
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up, { once: true });
  }

  /**
   * 双击轨道空白 = 在那一刻补一帧（值取当时的插值）。
   * 只**选中**、不弹浮层：连续补几帧时它会把刚加的点遮住。
   */
  function onLaneDblClick(e: MouseEvent, animId: string): void {
    const t = Math.min(clipDur, secAt(e.clientX));
    actions.addKey(animId, t);
    kfPanel.selectKey(animId, t);
  }

  function onPanelKey(e: KeyboardEvent): void {
    const tag = (e.target as HTMLElement | null)?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;
    if (e.key === 'Escape') {
      kfPanel.clearKeys();
      return;
    }
    if (e.key === 'Delete' || e.key === 'Backspace') {
      const sel = kfPanel.keys;
      if (!sel.length) return;
      e.preventDefault();
      // 按轨道倒序删，避免同一轨道里多次 splice 把下标挪掉（这里按时刻匹配，安全）。
      for (const k of sel) actions.removeKey(k.animId, k.t);
      kfPanel.clearKeys();
    }
  }

  /* ------------------------------------------------------------ 工具栏 */

  let addProp = $state<string>('opacity');
  let customName = $state('');
  let customValue = $state('');

  const ADD_OPTIONS = [
    ...ANIM_CHANNELS.map((c) => ({ value: c as string, label: CHANNEL_LABEL[c] })),
    { value: CUSTOM, label: tr('typo.kfCustomProp') },
  ];

  function channelOf(prop: string): AnimChannel | null {
    return isChannel(prop) ? prop : null;
  }

  function propLabel(prop: string): string {
    const ch = channelOf(prop);
    return ch ? CHANNEL_LABEL[ch] : prop;
  }

  function valueAt(a: TracksAnimation): string {
    const v = sampleKeys(a.keys, playSec);
    const ch = channelOf(a.prop);
    if (!ch) return String(v);
    const n = Number(v);
    return `${Math.round(n * 100) / 100}${CHANNEL_META[ch].unit}`;
  }

  function addProperty(): void {
    const el = selEl;
    if (!el) return;
    const prop = addProp === CUSTOM ? customName.trim() : addProp;
    if (!prop) return;
    const initial = addProp === CUSTOM ? customValue.trim() || '0' : identityValue(prop);
    actions.addTrack(prop, initial, Math.max(0, localSec));
    const found = editorState.elements
      .find((e) => e.id === el.id)
      ?.animations.find((a) => a.kind === 'tracks' && a.prop === prop);
    if (found) kfPanel.selectTrack(found.id);
    if (addProp === CUSTOM) {
      customName = '';
      customValue = '';
    }
  }

  function removeSelectedTrack(): void {
    if (!selTrack) return;
    actions.removeTrack(selTrack.id);
    kfPanel.selectTrack(null);
  }

  /* ------------------------------------------------------------ 工具栏渐变 */

  let fadeL = $state(false);
  let fadeR = $state(false);

  function updateFades(): void {
    const el = barEl;
    if (!el) {
      fadeL = fadeR = false;
      return;
    }
    const scrollable = el.scrollWidth > el.clientWidth + 1;
    fadeL = scrollable && el.scrollLeft > 1;
    fadeR = scrollable && el.scrollLeft < el.scrollWidth - el.clientWidth - 1;
  }

  $effect(() => {
    void selKey;
    void selTrack;
    void addProp;
    tick().then(updateFades);
  });

  function onBarWheel(e: WheelEvent): void {
    const el = barEl;
    if (!el) return;
    if (el.scrollWidth <= el.clientWidth) return;
    if (e.deltaY !== 0) el.scrollLeft += e.deltaY;
    if (e.deltaX !== 0) el.scrollLeft += e.deltaX;
  }

  const pop = $derived.by(() => {
    const p = kfPanel.pop;
    const sel = selKey;
    if (!p || !sel) return null;
    return { at: p, sel };
  });

  const selChannel = $derived(selKey ? channelOf(selKey.anim.prop) : null);
</script>

<!--
  键盘处理挂在容器上（Delete 删帧 / Esc 取消选择）：面板内部没有单一的聚焦元素，
  逐个按钮各挂一份只会漏。事件里已经挡掉了落在 input / textarea 上的按键。
-->
<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<section
  class="kf"
  class:collapsed={!appState.typoKfOpen}
  style:height={appState.typoKfOpen ? `${appState.typoKfHeight}px` : '28px'}
  data-testid="typo-kf-panel"
  aria-label={tr('typo.kfPanel')}
  onkeydown={onPanelKey}
>
  <div class="bar-wrap">
    <div class="kf-bar" bind:this={barEl} onscroll={updateFades} onwheel={onBarWheel}>
      <IconButton
        icon={appState.typoKfOpen ? 'chevron-down' : 'chevron-up'}
        label={appState.typoKfOpen ? tr('typo.kfCollapse') : tr('typo.kfExpand')}
        size="sm"
        testid="typo-kf-toggle"
        onclick={() => appState.setTypoKfOpen(!appState.typoKfOpen)}
      />
      <span class="title">{tr('typo.kfPanel')}</span>
      <IconButton
        icon={kfPanel.asideOpen ? 'panel-left-close' : 'panel-left-open'}
        label={kfPanel.asideOpen ? tr('typo.kfAsideFold') : tr('typo.kfAsideUnfold')}
        size="sm"
        testid="typo-kf-aside-toggle"
        disabled={!appState.typoKfOpen}
        onclick={() => (kfPanel.asideOpen = !kfPanel.asideOpen)}
      />
      <span class="sep"></span>

      <span class="sel-w">
        <Select
          value={addProp}
          options={ADD_OPTIONS}
          testid="typo-kf-prop-select"
          optionTestidPrefix="typo-kf-prop"
          onchange={(v) => (addProp = v)}
        />
      </span>
      {#if addProp === CUSTOM}
        <input
          class="txt"
          placeholder={tr('typo.kfPropName')}
          value={customName}
          data-testid="typo-kf-prop-name"
          oninput={(e) => (customName = e.currentTarget.value)}
        />
        <input
          class="txt"
          placeholder={tr('typo.kfPropValue')}
          value={customValue}
          data-testid="typo-kf-prop-value"
          oninput={(e) => (customValue = e.currentTarget.value)}
        />
      {/if}
      <IconButton
        icon="plus"
        label={tr('typo.kfAdd')}
        size="sm"
        testid="typo-kf-add-prop"
        disabled={!selEl}
        onclick={addProperty}
      />

      <span class="sep"></span>

      {#if selKey}
        {@const sk = selKey}
        <span class="lab">{tr('typo.kfKeyAt')}</span>
        <NumberInput
          value={sk.key.t}
          min={0}
          max={clipDur}
          step={0.01}
          precision={2}
          suffix="s"
          width={64}
          testid="typo-kf-key-time"
          onchange={(v) => actions.setKeyTime(sk.anim.id, sk.key.t, v)}
        />
        <IconButton
          icon="x"
          label={tr('typo.kfKeyDelete')}
          size="sm"
          testid="typo-kf-key-del"
          onclick={() => {
            actions.removeKey(sk.anim.id, sk.key.t);
            kfPanel.clearKeys();
          }}
        />
      {:else if kfPanel.keys.length > 1}
        <span class="lab">{tr('typo.kfSelCount', { n: kfPanel.keys.length })}</span>
        <IconButton
          icon="x"
          label={tr('typo.kfKeyDelete')}
          size="sm"
          testid="typo-kf-key-del"
          onclick={() => {
            for (const k of kfPanel.keys) actions.removeKey(k.animId, k.t);
            kfPanel.clearKeys();
          }}
        />
      {:else}
        <span class="lab">{tr('typo.kfNoKey')}</span>
      {/if}

      {#if selTrack}
        <IconButton
          icon="trash"
          label={tr('typo.kfRemove')}
          size="sm"
          testid="typo-kf-remove-track"
          onclick={removeSelectedTrack}
        />
      {/if}

      <span class="sep"></span>

      <IconButton
        icon={appState.playing ? 'pause' : 'play'}
        label={appState.playing ? tr('typo.animPause') : tr('typo.animPlay')}
        size="sm"
        testid="typo-kf-play"
        onclick={() => appState.togglePlay()}
      />
      <IconButton
        icon="rotate-ccw"
        label={tr('typo.animRewind')}
        size="sm"
        testid="typo-kf-rewind"
        onclick={() => clip && appState.seek(clip.start)}
      />
      <span class="clock mono" data-testid="typo-kf-clock">{playSec.toFixed(2)}s</span>
    </div>
    <div class="fade l" class:on={fadeL} aria-hidden="true"></div>
    <div class="fade r" class:on={fadeR} aria-hidden="true"></div>
  </div>

  {#if appState.typoKfOpen}
    <div class="body" style:--kf-props-w={`${PROPS_W}px`}>
      <div class="els" class:fold={!kfPanel.asideOpen} data-testid="typo-kf-els">
        {#if kfPanel.asideOpen}
          {#each listed as el (el.id)}
            <button
              type="button"
              class="el"
              class:on={el.id === selEl?.id}
              data-testid="typo-kf-el"
              onclick={() => {
                kfPanel.selectElement(el.id);
                editorState.selectOnly(el.id);
              }}
            >
              <Icon name={KIND_ICON[el.kind]} size={11} />
              <span class="nm">{el.name}</span>
              <span class="count mono">{el.animations.length}</span>
            </button>
          {/each}
          {#if !listed.length}
            <p class="empty">{tr('typo.kfEmpty')}</p>
          {/if}
        {/if}
      </div>

      <div class="panes">
        <div class="ruler-gap"></div>
        <div
          class="ruler"
          role="presentation"
          data-testid="typo-kf-ruler"
          onpointerdown={onRulerDown}
          onpointerenter={() => statusHint.setHover({ kind: 'kfRuler' })}
          onpointerleave={() => statusHint.clearHover()}
        >
          <div class="ruler-inner" style:transform={`translateX(${-scrollLeft}px)`}>
            {#each beatTicks as tk (tk.x)}
              <i class="beat" class:is-bar={tk.bar} style:left={`${tk.x}px`}></i>
            {/each}
            {#each ticks as tk (tk.x)}
              <i class="tick" style:left={`${tk.x}px`}></i>
              <span class="tick-label mono" style:left={`${tk.x + 3}px`}>{tk.label}</span>
            {/each}
            <i class="ruler-head" style:left={`${playSec * px}px`}></i>
          </div>
        </div>

        <div class="props" bind:this={propsEl} data-testid="typo-kf-props">
          {#each tracks as a (a.id)}
            <div class="prop-row" class:on={a.id === selTrack?.id} data-testid="typo-kf-track">
              <span class="pname">{propLabel(a.prop)}</span>
              <span class="pval mono">{valueAt(a)}</span>
            </div>
          {/each}
          {#each legacy as leg (leg.id)}
            <div class="prop-row" data-testid="typo-kf-legacy">
              <span class="pname">
                {leg.kind === 'preset' ? leg.preset : tr('typo.anim.custom')}
              </span>
              <span class="pval">{tr('typo.kfLegacy')}</span>
              <IconButton
                icon="trash"
                label={tr('typo.kfRemove')}
                size="sm"
                onclick={() => actions.removeTrack(leg.id)}
              />
            </div>
          {/each}
        </div>

        <div
          class="vscroll"
          bind:this={vscrollEl}
          onscroll={onScroll}
          onwheel={onWheel}
          onpointerdown={onLanesDown}
          onpointerenter={() => statusHint.setHover({ kind: 'kf' })}
          onpointerleave={() => statusHint.clearHover()}
          data-testid="typo-kf-lanes"
          role="presentation"
        >
          <div class="grid" style:width={`${contentW}px`}>
            {#each tracks as a (a.id)}
              <div class="lane-row" style:width={`${contentW}px`} class:on={a.id === selTrack?.id}>
                <div
                  class="lane"
                  data-testid="typo-kf-lane"
                  role="presentation"
                  ondblclick={(e) => onLaneDblClick(e, a.id)}
                >
                  {#each a.keys as k (k.t)}
                    {@const kind = easeKindOf(k.ease)}
                    <button
                      type="button"
                      class="key"
                      class:diamond={kind === 'none'}
                      class:round={kind === 'curve'}
                      class:square={kind === 'step'}
                      class:on={isSel(a.id, k.t)}
                      style:left={`${keyX(k.t)}px`}
                      data-testid="typo-kf-key"
                      data-t={k.t}
                      aria-label={`${propLabel(a.prop)} ${k.t.toFixed(2)}s`}
                      onpointerdown={(e) => onKeyDown(e, a.id, k.t)}
                    ></button>
                  {/each}
                </div>
              </div>
            {/each}
            {#each legacy as leg (leg.id)}
              <div class="lane-row"><div class="lane"></div></div>
            {/each}

            {#if !tracks.length && !legacy.length}
              <p class="empty rows-empty">{tr('typo.kfNoTrack')}</p>
            {/if}

            <i class="playhead" style:left={`${playSec * px}px`}></i>

            {#if marquee}
              <div
                class="marquee"
                style:left={`${Math.min(marquee.x0, marquee.x1)}px`}
                style:top={`${Math.min(marquee.y0, marquee.y1)}px`}
                style:width={`${Math.abs(marquee.x1 - marquee.x0)}px`}
                style:height={`${Math.abs(marquee.y1 - marquee.y0)}px`}
              ></div>
            {/if}
          </div>
        </div>
      </div>
    </div>
  {/if}
</section>

{#if pop && kfPanel.pop}
  <KeyframePopover
    animId={pop.sel.anim.id}
    t={pop.sel.key.t}
    value={pop.sel.key.v}
    unit={selChannel ? CHANNEL_META[selChannel].unit : ''}
    min={selChannel ? CHANNEL_META[selChannel].min : undefined}
    max={selChannel ? CHANNEL_META[selChannel].max : undefined}
    step={selChannel ? CHANNEL_META[selChannel].step : 1}
    numeric={!!selChannel}
    ease={pop.sel.key.ease ?? null}
    hasNext={pop.sel.index < pop.sel.anim.keys.length - 1}
    at={kfPanel.pop}
    onclose={() => kfPanel.closePop()}
  />
{/if}

<style>
  .kf {
    /* 高度是内联的实例值（可拖），不吃剩余空间 —— 剩余空间是画布的。 */
    flex: none;
    display: grid;
    grid-template-rows: 28px minmax(0, 1fr);
    min-height: 0;
    background: var(--surface-1);
    border-top: 1px solid var(--border);
  }
  .kf.collapsed {
    grid-template-rows: 28px;
    overflow: hidden;
  }

  /* ---- 工具栏（横向滚动 + 两端渐变） ---- */
  .bar-wrap {
    position: relative;
    min-width: 0;
    border-bottom: 1px solid var(--border);
  }
  .kf-bar {
    display: flex;
    align-items: center;
    gap: var(--sp-2);
    height: 27px;
    padding: 0 var(--sp-3);
    overflow-x: auto;
    overflow-y: hidden;
    overscroll-behavior-x: contain;
    scrollbar-width: none;
  }
  .kf-bar::-webkit-scrollbar {
    display: none;
  }
  .fade {
    position: absolute;
    top: 0;
    bottom: 0;
    width: 20px;
    pointer-events: none;
    opacity: 0;
    transition: opacity 120ms ease;
  }
  .fade.l {
    left: 0;
    background: linear-gradient(to right, var(--surface-1), transparent);
  }
  .fade.r {
    right: 0;
    background: linear-gradient(to left, var(--surface-1), transparent);
  }
  .fade.on {
    opacity: 1;
  }

  .title {
    font-size: var(--fs-xs);
    font-weight: 600;
    color: var(--text-primary);
    white-space: nowrap;
  }
  .sep {
    flex: none;
    width: 1px;
    height: 14px;
    background: var(--border);
  }
  .lab {
    font-size: var(--fs-xs);
    color: var(--text-muted);
    white-space: nowrap;
  }
  .clock {
    font-size: var(--fs-xs);
    color: var(--text-secondary);
    min-width: 42px;
    text-align: right;
  }
  .mono {
    font-variant-numeric: tabular-nums;
  }
  /* .sel 自带 flex:1，放进 flex 行会被拉长 —— 定宽框住它。 */
  .sel-w {
    display: inline-flex;
    width: 92px;
    flex: none;
  }
  .txt {
    height: 20px;
    width: 84px;
    flex: none;
    padding: 0 var(--sp-1);
    font-size: var(--fs-xs);
    color: var(--text-primary);
    background: var(--surface-0);
    border: 1px solid var(--border);
    border-radius: 4px;
  }

  /* ---- 主体：元素列 + 三格 pane ---- */
  .body {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    min-height: 0;
  }
  .els {
    width: 148px;
    min-height: 0;
    overflow-y: auto;
    background: var(--surface-2);
    border-right: 1px solid var(--border);
  }
  .els.fold {
    width: 0;
    overflow: hidden;
    border-right: none;
  }
  .el {
    display: flex;
    align-items: center;
    gap: var(--sp-2);
    width: 100%;
    height: 24px;
    padding: 0 var(--sp-2);
    background: transparent;
    border: none;
    border-radius: 0;
    color: var(--text-secondary);
    font-size: var(--fs-xs);
    text-align: left;
    cursor: pointer;
  }
  .el:hover {
    background: var(--surface-hover);
    color: var(--text-primary);
  }
  .el.on {
    background: var(--surface-3);
    color: var(--text-primary);
  }
  .nm {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .count {
    color: var(--text-muted);
  }

  /*
   * 属性列与轨道**不共用横向滚动容器**：属性列是独立的一格，只同步纵向滚动。
   * （早先靠 `sticky` 冻结，结果属性列只有行高那么高，横向滚起来播放头会从它
   * 下面露出来。）
   */
  .panes {
    display: grid;
    grid-template-columns: var(--kf-props-w, 132px) minmax(0, 1fr);
    grid-template-rows: 22px minmax(0, 1fr);
    min-width: 0;
    min-height: 0;
  }
  .ruler-gap {
    background: var(--surface-1);
    border-bottom: 1px solid var(--border);
    border-right: 1px solid var(--border);
  }

  /* ---- 标尺 ---- */
  .ruler {
    position: relative;
    overflow: hidden;
    border-bottom: 1px solid var(--border);
    background: var(--surface-1);
    cursor: ew-resize;
  }
  .ruler-inner {
    position: relative;
    height: 100%;
    will-change: transform;
  }
  .beat {
    position: absolute;
    top: 15px;
    bottom: 0;
    width: 1px;
    background: var(--border);
  }
  /*
   * 注意类名：修饰符不能叫 `bar` —— 本组件里 `.bar` 是顶栏（Svelte 的 scoped
   * class 会同时命中 `class:bar`），结果每小节线上长出一个 12×27 的方块
   * （用户看到的「标尺上的小方块」）。
   */
  .beat.is-bar {
    top: 10px;
    background: var(--text-muted);
    opacity: 0.45;
  }
  .tick {
    position: absolute;
    top: 8px;
    bottom: 0;
    width: 1px;
    background: var(--text-muted);
    opacity: 0.7;
  }
  .tick-label {
    position: absolute;
    top: 1px;
    font-size: 9px;
    color: var(--text-muted);
    pointer-events: none;
    white-space: nowrap;
  }
  .ruler-head {
    position: absolute;
    top: 0;
    bottom: 0;
    width: 1px;
    background: var(--accent);
    pointer-events: none;
  }

  /* ---- 属性列（整列撑满，独立纵向滚动） ---- */
  .props {
    min-height: 0;
    overflow: hidden;
    background: var(--surface-2);
    border-right: 1px solid var(--border);
  }
  .prop-row {
    display: flex;
    align-items: center;
    gap: var(--sp-2);
    height: 24px;
    padding: 0 var(--sp-2);
    border-bottom: 1px solid var(--border);
    font-size: var(--fs-xs);
    color: var(--text-secondary);
  }
  .prop-row.on {
    color: var(--accent);
    background: var(--surface-1);
  }
  .pname {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .pval {
    color: var(--text-muted);
  }

  /* ---- 轨道区（横 + 纵滚动） ---- */
  .vscroll {
    position: relative;
    min-height: 0;
    overflow: auto;
    overscroll-behavior: contain;
    background: var(--surface-0);
    touch-action: none;
  }
  .grid {
    position: relative;
    min-height: 100%;
  }
  .lane-row {
    position: relative;
    height: 24px;
    border-bottom: 1px solid var(--border);
  }
  .lane-row.on {
    background: var(--surface-1);
  }
  .lane {
    position: relative;
    height: 100%;
  }

  /* ---- 关键帧：形状 = 缓动种类 ---- */
  .key {
    position: absolute;
    top: 50%;
    width: 9px;
    height: 9px;
    padding: 0;
    /* 白（浅色）/ 近底（深色）填充 + 深灰描边：不再是一块纯黑。 */
    background: var(--surface-0);
    border: 1px solid var(--text-secondary);
    border-radius: 0;
    transform: translate(-50%, -50%);
    cursor: ew-resize;
  }
  /* 缺省缓动（跟随条目）= 菱形 */
  .key.diamond {
    width: 8px;
    height: 8px;
    transform: translate(-50%, -50%) rotate(45deg);
  }
  /* cubic-bezier / 关键字 = 圆形 */
  .key.round {
    border-radius: 50%;
  }
  /* steps() = 方形（默认形态，不旋转） */
  .key:hover {
    border-color: var(--text-primary);
  }
  .key.on {
    border-color: var(--accent);
    box-shadow: 0 0 0 1px var(--accent);
  }
  .playhead {
    position: absolute;
    top: 0;
    bottom: 0;
    width: 1px;
    background: var(--accent);
    pointer-events: none;
  }
  /*
   * 框选矩形必须**半透明**：它盖在轨道之上，不透明的话框的过程看不见底下
   * 选到了哪些帧（与时间轴的 `.marquee` 同款，用 color-mix 而不是 --accent-weak）。
   */
  .marquee {
    position: absolute;
    border: 1px solid var(--accent);
    background: color-mix(in srgb, var(--accent) 16%, transparent);
    pointer-events: none;
  }
  .empty {
    margin: var(--sp-2);
    font-size: var(--fs-xs);
    color: var(--text-muted);
  }
  .rows-empty {
    position: absolute;
    left: 8px;
    top: 2px;
  }
</style>

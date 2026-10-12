<script lang="ts">
  /**
   * AnimationPanel — 「动画窗格」（与图层面板共用右侧同一个位置，选项卡切换）。
   *
   * 存在理由是一条实测到的困惑：**给元素加一个「淡入」之后，它在排版编辑器里
   * 直接消失了**。那不是 bug —— 动画的初始状态就是 opacity 0，而舞台是拿
   * 片段本地时间 seek 过的（预览 = 导出，AGENTS §1.1）。但界面上没有任何地方
   * 告诉用户「这个元素挂着一段 0.6 秒的动画，现在正处在第 0 秒」。
   *
   * 所以这里回答三件事：
   *   ① 谁挂了动画、挂的是什么、什么时候开始、持续多久；
   *   ② 当前播放头落在动画的哪一段（顶部那条时间轴 + 播放头）；
   *   ③ 一键从这段动画**开始之前**播一遍，让人看到它是怎么进来的。
   *
   * 时间一律相对**片段起点**，与 animation.ts 的口径一致。
   */
  import Icon from '../Icon.svelte';
  import { appState } from '../app-state.svelte';
  import { editorState } from './editor-state.svelte';
  import { customSubAnimations, isPresetId, presetLabel } from '../../typography/animation';
  import type { TypographyElement, ElementAnimation } from '../../typography/document';
  import { tr } from '../../i18n/index.svelte';

  /**
   * 一条**实际会跑**的动画。预设 / 旧单 body 自定义条目 = 一条；
   * 多动画自定义条目（逗号简写）= 每条一行 —— 这样时间轴画出的条数
   * 与烘焙要 seek 的动画数一致（都来自 customSubAnimations）。
   */
  interface AnimEntry {
    /** 稳定键：单条用条目 id，多条再加序号。 */
    key: string;
    label: string;
    delay: number;
    duration: number;
  }

  interface AnimRow {
    id: string;
    name: string;
    kind: TypographyElement['kind'];
    entries: AnimEntry[];
  }

  const KIND_ICON: Record<TypographyElement['kind'], 'type' | 'shapes' | 'image'> = {
    text: 'type',
    shape: 'shapes',
    image: 'image',
  };

  const clip = $derived.by(() => {
    void appState.version;
    return editorState.clip;
  });

  const clipDur = $derived(clip ? Math.max(0.001, clip.end - clip.start) : 1);

  const localSec = $derived.by(() => {
    void appState.playT;
    const c = clip;
    return c ? appState.playT - c.start : 0;
  });

  function labelOf(a: ElementAnimation): string {
    return a.kind === 'preset' ? presetLabel(a.preset) : tr('typo.anim.custom');
  }

  function entryLabel(name: string): string {
    return isPresetId(name) ? presetLabel(name) : name;
  }

  function entriesOf(a: ElementAnimation): AnimEntry[] {
    if (a.kind === 'custom' && a.animation) {
      return customSubAnimations(a).map((p, i) => ({
        key: `${a.id}:${i}`,
        label: entryLabel(p.name),
        delay: p.delay,
        duration: p.duration,
      }));
    }
    return [{ key: a.id, label: labelOf(a), delay: a.delay, duration: a.duration }];
  }

  /** 有动画的元素。倒序 = 与图层列表同向（前景在上）。 */
  const rows = $derived.by<AnimRow[]>(() => {
    void appState.version;
    return editorState.elements
      .filter((e) => e.animations.length > 0)
      .map((e) => ({
        id: e.id,
        name: e.name || e.kind,
        kind: e.kind,
        entries: e.animations.flatMap((a) => entriesOf(a)),
      }))
      .reverse();
  });

  /** 一条动画在片段时间轴上的条（百分比）。迭代次数不计入长度 —— 那是循环，不是"更长的一根"。 */
  function barStyle(e: AnimEntry): string {
    const left = Math.min(100, Math.max(0, (e.delay / clipDur) * 100));
    const w = Math.min(100 - left, Math.max(0.6, (e.duration / clipDur) * 100));
    return `left:${left}%;width:${w}%`;
  }

  const playheadPct = $derived(Math.min(100, Math.max(0, (localSec / clipDur) * 100)));

  /** 这些动画最早从什么时候开始 —— 一键预览就是从这里往前一点起播。 */
  function earliestDelay(entries: AnimEntry[]): number {
    return entries.reduce((m, e) => Math.min(m, e.delay), Number.POSITIVE_INFINITY);
  }

  function preview(entries: AnimEntry[]): void {
    const c = clip;
    if (!c) return;
    const first = earliestDelay(entries);
    const at = Number.isFinite(first) ? Math.max(0, first - 0.2) : 0;
    appState.seek(c.start + at);
    if (!appState.playing) appState.togglePlay();
  }

  function selectRow(id: string): void {
    editorState.selectOnly(id);
  }

  function rowSelected(id: string): boolean {
    void appState.version;
    return editorState.isSelected(id);
  }
</script>

<div class="anim" data-testid="typo-anim-pane">
  <div class="bar">
    <button
      type="button"
      class="ic"
      aria-label={appState.playing ? tr('typo.animPause') : tr('typo.animPlay')}
      data-testid="typo-anim-play"
      onclick={() => appState.togglePlay()}
    >
      <Icon name={appState.playing ? 'pause' : 'play'} size={12} />
    </button>
    <button
      type="button"
      class="ic"
      aria-label={tr('typo.animRewind')}
      data-testid="typo-anim-rewind"
      onclick={() => clip && appState.seek(clip.start)}
    >
      <Icon name="rotate-ccw" size={12} />
    </button>
    <!-- 播放头读数：与舞台被 seek 到的是同一个量，所以它能解释
         「为什么元素现在是看不见的」。 -->
    <span class="t mono" data-testid="typo-anim-time">{localSec.toFixed(2)}s</span>
    <span class="spacer"></span>
    <span class="hint">{tr('typo.animCount', { n: rows.length })}</span>
  </div>

  <!-- 片段时间轴：所有动画条共用的时间基准。 -->
  <div class="ruler">
    <div class="ruler-fill" style:width={`${playheadPct}%`}></div>
    <i class="playhead" style:left={`${playheadPct}%`}></i>
  </div>

  <div class="list">
    {#each rows as row (row.id)}
      <div
        class="row"
        class:selected={rowSelected(row.id)}
        role="presentation"
        data-testid="typo-anim-row"
        onclick={() => selectRow(row.id)}
      >
        <div class="row-head">
          <Icon name={KIND_ICON[row.kind]} size={12} />
          <span class="name">{row.name}</span>
          <button
            type="button"
            class="ic"
            aria-label={tr('typo.animPreview')}
            data-testid="typo-anim-preview"
            onclick={(e) => {
              e.stopPropagation();
              selectRow(row.id);
              preview(row.entries);
            }}
          >
            <Icon name="play" size={11} />
          </button>
        </div>
        {#each row.entries as e (e.key)}
          <div class="entry" data-testid="typo-anim-entry">
            <span class="alabel">{e.label}</span>
            <span class="span">
              <i class="seg" style={barStyle(e)}></i>
            </span>
            <span class="time mono">{e.delay.toFixed(2)}s · {e.duration.toFixed(2)}s</span>
          </div>
        {/each}
      </div>
    {/each}

    {#if rows.length === 0}
      <p class="empty">{tr('typo.animEmpty')}</p>
    {/if}
  </div>
</div>

<style>
  .anim {
    display: grid;
    grid-template-rows: auto auto minmax(0, 1fr);
    min-height: 0;
    background: var(--surface-1);
  }
  .bar {
    display: flex;
    align-items: center;
    gap: var(--sp-1);
    padding: 2px var(--sp-3);
    border-bottom: 1px solid var(--border);
  }
  .spacer {
    margin-left: auto;
  }
  .t {
    font-size: var(--fs-xs);
    color: var(--text-secondary);
    min-width: 46px;
  }
  .hint {
    font-size: var(--fs-xs);
    color: var(--text-muted);
    white-space: nowrap;
  }
  .ruler {
    position: relative;
    height: 14px;
    margin: 3px var(--sp-3);
    background: var(--surface-2);
    border-radius: var(--radius-sm);
    overflow: hidden;
  }
  .ruler-fill {
    position: absolute;
    left: 0;
    top: 0;
    bottom: 0;
    background: var(--accent-weak);
  }
  .playhead {
    position: absolute;
    top: 0;
    bottom: 0;
    width: 1px;
    background: var(--accent);
  }
  .list {
    overflow: auto;
    min-height: 0;
  }
  .row {
    padding: 3px var(--sp-3) 5px;
    cursor: pointer;
    border-bottom: 1px solid var(--border);
  }
  .row:hover {
    background: var(--surface-hover);
  }
  .row.selected {
    background: var(--accent-weak);
  }
  .row-head {
    display: flex;
    align-items: center;
    gap: var(--sp-2);
    height: 18px;
    color: var(--text-secondary);
    font-size: var(--fs-sm);
  }
  .row.selected .row-head {
    color: var(--accent);
  }
  .name {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .entry {
    display: flex;
    align-items: center;
    gap: var(--sp-2);
    height: 16px;
    font-size: var(--fs-xs);
    color: var(--text-muted);
  }
  .alabel {
    width: 62px;
    flex: none;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .span {
    position: relative;
    flex: 1;
    min-width: 0;
    height: 7px;
    background: var(--surface-2);
    border-radius: 4px;
  }
  .seg {
    position: absolute;
    top: 0;
    bottom: 0;
    background: var(--accent);
    border-radius: 4px;
    opacity: 0.75;
  }
  .time {
    flex: none;
    font-size: var(--fs-xs);
  }
  .empty {
    padding: var(--sp-4);
    margin: 0;
    font-size: var(--fs-xs);
    color: var(--text-muted);
    line-height: 1.5;
  }
  .ic {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 18px;
    height: 18px;
    padding: 0;
    background: transparent;
    border: none;
    border-radius: var(--radius-sm);
    color: inherit;
    cursor: pointer;
  }
  .ic:hover {
    color: var(--text-primary);
  }
</style>

<script lang="ts">
  import { appState } from '../ui/app-state.svelte';
  import { xOfTime } from './view-model';
  import { startClipDrag } from './drag';
  import type { AnyClip, Track } from '../core/schema';

  const { track, clip }: { track: Track; clip: AnyClip } = $props();

  const grid = $derived.by(() => {
    void appState.version;
    return appState.store.project.beatGrid;
  });
  // 订阅 version：clip 是原地改的对象，不订版本位置不更新（见 Timeline 的纪律注释）
  const left = $derived.by(() => {
    void appState.version;
    return xOfTime(clip.start, appState.pxPerBeat, grid);
  });
  const width = $derived.by(() => {
    void appState.version;
    return Math.max(
      4,
      xOfTime(clip.end, appState.pxPerBeat, grid) - xOfTime(clip.start, appState.pxPerBeat, grid),
    );
  });
  const selected = $derived(appState.selectedClipId === clip.id);
  /** 拖拽中且当前落点会被拒收（reject 策略）：红框预告，避免「松手弹回去」的困惑。 */
  const illegal = $derived(selected && appState.dragIllegal);

  function down(e: PointerEvent, mode: 'move' | 'resize-l' | 'resize-r'): void {
    // 只有主键起手势：右键归自绘菜单（Timeline 的 contextmenu），中键归浏览器
    if (e.button !== 0) return;
    appState.selectedClipId = clip.id;
    startClipDrag(e, appState.store, {
      track,
      clip,
      mode,
      pxPerBeat: appState.pxPerBeat,
      snapMode: appState.snap,
      onHint: (illegal) => (appState.dragIllegal = illegal),
    });
  }

  function dblclick(e: MouseEvent): void {
    // 双击：在该处切分（吸附到当前档位）
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const frac = (e.clientX - rect.left) / Math.max(1, rect.width);
    const t = clip.start + frac * (clip.end - clip.start);
    const snapped = Math.min(clip.end - 0.05, Math.max(clip.start + 0.05, t));
    appState.store.splitClipAt(track.id, clip.id, snapped);
  }
</script>

<div
  class="clip"
  class:selected
  class:effect={clip.kind === 'effect'}
  class:audio={clip.kind === 'audio'}
  data-clip-id={clip.id}
  data-testid="clip"
  data-illegal={illegal ? 'true' : undefined}
  style:left={`${left}px`}
  style:width={`${width}px`}
  role="button"
  tabindex="0"
  onpointerdown={(e) => down(e, 'move')}
  ondblclick={dblclick}
>
  <span class="label">{clip.label || clip.kind}</span>
  {#if clip.fadeSec > 0}
    <!-- 淡入淡出标记：纯几何形状，不引图标（这里只有 10px 见方） -->
    <i class="fade" title="淡入淡出"></i>
  {/if}
  <i class="edge l" role="presentation" onpointerdown={(e) => down(e, 'resize-l')}></i>
  <i class="edge r" role="presentation" onpointerdown={(e) => down(e, 'resize-r')}></i>
</div>

<style>
  /*
   * 片段色走 content 层（--clip-*），它随亮暗变但**不随主题色变**：
   * 这里的颜色编码的是「这是哪类数据」，不是界面角色。详见 ui/tokens.ts。
   */
  .clip {
    position: absolute;
    top: 3px;
    bottom: 3px;
    background: var(--clip-source-bg);
    border: 1px solid var(--clip-source-border);
    border-radius: var(--radius-sm);
    color: var(--clip-source-text);
    cursor: grab;
    overflow: hidden;
    user-select: none;
    touch-action: none;
  }
  .clip:active {
    cursor: grabbing;
  }
  .clip.selected {
    /* 选中用主题色描边——这是「主题色只出现在当前/激活态」的一处。 */
    outline: 2px solid var(--accent);
    outline-offset: -1px;
    z-index: var(--z-clip-selected);
  }
  /* 落点会被 reject 策略拒收：松手会整次弹回，先在这里预告 */
  .clip[data-illegal='true'] {
    outline: 2px dashed var(--danger);
    outline-offset: -1px;
    opacity: 0.7;
  }
  .clip.effect {
    background: var(--clip-effect-bg);
    border-color: var(--clip-effect-border);
    color: var(--clip-effect-text);
  }
  .clip.audio {
    background: var(--clip-audio-bg);
    border-color: var(--clip-audio-border);
    color: var(--clip-audio-text);
  }
  .label {
    position: absolute;
    left: 5px;
    top: 1px;
    right: 12px;
    font-size: var(--fs-xs);
    line-height: 14px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    pointer-events: none;
  }
  .fade {
    position: absolute;
    right: 2px;
    top: 2px;
    width: 0;
    height: 0;
    border-left: 7px solid transparent;
    border-bottom: 7px solid currentColor;
    opacity: 0.5;
  }
  .edge {
    position: absolute;
    top: 0;
    bottom: 0;
    width: 6px;
    cursor: ew-resize;
    z-index: var(--z-edge);
  }
  .edge.l {
    left: 0;
  }
  .edge.r {
    right: 0;
  }
  /* 纯图标/纯热区 hover 不用底色块，只提亮——与全局「图标按钮 hover 只变色」一致 */
  .edge:hover {
    background: color-mix(in srgb, currentColor 22%, transparent);
  }
</style>

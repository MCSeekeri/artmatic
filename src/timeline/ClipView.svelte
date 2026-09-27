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
    return Math.max(4, xOfTime(clip.end, appState.pxPerBeat, grid) - xOfTime(clip.start, appState.pxPerBeat, grid));
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
  class:illegal
  class:effect={clip.kind === 'effect'}
  class:audio={clip.kind === 'audio'}
  data-clip-id={clip.id}
  style:left={`${left}px`}
  style:width={`${width}px`}
  role="button"
  tabindex="0"
  onpointerdown={(e) => down(e, 'move')}
  ondblclick={dblclick}
>
  <span class="label">{clip.label || clip.kind}</span>
  {#if clip.fadeSec > 0}
    <i class="fade" title="淡入淡出"></i>
  {/if}
  <i class="edge l" role="presentation" onpointerdown={(e) => down(e, 'resize-l')}></i>
  <i class="edge r" role="presentation" onpointerdown={(e) => down(e, 'resize-r')}></i>
</div>

<style>
  .clip {
    position: absolute;
    top: 4px;
    bottom: 4px;
    background: var(--accent-dim);
    border: 1px solid var(--accent);
    border-radius: 4px;
    cursor: grab;
    overflow: hidden;
    user-select: none;
    touch-action: none;
  }
  .clip:active {
    cursor: grabbing;
  }
  .clip.selected {
    outline: 2px solid #fff;
    z-index: 3;
  }
  /* 落点会被 reject 策略拒收：松手会整次弹回，先在这里预告 */
  .clip.illegal {
    outline: 2px dashed var(--danger);
    opacity: 0.7;
  }
  .clip.effect {
    background: #4a3a6e;
    border-color: #9a7ee8;
  }
  .clip.audio {
    background: #1e4a38;
    border-color: #51cf8a;
  }
  .label {
    position: absolute;
    left: 6px;
    top: 2px;
    right: 14px;
    font-size: 10px;
    color: rgba(255, 255, 255, 0.85);
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
    border-left: 8px solid transparent;
    border-bottom: 8px solid rgba(255, 255, 255, 0.5);
  }
  .edge {
    position: absolute;
    top: 0;
    bottom: 0;
    width: 7px;
    cursor: ew-resize;
    z-index: 2;
  }
  .edge.l {
    left: 0;
  }
  .edge.r {
    right: 0;
  }
  .edge:hover {
    background: rgba(255, 255, 255, 0.25);
  }
</style>

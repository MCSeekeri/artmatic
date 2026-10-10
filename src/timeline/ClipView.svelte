<script lang="ts">
  import { appState } from '../ui/app-state.svelte';
  import { xOfTime } from './view-model';
  import { startClipDrag, type DragPeer } from './drag';
  import type { AnyClip, Track } from '../core/schema';
  import { tr } from '../i18n/index.svelte';

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
  // 读的是**选中集**，不是主选中（selectedClipId 只是集合第一个元素的视图）。
  // 框选与 Shift+单击都能让集合里不止一个。
  const selected = $derived(appState.isClipSelected(clip.id));
  /** 拖拽中且当前落点会被拒收（reject 策略）：红框预告，避免「松手弹回去」的困惑。 */
  const illegal = $derived(selected && appState.dragIllegal);

  function down(e: PointerEvent, mode: 'move' | 'resize-l' | 'resize-r'): void {
    // 只有主键起手势：右键归自绘菜单（Timeline 的 contextmenu），中键归浏览器
    if (e.button !== 0) return;
    /*
     * Shift / Ctrl + 单击 = 加选 / 减选，**不起拖拽**。
     * 这是框选之后的微调手段：框多了一个、漏了一个都能就地补，
     * 没有它就只能整片重框。只在 move 上生效 —— 左右边缘是缩放热区，
     * 在那里加选会让人没法微调一个已选片段的长度。
     */
    if (mode === 'move' && (e.shiftKey || e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      e.stopPropagation();
      appState.toggleClipSelection(clip.id);
      return;
    }
    /*
     * 拖**已在选中集里**的片段 = 整组一起走；拖没选中的片段 = 先单选它再拖。
     *
     * 判据是「按下时它已经选中」而不是「选中集非空」—— 后者会让用户想单独挪一个
     * 片段时发现整片选择跟着动，而他从没表达过这个意图。
     * 组只在 move 上成立：缩放是「这条边的位置」，套到一组上没有唯一定义。
     */
    const selected = appState.selectedClipIds;
    const group = mode === 'move' && selected.length > 1 && selected.includes(clip.id);
    const peers: DragPeer[] = [];
    if (group) {
      for (const id of selected) {
        if (id === clip.id) continue;
        const found = appState.store.findClip(id);
        if (found) peers.push({ clipId: id, trackId: found.track.id, start: found.clip.start });
      }
    } else {
      appState.selectClip(clip.id);
    }
    startClipDrag(e, appState.store, {
      track,
      clip,
      mode,
      pxPerBeat: appState.pxPerBeat,
      snapMode: appState.snap,
      peers,
      onHint: (illegal) => (appState.dragIllegal = illegal),
      /*
       * 按下了但没拖动 = 一次单击（见 DragOptions.onClick）：整组拖动成立的前提是
       * 按下时**保持**选中集，所以「只选它一个」这件事只能放到松手时做。
       */
      onClick: () => appState.selectClip(clip.id),
    });
  }

  function dblclick(): void {
    /*
     * 双击 = 打开这个片段自己的编辑器，**一律不切分**。
     * 破坏性操作不该绑在高误触手势上（原来双击切分，很容易手一抖就把片段切开）。
     * 切分保留两个入口：S 键、检查器的「在播放头切分」。
     */
    appState.selectedClipId = clip.id;
    appState.openClipEditor(clip);
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
    <i class="fade" title={tr('tl.fade')}></i>
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

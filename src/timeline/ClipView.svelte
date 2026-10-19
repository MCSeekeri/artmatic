<script lang="ts">
  import { appState } from '../ui/app-state.svelte';
  import { pxPerSec, xOfTime } from './view-model';
  import { startClipDrag, type DragPeer, type DragMode } from './drag';
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

  /**
   * 影响深度（0 = 下方全部）。
   *
   * **必须走 version 订阅过的派生，不能在模板里直接读 `clip.affectDepth`**：
   * clip 是原地改的对象，父级 `{#each}` 传下来的还是同一个引用 ⇒ 直接读不会重渲
   * （症状：检查器里把深度从 0 改成 1，片段上的角标要等换一次选中才出现）。
   * 这与 `left` / `width` 是同一条纪律（见 Timeline.svelte 的响应式说明）。
   */
  const affectDepth = $derived.by(() => {
    void appState.version;
    return clip.kind === 'effect' ? (clip.affectDepth ?? 0) : 0;
  });

  /**
   * 音频淡变手柄的横向位置（px，片段内偏移）。
   *
   * 两端手柄贴住**淡变区的边界**（而不是片段边缘）：看到的就是听到的 ——
   * 三角在 1.5s 处，声音就从 1.5s 处淡进来。淡变为 0 时回到边缘。
   */
  const fadeInPx = $derived.by(() => {
    void appState.version;
    if (clip.kind !== 'audio') return 0;
    return (clip.fadeIn ?? 0) * pxPerSec(appState.pxPerBeat, grid);
  });
  const fadeOutPx = $derived.by(() => {
    void appState.version;
    if (clip.kind !== 'audio') return 0;
    return (clip.fadeOut ?? 0) * pxPerSec(appState.pxPerBeat, grid);
  });

  function down(e: PointerEvent, mode: DragMode): void {
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

  /** 正在就地改名的那一行（见 appState.renamingClipId）。 */
  const renaming = $derived(appState.renamingClipId === clip.id);

  /**
   * 就地改名的输入框只在 `appState.renamingClipId === clip.id` 时渲染。
   *
   * **入口是 F2（选中片段后），不是双击**：片段本体的双击已经是「打开它的
   * 编辑器」，而片段很矮（行高 ~24px）—— 名字那条带子几乎盖住整个片段，
   * 「双击名字改名」实测会把所有「双击片段开编辑器」的路径抢走
   * （typography 那一批 spec 一起红）。所以改名只用不与既有手势冲突的入口：
   * F2、以及检查器里那个 `clip-label` 输入框。
   */
  function commitRename(value: string): void {
    appState.store.renameClip(clip.id, value);
    appState.endClipRename();
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
  {#if renaming}
    <!--
      svelte-ignore a11y_autofocus
      输入框盖住标签那一块（同名区域，见 CSS 的 `.label, .rename`）。
      `onpointerdown` 停冒泡是**必须的**：不停的话按下去就开始拖片段，
      指针一移输入框就被拖走了（与轨道名就地改名同一套）。
    -->
    <input
      class="rename"
      data-testid="clip-rename-input"
      value={clip.label || clip.kind}
      autofocus
      onblur={(e) => commitRename(e.currentTarget.value)}
      onkeydown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          commitRename(e.currentTarget.value);
        } else if (e.key === 'Escape') {
          e.preventDefault();
          appState.endClipRename();
        }
      }}
      onpointerdown={(e) => e.stopPropagation()}
      ondblclick={(e) => e.stopPropagation()}
    />
  {:else}
    <!--
      名字**不吃指针事件**（见 CSS 的 `.label`）：双击必须原样落到片段本体上
      —— 那是「打开编辑器」，是这里被点得最多的那一下。改名的入口是 F2。
    -->
    <span class="label" data-testid="clip-name">{clip.label || clip.kind}</span>
  {/if}
  {#if affectDepth > 0}
    <!-- 影响深度角标：不写出来就没人知道这条特效被限过范围（画面差别还很隐蔽） -->
    <span class="fx-depth" data-testid="clip-effect-depth" title={tr('insp.affectDepth')}>↓{affectDepth}</span>
  {/if}
  {#if clip.fadeSec > 0}
    <!-- 淡入淡出标记：纯几何形状，不引图标（这里只有 10px 见方） -->
    <i class="fade" title={tr('tl.fade')}></i>
  {/if}
  {#if clip.kind === 'audio'}
    <!--
      音频淡变手柄（v8）：两端各一个三角，拖的是 `fadeIn` / `fadeOut` 的**秒数**。
      左下 / 右下两个角 —— 右上角已经被 `fadeSec` 的标记占了。
      与缩放热区重叠：手柄 z 更高，所以边缘那 8px 归手柄（缩放热区仍是整条边）。
    -->
    <i
      class="fade-handle l"
      role="presentation"
      data-testid="clip-fade-in"
      title={tr('tl.fadeInTip')}
      style:left={`${fadeInPx}px`}
      onpointerdown={(e) => down(e, 'fade-in')}
    ></i>
    <i
      class="fade-handle r"
      role="presentation"
      data-testid="clip-fade-out"
      title={tr('tl.fadeOutTip')}
      style:right={`${fadeOutPx}px`}
      onpointerdown={(e) => down(e, 'fade-out')}
    ></i>
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
  /*
   * 名字区与改名输入框盖的是同一块地方。名字**必须** `pointer-events: none`：
   * 它占着片段顶部那条带子（行高只有 20 多像素，这条带子几乎就是整个片段），
   * 吃掉事件等于把「双击片段 = 打开编辑器」这条主手势改掉
   * （实测：typography 那一批按双击开编辑器的 spec 全红）。
   */
  .label,
  .rename {
    position: absolute;
    left: 5px;
    top: 1px;
    right: 12px;
    height: 14px;
    font-size: var(--fs-xs);
    line-height: 14px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .label {
    pointer-events: none;
  }
  .rename {
    min-width: 24px;
    padding: 0 1px;
    /* 底色用片段自己的，免得输入框在三种片段色上各显各的 */
    background: color-mix(in srgb, currentColor 12%, transparent);
    border: 1px solid currentColor;
    border-radius: 2px;
    color: inherit;
    font-family: inherit;
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
  /* 影响深度角标：贴右下角（左上角是片段名，右上角是淡变标记），不抢片段名 */
  .fx-depth {
    position: absolute;
    right: 4px;
    bottom: 1px;
    font-size: var(--fs-xs);
    line-height: 10px;
    opacity: 0.75;
    pointer-events: none;
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
  /*
   * 淡变手柄：零尺寸 + 两条边框拼出的三角（视觉纪律：不用渐变 / 阴影 / 图标）。
   * 命中区域是 border-box（8×8），比缩放热区窄 2px —— 挪到片段底部，避开
   * 「想拖长度却拖到淡变」的主手势。
   */
  .fade-handle {
    position: absolute;
    bottom: 0;
    width: 0;
    height: 0;
    cursor: ew-resize;
    opacity: 0.55;
    z-index: calc(var(--z-edge) + 1);
  }
  .fade-handle:hover {
    opacity: 1;
  }
  .fade-handle.l {
    border-left: 8px solid currentColor;
    border-top: 8px solid transparent;
  }
  .fade-handle.r {
    border-right: 8px solid currentColor;
    border-top: 8px solid transparent;
  }
</style>

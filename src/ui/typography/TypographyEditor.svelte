<script lang="ts">
  /**
   * TypographyEditor — 排版片段的主编辑页（顶栏选项卡宿主内容）。
   *
   * 与时间轴主界面是**同格兄弟**：切页时主界面只是 display:none，绝不卸载
   * （卸载 Preview 的 canvas 会丢 WebGL 上下文，renderer 永久坏掉）。
   *
   * 舞台显示的是**实时 DOM**（buildDocDom 的产物），可以选中、框选、拖拽、
   * 缩放、旋转；右上角的「光栅预览」把舞台换成真实光栅结果 —— 它和光栅化
   * 走的是同一个 buildDocDom，两边本就该一致，这个开关是用来**验证**一致的。
   */
  import { onDestroy } from 'svelte';
  import IconButton from '../controls/IconButton.svelte';
  import Select from '../controls/Select.svelte';
  import Slider from '../controls/Slider.svelte';
  import Ribbon from '../ribbon/Ribbon.svelte';
  import { contextualTabIds } from '../ribbon/ribbon-model';
  import { appState } from '../app-state.svelte';
  import { editorState } from './editor-state.svelte';
  import { createTypographyActions } from './actions';
  import { buildTypographyTabs } from './ribbon-defs';
  import SelectionLayer from './SelectionLayer.svelte';
  import LayersPanel from './LayersPanel.svelte';
  import {
    startMoveGesture,
    startResizeGesture,
    startRotateGesture,
    type GestureEnv,
  } from './gestures';
  import { buildDocDom, docSignature, syncDocDom } from '../../typography/render-dom';
  import { animationSpecs, seekAnimations } from '../../typography/bake-animation';
  import { keyframeBodyOf } from '../../typography/animation';
  import CustomCssModal from './CustomCssModal.svelte';
  import { SNAP_PX, hitTest, rectsIntersect, type Guide, type HandleId, type Rect } from '../../typography/geometry';
  import { tr } from '../../i18n/index.svelte';

  const { clipId }: { clipId: string } = $props();

  const PAD = 24;
  /** actions 只是回调的集合，无内部状态；建一次就够。 */
  const actions = createTypographyActions();

  let paperEl = $state<HTMLElement | null>(null);
  let paperWrapEl = $state<HTMLElement | null>(null);
  let rasterHostEl = $state<HTMLElement | null>(null);
  let viewportEl = $state<HTMLElement | null>(null);
  let vpW = $state(0);
  let vpH = $state(0);
  let autoFit = $state(true);
  let marquee = $state<Rect | null>(null);
  let activeRibbonTab = $state('home');
  let customCssOpen = $state(false);

  /* ------------------------------------------------------------ 生命周期 */

  $effect(() => {
    editorState.open(clipId);
  });

  onDestroy(() => editorState.close());

  /* ------------------------------------------------------------ 派生 */

  const doc = $derived.by(() => {
    void appState.version;
    return editorState.doc;
  });

  const signature = $derived.by(() => {
    void appState.version;
    return docSignature(doc);
  });

  const docSize = $derived(doc?.size ?? { w: 1920, h: 1080 });

  const selection = $derived.by(() => {
    void appState.version;
    return editorState.selected;
  });

  /**
   * 选区框。
   *
   * **单选时用元素自己的框（含 rot）**，不是未旋转的 AABB —— 单个元素绕自身
   * 中心旋转时 x/y/w/h 一点没变（只有 rot 变），用 AABB 的话框会纹丝不动，
   * 看着像「只有图形在转，框没跟上」。
   * 多选时用整个选区的 AABB（那一堆角度没有统一的说法）。
   */
  const selectionBox = $derived.by(() => {
    void appState.version;
    const sel = editorState.selected;
    if (sel.length === 1) {
      const f = sel[0]!.frame;
      return { x: f.x, y: f.y, w: f.w, h: f.h, rot: f.rot };
    }
    const r = editorState.selectionRect;
    return r ? { x: r.x, y: r.y, w: r.w, h: r.h, rot: 0 } : null;
  });

  /**
   * 每个选中元素的框 —— **返回新对象**，且带上 rot。
   *
   * 不能直接在模板里读 `el.frame.x`：元素是原地改的，Svelte 5 的模板 effect
   * 靠 `===` 判断传播，对象引用没变就静默不更新。见 AGENTS §7。
   */
  const selectionRects = $derived.by(() => {
    void appState.version;
    return editorState.selected.map((e) => ({
      id: e.id,
      x: e.frame.x,
      y: e.frame.y,
      w: e.frame.w,
      h: e.frame.h,
      rot: e.frame.rot,
    }));
  });

  /** 弧度 → CSS `rotate()`。与 css.ts 的 elementStyle 用同一套角度约定。 */  function rotCss(rad: number): string | undefined {
    return rad ? `rotate(${(rad * 180) / Math.PI}deg)` : undefined;
  }

  const contextualActive = $derived(contextualTabIds(selection));

  /** 选中元素挂着的唯一预设动画（决定动画图库里哪一项高亮）。 */
  const activePreset = $derived.by(() => {
    void appState.version;
    const anims = selection.flatMap((e) => e.animations);
    if (anims.length !== 1) return null;
    const only = anims[0]!;
    return only.kind === 'preset' ? only.preset : null;
  });

  const tabs = $derived.by(() => {
    void appState.version;
    void appState.typoAlignTarget;
    const d = doc;
    if (!d) return [];
    return buildTypographyTabs(
      {
        doc: d,
        selection,
        alignTarget: appState.typoAlignTarget,
        fontFamilies: appState.fontFamilies,
        activePreset,
        anim: selection.flatMap((e) => e.animations)[0] ?? null,
        onOpenCustomCss: () => (customCssOpen = true),
        onFlatten: () => actions.flattenToImage(appState.playT - (editorState.clip?.start ?? 0)),
      },
      actions,
    );
  });

  /** 「自定义 CSS」弹窗的初始内容：当前动画的 keyframes 体。 */
  const currentKeyframes = $derived.by(() => {
    void appState.version;
    const first = selection.flatMap((e) => e.animations)[0];
    return first ? keyframeBodyOf(first) : '';
  });

  /** 片段内本地时间 —— 舞台上的 CSS 动画就是被它 seek 的（唯一时钟仍是 t）。 */
  const localSec = $derived.by(() => {
    const clip = editorState.clip;
    void appState.playT;
    return clip ? appState.playT - clip.start : 0;
  });

  /**
   * 时间量化到整帧，供光栅预览当依赖用。
   * 直接用 localSec 会让播放时每帧重烘一张全尺寸位图（每帧几十毫秒）。
   */
  const rasterFrame = $derived.by(() => {
    void appState.playT;
    const clip = editorState.clip;
    if (!clip) return 0;
    return Math.round((appState.playT - clip.start) * appState.store.project.fps);
  });

  const zoom = $derived(editorState.zoom);

  const missingFonts = $derived.by(() => {
    void appState.version;
    const d = doc;
    return d ? appState.fonts.missing(d) : [];
  });

  /* ------------------------------------------------------------ 舞台 DOM */

  // 结构变了才重建：纯几何改动走 syncDocDom。重建会丢掉正在编辑的
  // contenteditable 的选区，用户打到一半光标就飞了。
  $effect(() => {
    const sig = signature;
    const d = doc;
    if (!paperEl || !d || !sig) return;
    paperEl.replaceChildren(buildDocDom(d));
  });

  // 版本或播放头变了就就地刷新样式，并把动画 seek 到当前时刻。
  $effect(() => {
    void appState.version;
    const ls = localSec;
    const d = doc;
    const root = paperEl;
    if (!d || !root) return;
    // 注意传的是 `.paper` 这个**外层容器**：syncDocDom 自己会往下找文档根。
    syncDocDom(root, d, { editingId: editorState.editingTextId });
    seekAnimations(root, animationSpecs(d), ls);
  });

  /**
   * 进入编辑态后把焦点给文本框。
   *
   * **刻意不在这里全选。** 原来会 `selectNodeContents` 把所有文字选中，于是
   * 双击进来就是「整段高亮」状态：用户接着单击想挪光标，那一下只是把已有的
   * 选区收拢，看起来像「又选中了整个文本框」，再打字就整段替换。Office 的
   * 行为是双击只把光标放到点击处 —— 光标位置由 `onStageDblClick` 按点击点放。
   *
   * `document.activeElement !== node` 这个判断不能省：效果每次重跑都 focus 的话，
   * 用户打字打到一半就会被重排光标。
   */
  $effect(() => {
    const id = editorState.editingTextId;
    if (!id) return;
    const node = paperEl?.querySelector<HTMLElement>(`[data-el-id="${id}"] .typo-text`);
    if (!node || document.activeElement === node) return;
    node.focus();
  });

  /**
   * 把光标放到屏幕坐标处。
   *
   * `caretRangeFromPoint` 是 Chromium/WebKit 的扩展，Firefox 走
   * `caretPositionFromPoint`。两个都拿不到（或落点不在这个文本框里）时
   * **什么都不做**，由浏览器自己的单击结果说了算 —— 不强行塞一个「文末光标」，
   * 那会在用户明明点在中间时把光标扔到末尾。
   */
  function placeCaretAt(node: HTMLElement, clientX: number, clientY: number): void {
    const sel = window.getSelection();
    if (!sel) return;
    const d = document as Document & {
      caretRangeFromPoint?: (x: number, y: number) => Range | null;
      caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
    };
    let range = d.caretRangeFromPoint?.(clientX, clientY) ?? null;
    if (!range && d.caretPositionFromPoint) {
      const pos = d.caretPositionFromPoint(clientX, clientY);
      if (pos) {
        range = document.createRange();
        range.setStart(pos.offsetNode, pos.offset);
        range.collapse(true);
      }
    }
    if (!range || !node.contains(range.startContainer)) return;
    sel.removeAllRanges();
    sel.addRange(range);
  }

  // 光栅预览：只在「文档内容变了 / 帧号变了 / 停止播放」时重烘。
  // 播放中不重烘 —— 它是用来核对「所见即所得」的，不是播放器。
  $effect(() => {
    void signature;
    void appState.version;
    void rasterFrame;
    const playing = appState.playing;
    const d = doc;
    const runtime = appState.textRaster;
    const host = rasterHostEl;
    if (!editorState.rasterPreview || !d || !runtime || !host || playing) {
      if (host) host.replaceChildren();
      return;
    }
    let cancelled = false;
    const ls = localSec;
    void runtime
      .rasterizeOnce(d, d.size.w, d.size.h, ls)
      .then((canvas) => {
        if (!cancelled) host.replaceChildren(canvas);
      })
      .catch(() => {
        if (!cancelled) host.replaceChildren();
      });
    return () => {
      cancelled = true;
    };
  });

  /* ------------------------------------------------------------ 视口尺寸 */

  $effect(() => {
    const el = viewportEl;
    if (!el) return;
    const measure = (): void => {
      vpW = el.clientWidth;
      vpH = el.clientHeight;
    };
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    measure();
    return () => ro.disconnect();
  });

  // 自动适配：留 48px 边距，放大不超过 1:1（放大了只是更模糊）。
  $effect(() => {
    if (!autoFit || !vpW || !vpH) return;
    const z = Math.min((vpW - 48) / docSize.w, (vpH - 48) / docSize.h, 1);
    if (z > 0) editorState.setZoom(z);
  });

  function zoomBy(f: number): void {
    autoFit = false;
    editorState.setZoom(editorState.zoom * f);
  }

  function zoomFit(): void {
    autoFit = true;
    const z = Math.min((vpW - 48) / docSize.w, (vpH - 48) / docSize.h, 1);
    if (z > 0) editorState.setZoom(z);
  }

  /** 缩放百分比（滑杆与读数共用同一个取整口径）。 */
  const zoomPct = $derived(Math.round(zoom * 100));

  function setZoomPct(pct: number): void {
    autoFit = false;
    editorState.setZoom(pct / 100);
  }

  /* ------------------------------------------------------------ 手势环境 */

  function toDoc(e: { clientX: number; clientY: number }): { x: number; y: number } {
    const wrap = paperWrapEl;
    if (!wrap) return { x: 0, y: 0 };
    // 用 paper-wrap 的实际矩形而不是「视口原点 + 固定边距」：paper-wrap 是
    // 水平居中的，内容比视口窄时左边距远大于 PAD，按固定值算会整体偏移。
    const r = wrap.getBoundingClientRect();
    return { x: (e.clientX - r.left) / zoom, y: (e.clientY - r.top) / zoom };
  }

  function makeEnv(): GestureEnv {
    return {
      toDoc,
      docSize,
      setGuides: (g: Guide[]) => (editorState.guides = g),
      snapThreshold: SNAP_PX,
    };
  }

  function hitAt(e: { clientX: number; clientY: number }) {
    const p = toDoc(e);
    return hitTest(editorState.selectableRects, p.x, p.y);
  }

  /** 空白处的 pointerdown：命中就起手势，落空就框选。 */
  function onStageDown(e: PointerEvent): void {
    if (e.button !== 0) return;
    if (!doc) return;
    const hit = hitAt(e);

    // 正在编辑这个元素时，指针事件归浏览器的文本选择 —— 否则一按就把
    // 光标位置抢走，变成拖拽。
    if (editorState.editingTextId && hit?.id === editorState.editingTextId) return;

    if (!hit) {
      if (!e.shiftKey) editorState.clearSelection();
      startMarquee(e, toDoc(e));
      return;
    }
    if (e.shiftKey) editorState.toggle(hit.id);
    else if (!editorState.isSelected(hit.id)) editorState.selectOnly(hit.id);

    if (editorState.selectedIds.length) startMoveGesture(makeEnv(), toDoc(e));
  }

  /**
   * 双击文本元素 → 进入编辑，并把光标放到双击的那一点。
   *
   * 双击的第一下会先起一次拖拽手势，但那次没有位移，松手时走 `cancelGesture`
   * （不留撤销记录），所以两者不冲突。
   */
  function onStageDblClick(e: MouseEvent): void {
    if (!doc) return;
    const hit = hitAt(e);
    if (!hit) return;
    const el = doc.elements.find((x) => x.id === hit.id);
    if (!el || el.kind !== 'text' || el.locked) return;
    e.preventDefault();
    editorState.selectOnly(el.id);
    editorState.beginEditing(el.id);
    // 等 DOM 真的进入编辑态（contenteditable 打开 + 上面那个 effect 里的 focus
    // 跑完）再放光标。rAF 保证排在 Svelte 的 effect 刷新之后。
    const { clientX, clientY } = e;
    requestAnimationFrame(() => {
      const node = paperEl?.querySelector<HTMLElement>(`[data-el-id="${el.id}"] .typo-text`);
      if (node) placeCaretAt(node, clientX, clientY);
    });
  }

  /**
   * 失焦即提交。
   *
   * 提交挂在 `focusout` 而不是每帧同步里，是因为编辑期间同步**不写**
   * textContent（写了就把用户刚打的字抹掉）。于是文档只在收尾时更新一次 ——
   * 这正好也是撤销栈想要的一笔。
   */
  function commitEditing(): void {
    const id = editorState.editingTextId;
    if (!id) return;
    const node = paperEl?.querySelector<HTMLElement>(`[data-el-id="${id}"] .typo-text`);
    const next = node?.textContent ?? '';
    // 直接赋值而不是 stopEditing()：那个会再 blur 一次，形成递归。
    editorState.editingTextId = null;
    const cur = doc?.elements.find((x) => x.id === id);
    if (!cur || cur.kind !== 'text' || cur.text === next) return;
    editorState.commit(tr('typo.undo.editText'), (d) => {
      const el = d.elements.find((x) => x.id === id);
      if (el && el.kind === 'text') el.text = next;
    });
  }

  /** 框选：拖出矩形，与外接框相交即选中。 */
  function startMarquee(e: PointerEvent, start: { x: number; y: number }): void {
    const base = new Set(e.shiftKey ? editorState.selectedIds : []);
    let moved = false;

    const onMove = (ev: PointerEvent): void => {
      const p = toDoc(ev);
      if (Math.abs(p.x - start.x) > 1 || Math.abs(p.y - start.y) > 1) moved = true;
      marquee = {
        id: 'marquee',
        x: Math.min(start.x, p.x),
        y: Math.min(start.y, p.y),
        w: Math.abs(p.x - start.x),
        h: Math.abs(p.y - start.y),
      };
    };

    const onUp = (): void => {
      const box = marquee;
      marquee = null;
      // 空白区单击 = 清空选择，不做框选。
      if (!moved || !box) return;
      const ids = editorState.selectableRects.filter((r) => rectsIntersect(box, r)).map((r) => r.id);
      editorState.setSelection([...base, ...ids]);
    };

    attachWindow(onMove, onUp);
  }

  /** 指针监听挂 window（与 gestures.ts 同一套约定）。 */
  function attachWindow(onMove: (e: PointerEvent) => void, onUp: () => void): void {
    const up = (): void => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', up);
      onUp();
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', up, { once: true });
  }
</script>

<div class="editor" data-testid="typo-editor">
  <!--
    Ribbon 与「缺字体」横幅包在**同一个网格行**里。
    分开的话 banner 是条件渲染，缺字体时网格会多出一行、不缺时少一行，
    于是 .main 与 .zoombar 各自落到不同的轨道上 —— 表现见下面 .editor 的注释。
  -->
  <div class="top">
    <Ribbon {tabs} activeId={activeRibbonTab} {contextualActive} onchange={(id) => (activeRibbonTab = id)} />

    {#if missingFonts.length}
      <div class="banner" data-testid="typo-font-missing">
        {tr('typo.missingFonts', { fonts: missingFonts.join(tr('typo.fontListSeparator')) })}
      </div>
    {/if}
  </div>

  <div class="main">
    <!-- role="presentation" 与 Timeline 的 .rows 一致：这是指针手势面，不是语义容器。 -->
    <div
      class="viewport"
      role="presentation"
      bind:this={viewportEl}
      onpointerdown={onStageDown}
      ondblclick={onStageDblClick}
      data-testid="typo-stage"
    >
      <div
        class="paper-wrap"
        bind:this={paperWrapEl}
        style:width={`${docSize.w * zoom}px`}
        style:height={`${docSize.h * zoom}px`}
        style:margin={`${PAD}px auto`}
      >
        <div
          class="raster-host"
          bind:this={rasterHostEl}
          style:width={`${docSize.w * zoom}px`}
          style:height={`${docSize.h * zoom}px`}
        ></div>
        <div
          class="paper"
          bind:this={paperEl}
          style:transform={`scale(${zoom})`}
          onfocusout={commitEditing}
        ></div>

        <div class="overlay">
          <!--
            用 selectionRects（每项是**新对象**）而不是 selection（元素本身原地改）。
            Svelte 5 的模板 effect 靠 `===` 判断传播，直接读 `el.frame.x` 会因为
            对象引用没变而**静默不更新** —— 这是本项目的常客，见 AGENTS §7。
          -->
          {#each selectionRects as r (r.id)}
            <i
              class="typo-sel"
              style:left={`${r.x * zoom}px`}
              style:top={`${r.y * zoom}px`}
              style:width={`${r.w * zoom}px`}
              style:height={`${r.h * zoom}px`}
              style:transform={rotCss(r.rot)}
              data-testid="typo-sel"
            ></i>
          {/each}

          {#if selection.length > 1 && selectionBox}
            <i
              class="typo-sel typo-sel-bounds"
              style:left={`${selectionBox.x * zoom}px`}
              style:top={`${selectionBox.y * zoom}px`}
              style:width={`${selectionBox.w * zoom}px`}
              style:height={`${selectionBox.h * zoom}px`}
            ></i>
          {/if}

          {#each editorState.guides as g, i (i)}
            {#if g.axis === 'v'}
              <i class="guide v" style:left={`${g.pos * zoom}px`}></i>
            {:else}
              <i class="guide h" style:top={`${g.pos * zoom}px`}></i>
            {/if}
          {/each}

          {#if marquee}
            <i
              class="marquee"
              style:left={`${marquee.x * zoom}px`}
              style:top={`${marquee.y * zoom}px`}
              style:width={`${marquee.w * zoom}px`}
              style:height={`${marquee.h * zoom}px`}
            ></i>
          {/if}
        </div>

        <!--
          选择层必须挂在 .paper-wrap 里面：它的把手坐标是**按文档原点**算的，
          挂到 viewport 上就会以 viewport 的左上角为基准，而 paper 是水平居中
          且带 PAD 边距的 —— 结果是选择框整体偏移、把手完全点不中。
        -->
        <SelectionLayer
          rect={selectionBox}
          {zoom}
          editing={!!editorState.editingTextId &&
            selection.length === 1 &&
            selection[0]!.id === editorState.editingTextId}
          onMove={(e) => startMoveGesture(makeEnv(), toDoc(e))}
          onHandle={(h: HandleId, e: PointerEvent) => startResizeGesture(makeEnv(), h, toDoc(e))}
          onRotate={(e) => startRotateGesture(makeEnv(), toDoc(e))}
        />
      </div>
    </div>

    <LayersPanel />
  </div>

  <div class="zoombar">
    <IconButton icon="minus" label={tr('typo.zoomOut')} testid="typo-zoom-out" onclick={() => zoomBy(1 / 1.25)} />
    <span class="zoom-slider">
      <Slider
        min={5}
        max={400}
        step={1}
        value={zoomPct}
        ariaLabel={tr('typo.zoom')}
        tipText={tr('typo.zoom')}
        testid="typo-zoom-slider"
        oninput={setZoomPct}
      />
    </span>
    <span class="zoom-val">{zoomPct}%</span>
    <IconButton icon="plus" label={tr('typo.zoomIn')} testid="typo-zoom-in" onclick={() => zoomBy(1.25)} />
    <IconButton icon="minimize-2" label={tr('typo.zoomFit')} testid="typo-zoom-fit" onclick={zoomFit} />
    <!-- 画面尺寸：排版里所有坐标都是文档像素，不显示的话没法判断「这段文字有多大」。 -->
    <span class="canvas-size mono" data-testid="typo-canvas-size" title={tr('typo.canvasSize')}>
      {docSize.w} × {docSize.h}
    </span>
    <span class="spacer"></span>
    <!-- 固定宽度：.sel 带 flex:1，直接放进 flex 行会被拉成整行宽。 -->
    <span class="scale-pick">
      <Select
        value={String(appState.typoPreviewScale)}
        options={[
          { value: '1', label: tr('typo.previewScale', { scale: '1.0x' }) },
          { value: '0.5', label: tr('typo.previewScale', { scale: '0.5x' }) },
          { value: '0.25', label: tr('typo.previewScale', { scale: '0.25x' }) },
        ]}
        testid="typo-preview-scale"
        onchange={(v) => (appState.typoPreviewScale = Number(v))}
      />
    </span>
    <IconButton
      icon="panel-right"
      label={tr('typo.rasterPreview')}
      testid="typo-raster-toggle"
      active={editorState.rasterPreview}
      onclick={() => (editorState.rasterPreview = !editorState.rasterPreview)}
    />
  </div>
</div>

{#if customCssOpen}
  <CustomCssModal
    initialOf={() => currentKeyframes}
    onclose={() => (customCssOpen = false)}
    onsave={(css: string) => actions.applyCustomCss(css)}
  />
{/if}

<style>
  .editor {
    display: grid;
    /*
     * 三行：Ribbon 区 / 舞台（吃满）/ zoombar。
     *
     * ⚠️ 这里曾经是 `auto auto minmax(0,1fr) auto` —— 四行，但只有三个子项
     * （「缺字体」横幅是条件渲染的）。不缺字体时 .main 落到第 2 行的 `auto`、
     * .zoombar 落到第 3 行的 `minmax(0,1fr)`，于是：
     *   · zoombar 被拉成 `1fr` 的高度（默认情况下就偏高，窗口一变化更明显）；
     *   · 舞台那一行是 `auto`，会随画布尺寸无限长高，把 zoombar 挤出屏幕。
     * 现在 Ribbon 与横幅合成一个 `.top` 子项，行数与子项数一一对应。
     */
    grid-template-rows: auto minmax(0, 1fr) auto;
    grid-template-columns: minmax(0, 1fr);
    min-height: 0;
    min-width: 0;
    background: var(--surface-0);
  }
  .top {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }
  .main {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 180px;
    min-height: 0;
    min-width: 0;
  }
  .banner {
    padding: 4px var(--sp-4);
    font-size: var(--fs-xs);
    color: var(--warning);
    background: var(--surface-2);
    border-bottom: 1px solid var(--border);
  }

  .viewport {
    position: relative;
    overflow: auto;
    min-height: 0;
    min-width: 0;
    /* 棋盘格底：让「文档本身是透明的」这件事看得见（排版层要叠到画面上）。 */
    background: repeating-conic-gradient(var(--surface-2) 0% 25%, var(--surface-1) 0% 50%) 50% / 16px 16px;
    touch-action: none;
  }
  .paper-wrap {
    position: relative;
  }
  .paper,
  .raster-host {
    position: absolute;
    left: 0;
    top: 0;
    transform-origin: 0 0;
  }
  .raster-host {
    pointer-events: none;
  }
  .overlay {
    position: absolute;
    left: 0;
    top: 0;
    right: 0;
    bottom: 0;
    pointer-events: none;
  }
  /* 多选时每项一个细框，外接框用虚线区分「这是整体」。 */
  .typo-sel {
    position: absolute;
    outline: 1px solid var(--accent);
    outline-offset: -1px;
  }
  .typo-sel-bounds {
    outline: 1px dashed var(--accent);
  }
  /* 参考线用主题色 1px 实线 —— 「主题色只出现在选中/激活态」的一处。 */
  .guide {
    position: absolute;
    background: var(--accent);
  }
  .guide.v {
    top: 0;
    bottom: 0;
    width: 1px;
  }
  .guide.h {
    left: 0;
    right: 0;
    height: 1px;
  }
  .marquee {
    position: absolute;
    border: 1px solid var(--accent);
    background: var(--accent-weak);
  }

  .zoombar {
    display: flex;
    align-items: center;
    gap: var(--sp-1);
    /* 固定高度：它是布局的常数，不该随内容或窗口宽度变。 */
    height: 26px;
    flex-shrink: 0;
    padding: 0 var(--sp-4);
    background: var(--surface-1);
    border-top: 1px solid var(--border);
  }
  /* .sld 自带 flex:1，放进 flex 行会被拉成整行宽 —— 定宽框住它。 */
  .zoom-slider {
    display: inline-flex;
    flex: none;
    width: 120px;
  }
  .zoom-val {
    min-width: 42px;
    text-align: center;
    font-size: var(--fs-xs);
    color: var(--text-secondary);
  }
  .canvas-size {
    margin-left: var(--sp-2);
    color: var(--text-muted);
    font-size: var(--fs-xs);
    white-space: nowrap;
  }
  .spacer {
    margin-left: auto;
  }
  /* .sel 自带 flex:1，放进 flex 行会被拉成整行宽（实测占满 90% 屏幕）——
     包一层定宽容器把它框住。 */
  .scale-pick {
    display: inline-flex;
    flex: none;
    width: 132px;
  }
</style>

<script lang="ts">
  import Icon from '../ui/Icon.svelte';
  import IconButton from '../ui/controls/IconButton.svelte';
  import Menu from '../ui/controls/Menu.svelte';
  import { separator, submenu, type MenuItem } from '../ui/controls/menu-model';
  import { algoThumbUrl } from '../ui/algo-thumb-assets';
  import { ALGO_CATALOG } from '../algos/catalog';
  import ClipView from './ClipView.svelte';
  import { startMarquee, type MarqueeBox } from './marquee';
  import { drawGrid, drawRuler, type DrawRange, type GridTrackRow } from './grid-draw';
  import { xOfTime, timeAtX, RULER_HEIGHT, ROW_HEIGHT } from './view-model';
  import { browserPlatform } from '../platform/browser';
  import {
    newId,
    type AudioClip,
    type EffectClip,
    type SourceClip,
    type Track,
  } from '../core/schema';
  import { beatDur, snapTime } from '../core/time';
  import { resolveTransition } from '../core/transitions';
  import { importAudioBlob, importFiles, importImageBlob, importVideoFile } from '../ui/media-import';
  import { ASSET_DRAG_MIME, insertAssetClip, poolItemById } from '../ui/media-pool';
  import { defaultParams, getGenerator, listGenerators } from '../algos/registry';
  import { createTextElement, createTypographyDocument } from '../typography/document';
  import { canvasPalette } from '../ui/tokens';
  import { reorder } from '../ui/drag-reorder';
  import { theme } from '../ui/theme.svelte';
  import { appState } from '../ui/app-state.svelte';
  import { registryRevision } from '../ui/registry-revision.svelte';
  import { statusHint } from '../ui/status-hint.svelte';
  import type { HintTarget } from '../ui/hints';
  import { tr } from '../i18n/index.svelte';
  import { resolveLabel } from '../i18n/label';

  /*
   * 生成器菜单的清单要跟着**运行期注册表**走：插件挂载后，右键菜单必须立刻
   * 多出新的生成器。`registryRevision()` 只为了建立这个依赖 —— 没有它，
   * 这是一次普通的模块级调用，算一次就冻住了（表现是「装了插件但菜单里没有」）。
   */
  const generators = $derived.by(() => {
    registryRevision();
    return listGenerators();
  });

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
  let rowsEl: HTMLDivElement;
  /** 轨道头列的滚动容器（竖直滚动与画布双向同步，见 `syncVertical`）。 */
  let sideEl: HTMLDivElement;

  /**
   * 轨道头列与画布**竖直**滚动合一。
   *
   * 为什么不是「把两者塞进同一个滚动容器」：两侧的横向滚动语义完全不同
   * （画布要能横向滚几千像素，轨道头列一点都不能动），合并会把 sticky 表头、
   * 横向滚动与 `.rows` 的坐标原点（拖拽/框选/标尺都按 `scrollEl.scrollLeft` 换算）
   * 一起搅进来。而竖直方向**本来就是 1:1 的**：两侧顶部各有一个同高的表头
   * （`.side-head` / 粘住的 `.ruler`，都是 `RULER_HEIGHT`），行高也一样，
   * 而且两侧滚动内容等高（见 `.side-add` 的注释）。所以互写 `scrollTop` 就够。
   *
   * 回环守卫是**值比较**，不是布尔量：写对方会再派发一次 scroll 事件，而 scroll
   * 事件是异步派发的 —— 赋值后立刻复位的布尔量根本来不及挡。等那次事件到达时，
   * 两边的值已经相等，`to.scrollTop === from.scrollTop` 直接返回。
   * 值比较还顺带解决了「滚到底时两侧 max 不同」：多出来的那几像素会被下一次事件
   * 拉回低位那一侧，而不是两边各停在自己的极限上。
   */
  function syncVertical(from: HTMLElement | undefined, to: HTMLElement | undefined): void {
    if (!from || !to) return;
    if (to.scrollTop === from.scrollTop) return;
    to.scrollTop = from.scrollTop;
  }

  /**
   * 框选进行中的矩形（**内容坐标**，相对 .rows 左上角）。null = 没在框选。
   *
   * 它只是那个框的几何：选中集本身在 appState 里（见 marquee.ts 的注释）。
   * 选中态刻意不进渲染循环的依赖（见下面 `$effect` 的「选中态不在其中」）。
   */
  let marqueeBox = $state<MarqueeBox | null>(null);

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

  /**
   * 每条视觉轨上**能生效**的出画转场窗口（按 trackId 分组）。
   *
   * 只在时间轴上画出来是不够的：「窗口以剪切点为中心、两侧各让 d/2」这件事
   * 必须让人**看见**，否则「转场为什么吃掉了隔壁半秒」永远是个谜。
   * 窗口由 `core/transitions.ts` 算（与渲染同一份钳制），这里只做像素换算。
   */
  const transitionMarks = $derived.by(() => {
    void appState.version;
    const map = new Map<string, { id: string; clipId: string; left: number; width: number; title: string }[]>();
    const px = appState.pxPerBeat;
    const g = appState.store.project.beatGrid;
    for (const track of appState.store.project.tracks) {
      if (track.kind !== 'visual') continue;
      const marks: { id: string; clipId: string; left: number; width: number; title: string }[] = [];
      for (let i = 0; i < track.clips.length; i += 1) {
        const clip = track.clips[i]!;
        if (clip.kind !== 'source' || !clip.transitionOut) continue;
        const r = resolveTransition(track, i);
        if (!r) continue;
        const start = r.from.end - r.duration / 2;
        const end = r.from.end + r.duration / 2;
        marks.push({
          id: clip.id,
          clipId: clip.id,
          left: xOfTime(start, px, g),
          width: Math.max(6, xOfTime(end, px, g) - xOfTime(start, px, g)),
          title: `${clip.transitionOut.defId} · ${r.duration.toFixed(2)}s`,
        });
      }
      if (marks.length) map.set(track.id, marks);
    }
    return map;
  });

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

  /**
   * 已绘制区间（**内容坐标** CSS px）。null = 整块位图都不可信。
   *
   * 每次重绘只覆盖可见那一段 —— 波形按像素走，整幅重绘的成本随工程时长超线性
   * 增长（实测 315s 音频：17650px 的波形路径光栅化要 1096ms，摘掉波形只有 8.4ms）。
   * 所以「已画到哪」必须记账：滚动时只补新露出来的那一条，其余保留位图里的旧像素
   * （由浏览器合成器滚动，本来就是免费的）。
   */
  let painted: { from: number; to: number } | null = null;

  /**
   * 位图覆盖的窗口（**内容坐标**）。画布只占 `[winFrom, winFrom + winW)` 这一段，
   * 不是整幅工程宽。
   *
   * 为什么必须这样做：整幅宽时内存 = 工程时长 × 缩放 × 轨道数 × dpr²，**无上界**。
   * 实测 950s@28px/beat 是 64MB，950s@96px/beat 是 219MB，3000s@96px/beat 是 692MB；
   * 再往上会撞浏览器的 canvas 面积上限（实测 2^28 像素），而**超限时
   * `canvas.width = …` 是静默失败的** —— 留下「位图宽 ≠ style.width」的错位，
   * 整幅画面被压扁，控制台一句话都没有。
   *
   * 改成窗口后是常数：3 个视口宽 ≈ 4MB（dpr 1.5 / 5 轨），与时长和缩放都无关。
   * 窗口靠 `left` / `margin-left` 跟着滚动挪位置 —— 元素本身仍在滚动容器里正常
   * 排布，所以合成器滚动时它和片段 DOM 一起动，不会错位。
   */
  let winFrom = 0;
  let winW = 0;

  /** 当前可见区间（内容坐标）。 */
  function viewRange(): DrawRange {
    const el = scrollEl;
    if (!el) return { x0: 0, x1: 0 };
    return { x0: el.scrollLeft, x1: el.scrollLeft + el.clientWidth };
  }

  /**
   * 窗口宽度：3 个视口宽（上限是工程宽）。
   * 取 3 而不是 1，是为了让窗口有 2 个视口的滑动余量 —— 少挪窗口 = 少一次整窗重画。
   */
  function windowWidth(viewW: number): number {
    return Math.min(drawWidth, Math.max(viewW * 3, viewW));
  }

  /**
   * 这次要补画的区间；返回 null 表示可见区已被覆盖，不用动。
   *
   * `painted` 恒为一段连续区间，所以「没覆盖」的情形只有两种：完全不相交
   * （跳转），或者只缺左边 / 只缺右边一条。
   */
  function gapFor(view: DrawRange): DrawRange | null {
    if (!painted || view.x1 <= painted.from || view.x0 >= painted.to) return view;
    if (view.x0 < painted.from) return { x0: view.x0, x1: Math.min(view.x1, painted.from) };
    if (view.x1 > painted.to) return { x0: Math.max(view.x0, painted.to), x1: view.x1 };
    return null;
  }

  /**
   * 重绘。
   *
   * @param invalidate 内容变了（version / 缩放 / 波形 / 主题 / 工程宽）→ 整块位图
   *   都不可信；否则只是滚动，补画缺的那一条即可。
   */
  function paint(invalidate: boolean): void {
    if (invalidate) painted = null;
    if (!rulerCanvas || !gridCanvas) return;
    const el = scrollEl;
    if (!el) return;
    const viewW = el.clientWidth;
    if (viewW <= 0) return;
    const view = viewRange();

    // ① 窗口几何：宽度变了、或者可见区跑到窗口外面去了 → 重新定位 + 整窗重画
    const want = windowWidth(viewW);
    if (want !== winW) {
      winW = want;
      invalidate = true;
    }
    if (invalidate || view.x0 < winFrom || view.x1 > winFrom + winW) {
      // 尽量让可见区居中，两端钳到工程范围内
      const maxFrom = Math.max(0, drawWidth - winW);
      winFrom = Math.min(maxFrom, Math.max(0, view.x0 - Math.round((winW - (view.x1 - view.x0)) / 2)));
      invalidate = true;
    }
    if (invalidate) painted = null;

    // 元素位置必须在画之前落定：画布就摆在那，绘制原点才不会和它对不上
    if (rulerCanvas.style.marginLeft !== `${winFrom}px`) {
      rulerCanvas.style.marginLeft = `${winFrom}px`;
    }
    if (gridCanvas.style.left !== `${winFrom}px`) {
      gridCanvas.style.left = `${winFrom}px`;
    }

    const gap = gapFor(view);
    if (!gap) return;
    const pal = palette;
    const project = appState.store.project;
    const ppb = appState.pxPerBeat;
    const r1 = drawRuler(rulerCanvas, project, ppb, dpr, pal, winW, winFrom, gap);
    const r2 = drawGrid(
      gridCanvas,
      project,
      ppb,
      gridRows(),
      appState.waveforms,
      dpr,
      pal,
      winW,
      winFrom,
      gap,
    );
    // 画布被重建过 → 位图已经清空，之前画的统统不算，只认这次画到的
    painted =
      r1 || r2 || !painted
        ? { from: gap.x0, to: gap.x1 }
        : { from: Math.min(painted.from, gap.x0), to: Math.max(painted.to, gap.x1) };
  }

  // 重绘订阅源：version / 缩放 / 吸附 / 波形 / 主题 / 视口宽。选中态刻意不在其中
  // （splitter 的教训：select 触发全量重建会在拖拽中换掉 DOM）。
  $effect(() => {
    void appState.version;
    void appState.pxPerBeat;
    void appState.snap;
    void appState.waveforms;
    /* activeProjectId 必须进依赖：切工程时 `subscribeActive` 只是把 version
       换成新工程的计数，**两份工程的 version 撞号时这次赋值不产生变化**，
       effect 就不会跑 —— 画布会停在上一份工程的内容上，而 `painted` 还声称
       自己是新鲜的。切换工程是「内容整体换掉」，必须无条件重画。 */
    void appState.activeProjectId;
    void palette;
    // 绘制本身直接读 store.project（不是响应式的），所以拍网格与工程宽这两个
    // 决定画布几何的派生量必须在这里显式订阅，否则改了 BPM 网格不重画。
    void grid;
    void drawWidth;
    paint(true);
  });

  /** 跟踪滚动视口宽度，供 drawWidth 使用。 */
  $effect(() => {
    const el = scrollEl;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      if (el.clientWidth !== scrollW) scrollW = el.clientWidth;
      // 视口变宽会让右侧露出没画过的区域（drawWidth 未必跟着变，所以不能只靠上面的 effect）
      paint(false);
    });
    ro.observe(el);
    scrollW = el.clientWidth;
    paint(false);
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
      label: resolveLabel(def.nameKey, tr),
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
    // 新文档继承**工程级**配色方案（「应用到整个项目」设的那个）。没设过就不写这个键
    // —— 显式写 undefined 会在文档上留一个幽灵属性（JSON 往返会把它丢掉，
    // 于是「存过没存过」在比较里表现不一致）。
    const projectTheme = appState.project.typographyTheme;
    if (projectTheme) doc.theme = projectTheme;
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

  /**
   * 导入音频。
   *
   * 三条导入（视频 / 图片 / 音频）都只是**选文件**这一步不同，剩下的
   * （进仓 → 登记 → 建片段 → 选中）全在 `ui/media-import.ts` —— 拖拽走的是
   * 同一个函数。这里各留一个短壳，是因为菜单里的选项本来就叫「导入音频…」。
   */
  async function addAudio(trackId: string, at?: number): Promise<void> {
    closeMenus();
    const picked = await browserPlatform.pickAudioFile();
    if (!picked) return;
    await importAudioBlob(picked.name, picked.data, { trackId, start: startFor(at) });
  }

  /** 导入视频。细节见 `ui/media-import.ts::importVideoFile`（含「先给句柄」的理由）。 */
  async function addVideo(trackId: string, at?: number): Promise<void> {
    closeMenus();
    const picked = await browserPlatform.pickVideoFile();
    if (!picked) return;
    await importVideoFile(picked.file, { trackId, start: startFor(at) });
  }

  /** 导入图片（`fit: 'contain'`、长度 4 拍 —— 理由见 `ui/media-pool.ts::clipForAsset`）。 */
  async function addImage(trackId: string, at?: number): Promise<void> {
    closeMenus();
    const picked = await browserPlatform.pickImageFile();
    if (!picked) return;
    await importImageBlob(picked.name, picked.data, { trackId, start: startFor(at) });
  }

  /* ------------------------------------------------------------ 轨道操作 */

  function removeTrack(track: Track): void {
    closeMenus();
    // 这条轨上的片段若在选中集里，一并摘掉 —— 否则选中集里留着指向
    // 不存在片段（甚至指向别的工程的对象）的 id。
    const gone = new Set(track.clips.map((c) => c.id));
    appState.setClipSelection(appState.selectedClipIds.filter((id) => !gone.has(id)));
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
    return generators.map((g) => {
      const entry = ALGO_CATALOG[g.id];
      return {
        id: `${prefix}algo-${g.id}`,
        label: resolveLabel(g.nameKey, tr),
        testid: `${prefix}algo-${g.id}`,
        onselect: () => addAlgo(currentTrackId!, g.id, at),
        /*
         * 缩略图 + 一句话说明。名字（「李雅普诺夫分形」）不足以让人知道
         * 插进去会长什么样，而这个菜单有二十多项 —— 悬停预览是这里唯一
         * 能让人不逐个试的办法。
         *
         * 图缺失时 `thumb` 是 `undefined`，浮层就不出现（条目照常可点）：
         * 这是刻意的降级，没有缩略图不该让菜单少一项。
         */
        thumb: algoThumbUrl(g.id) ?? undefined,
        // 内置的说明在 ALGO_CATALOG；插件自带 desc；都没有就回落到名称。
        desc: entry ? tr(entry.descKey) : g.desc ? resolveLabel(g.desc, tr) : resolveLabel(g.nameKey, tr),
      };
    });
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
      {
        id: `${prefix}image`,
        label: tr('tl.importImageMenu'),
        icon: 'image',
        testid: prefix === 'ctx-' ? `${prefix}image` : 'import-image',
        onselect: () => void addImage(track.id, at),
      },
      {
        id: `${prefix}video`,
        label: tr('tl.importVideoMenu'),
        icon: 'video',
        testid: prefix === 'ctx-' ? `${prefix}video` : 'import-video',
        onselect: () => void addVideo(track.id, at),
      },
      // `submenu()` 不接 testid，但这一项需要能被测试点到（`add-algo`）。
      // 子项带 `add-algo-<id>`，父项没名字就没法定位到那个二级菜单。
      {
        ...submenu(`${prefix}algo`, tr('tl.addAlgo'), generatorItems(at, prefix), 'sigma'),
        testid: `${prefix}algo`,
      },
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
    // 拖动期间给模拟步进压预算：向前跳要真把中间每一步算完（迭代系统没有
    // 闭式解），不给预算就会在拖动时冰住几秒。松手后 appState 自己切追赶档。
    appState.beginScrub();
    seekTo(e);
    const mv = (ev: PointerEvent): void => seekTo(ev);
    const up = (): void => {
      appState.endScrub();
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

  /**
   * 空白处按下 = 点一下取消选择 / 拖出矩形框选，由 marquee.ts 用 4px 阈值区分。
   *
   * 片段与转场标记在各自的 pointerdown 里 stopPropagation，所以能冒泡到
   * 这里的本来就是真正的空白；判 `data-tl-row` 只是再确认一次。
   */
  function onRowsPointerDown(e: PointerEvent): void {
    if (e.button !== 0) return;
    if (!(e.target as HTMLElement).hasAttribute('data-tl-row')) return;
    const rows = rowsEl;
    if (!rows) return;
    startMarquee(e, {
      start: { x: e.clientX, y: e.clientY },
      selection: [...appState.selectedClipIds],
      /*
       * 局部坐标 = client 减 .rows 的 rect。**不读 scrollLeft** ——
       * 滚动已经反映在 rect 的位置里，再减一次会在滚动过的位置整体错位。
       */
      toLocal: (cx, cy) => {
        const r = rows.getBoundingClientRect();
        return { x: cx - r.left, y: cy - r.top };
      },
      onSelect: (ids) => appState.setClipSelection(ids),
      onBox: (b) => (marqueeBox = b),
    });
  }

  /* ------------------------------------------------------------ 底栏提示 */

  /**
   * 指针落在了哪一类目标上（底栏提示的悬停层）。
   *
   * **一个委托处理器**，不是每个元素各挂一份 —— 判定顺序本身就是优先级：
   * 片段（`data-clip-id`）压过它所在的行，行 / 标尺 / 轨道头由 `data-hint` 标记
   * （在模板上就近写着「这里是什么」，比在这里列一串选择器更难漂移）。
   *
   * 用 `pointerover`（会冒泡）而不是 `pointerenter`（不会）：在行内从一个元素滑到
   * 另一个（片段 ↔ 行背景 ↔ 转场标记）时，只有冒泡的那个能重新判定「现在指着谁」。
   * 底栏说明的是**上下文**，不是「上一次指针进到哪里」。
   */
  function hintTargetAt(target: EventTarget | null): HintTarget | null {
    if (!(target instanceof HTMLElement)) return null;
    const id = target.closest('[data-clip-id]')?.getAttribute('data-clip-id');
    if (id) return { kind: 'clip', id };
    const named = target.closest('[data-hint]')?.getAttribute('data-hint');
    return named === 'rows' || named === 'ruler' || named === 'track' ? { kind: named } : null;
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

  /* ------------------------------------------------------------ 拖进来 */

  /**
   * 拖拽落点提示：**指针所在的行 + 吸附后的落点**（画一条竖线）。
   * 只在拖进来的东西认得时才亮 —— 拖个网页链接过来不该在轨道上画线。
   */
  let dropHint = $state<{ trackId: string; x: number; top: number } | null>(null);

  /** 拖的是不是我们认的东西：媒体池的素材（自定义类型）还是系统文件。 */
  function droppedKind(dt: DataTransfer | null): 'asset' | 'files' | null {
    if (!dt) return null;
    if (dt.types.includes(ASSET_DRAG_MIME)) return 'asset';
    if (dt.types.includes('Files')) return 'files';
    return null;
  }

  /**
   * clientY → 行下标。拖到行区下面的空白处算**最后一行**（那里没有时刻可言，
   * 但「想放到最下面那条轨」的意图很清楚）。
   */
  function rowIndexAt(clientY: number): number {
    if (!rowsEl) return 0;
    const r = rowsEl.getBoundingClientRect();
    const i = Math.floor((clientY - r.top) / ROW_HEIGHT);
    return Math.min(Math.max(i, 0), Math.max(0, tracks.length - 1));
  }

  function onRowsDragOver(e: DragEvent): void {
    if (!droppedKind(e.dataTransfer)) return;
    /*
     * preventDefault 是**必须的**：不阻止默认行为，浏览器根本不允许在这里落点
     * （drop 事件不会发生，而 dragover 也不会被允许改 dropEffect）。
     */
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
    const i = rowIndexAt(e.clientY);
    const track = tracks[i];
    if (!track) return;
    dropHint = {
      trackId: track.id,
      x: xOfTime(timeAtClientX(e.clientX), appState.pxPerBeat, grid),
      top: i * ROW_HEIGHT,
    };
  }

  function onRowsDragLeave(e: DragEvent): void {
    // 只在**真的离开整块行区**时清：dragleave 会为每个子元素冒泡上来一次，
    // 按它清会让竖线在行内移动时闪。
    const to = e.relatedTarget as Node | null;
    if (to && rowsEl?.contains(to)) return;
    dropHint = null;
  }

  function onRowsDrop(e: DragEvent): void {
    const kind = droppedKind(e.dataTransfer);
    if (!kind) return;
    e.preventDefault();
    const track = tracks[rowIndexAt(e.clientY)];
    dropHint = null;
    if (!track) return;

    const start = timeAtClientX(e.clientX);
    if (kind === 'asset') {
      // 媒体池里拖出来的一条素材：与点「+」走**同一个函数**（落点规则只有一处）
      const id = e.dataTransfer?.getData(ASSET_DRAG_MIME) ?? '';
      const item = id ? poolItemById(appState.store.project.assets, appState.assets, id) : null;
      if (!item) return;
      const clipId = insertAssetClip(appState.store, item, {
        at: start,
        grid,
        preferredTrackId: track.id,
      });
      if (clipId) appState.selectedClipId = clipId;
      return;
    }

    // 系统文件：与菜单里的「导入…」同一条路（probe / 进仓 / 建片段都在那边）
    const files = Array.from(e.dataTransfer?.files ?? []);
    if (files.length) void importFiles(files, { start, trackId: track.id });
  }
</script>

<!--
  底栏提示的悬停判定挂在整个时间轴上（而不是每个片段 / 每行各挂一份）：
  见 `hintTargetAt` 的注释。
-->
<div
  class="tl"
  role="presentation"
  onpointerover={(e) => statusHint.setHover(hintTargetAt(e.target))}
  onpointerleave={() => statusHint.clearHover()}
>
  <!--
    轨道行可拖曳排序。挂在整个 .side 上而不是每行上：拖动时要把它**兄弟**
   的 transform 一起算，只有容器才拿得到全量。
    行菜单 / 重命名输入框都在行内，所以拖曳是「位移超过阈值才算」——
    4px 以内的移动仍然是一次正常的点击。
  -->
  <div class="side-wrap">
    <div
      class="side"
      bind:this={sideEl}
      onscroll={() => syncVertical(sideEl, scrollEl)}
      use:reorder={{
        axis: 'y',
        itemSelector: '[data-testid=track-side-row]',
        onReorder: (from, to) => appState.store.moveTrack(from, to),
      }}
    >
      <div class="side-head" style:height={`${RULER_HEIGHT}px`}>
        <span class="side-title">{tr('tl.sideTitle')}</span>
      </div>

      {#each tracks as track (track.id)}
        <div
          class="side-row"
          style:height={`${ROW_HEIGHT}px`}
          class:muted={!track.enabled}
          data-track-id={track.id}
          data-hint="track"
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
    </div>

    <!--
      加轨按钮是**固定页脚**，不参与竖直滚动。它同时钉住了一条不变量：
      两侧的滚**动内容**等高 —— 画布那列是 RULER_HEIGHT + N × ROW_HEIGHT，
      这里也正好是这么多。页脚若留在滚动区里，轨道头列就比画布多出一个行高，
      滚到底时两边会被各自的 max 钳到不同的位置（表现是「同步了但总差一截」）。
    -->
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

  <div
    class="scroll"
    data-testid="tl-scroll"
    bind:this={scrollEl}
    onwheel={wheel}
    onscroll={() => {
      syncVertical(scrollEl, sideEl);
      paint(false);
    }}
  >
    <div class="canvas-wrap" data-testid="tl-canvas-wrap" style:width={`${drawWidth}px`}>
      <canvas class="ruler" data-hint="ruler" bind:this={rulerCanvas} onpointerdown={scrub}></canvas>
      <div
        class="rows"
        data-hint="rows"
        role="presentation"
        bind:this={rowsEl}
        onpointerdown={onRowsPointerDown}
        ondragover={onRowsDragOver}
        ondragleave={onRowsDragLeave}
        ondrop={onRowsDrop}
      >
        <canvas class="grid" bind:this={gridCanvas}></canvas>
        <!--
          拖拽落点：目标行加一层底色 + 一条竖线。
          竖线落在**吸附后**的时刻上 —— 看见的就是会落下的位置。
          （整块行区不加描边：`.rows` 与工程一样宽，右边界在屏幕外，那种「回执」
          用户根本看不到；逐行染色才落在眼睛够得着的地方。）
        -->
        {#if dropHint}
          <div
            class="drop-line"
            data-testid="tl-drop-line"
            style:left={`${dropHint.x}px`}
            style:top={`${dropHint.top}px`}
            style:height={`${ROW_HEIGHT}px`}
          ></div>
        {/if}
        {#each tracks as track (track.id)}
          <div
            class="row"
            class:audio={track.kind === 'audio'}
            class:disabled={!track.enabled}
            class:drop-target={dropHint?.trackId === track.id}
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
            {#each transitionMarks.get(track.id) ?? [] as m (m.id)}
              <!--
                转场窗口涂层：跨在剪切点上，两侧各 d/2。
                点它选中出画片段（转场挂在它身上）。
              -->
              <div
                class="tl-transition"
                style:left={`${m.left}px`}
                style:width={`${m.width}px`}
                title={m.title}
                data-testid="transition-marker"
                role="presentation"
                onpointerdown={(e) => {
                  e.stopPropagation();
                  appState.selectedClipId = m.clipId;
                }}
              ></div>
            {/each}
          </div>
        {/each}
        {#if marqueeBox}
          <!--
            框选框。半透明是必须的（框住的内容要看得见）；`pointer-events: none`
            也是必须的 —— 否则框一出现就把指针下的片段盖住，拖框本身会卡住。
          -->
          <div
            class="marquee"
            data-testid="tl-marquee"
            style:left={`${marqueeBox.x}px`}
            style:top={`${marqueeBox.y}px`}
            style:width={`${marqueeBox.w}px`}
            style:height={`${marqueeBox.h}px`}
          ></div>
        {/if}
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
  /*
   * 轨道头列 = 外壳（定宽 + 右边框 + 纵向排布）+ 滚动区 + 固定页脚。
   * 拆这一层是为了让「滚动内容」只有表头 + 各行 —— 与画布那列严格等高。
   */
  .side-wrap {
    width: var(--tl-side-w);
    flex-shrink: 0;
    display: flex;
    flex-direction: column;
    min-height: 0;
    border-right: 1px solid var(--tl-border);
    background: var(--tl-side-bg);
  }
  .side {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    overflow-x: hidden;
    /* 竖直滚动条**只留画布那一条**（两者由 `syncVertical` 联动）。
       这里再挂一条就是用户报的「两条各滚各的」。 */
    scrollbar-width: none;
  }
  .side::-webkit-scrollbar {
    display: none;
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
    /* 拖曳排序：不设过渡，否则跟随指针会拖尾。 */
    will-change: transform;
  }
  .side :global(.is-dragging) {
    background: var(--surface-hover);
  }
  .side :global(.is-reordering) {
    cursor: grabbing;
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
    /* 固定页脚：不参与滚动，于是两侧滚动内容等高（见模板里的注释）。 */
    flex-shrink: 0;
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
    /* 框选是在这块上拖出来的：不加的话拖动会顺手把行里的文字选中 */
    user-select: none;
  }
  /*
   * 框选框。与排版编辑器的同款：半透明填充 + 主题色描边 ——
   * 用 color-mix 而不是 --accent-weak，后者是**不透明**的色阶值。
   * z 与选中片段的描边同层：DOM 里排在片段之后，所以盖在它们上面。
   */
  .marquee {
    position: absolute;
    z-index: var(--z-clip-selected);
    border: 1px solid var(--accent);
    background: color-mix(in srgb, var(--accent) 16%, transparent);
    pointer-events: none;
  }
  .grid {
    position: absolute;
    left: 0;
    top: 0;
    pointer-events: none;
  }
  /* 拖拽落点所在的行：底色（半透明主题色，与框选框同一套写法） */
  .row.drop-target {
    background: color-mix(in srgb, var(--accent) 10%, transparent);
  }
  .drop-line {
    position: absolute;
    width: 2px;
    margin-left: -1px;
    background: var(--accent);
    pointer-events: none;
    /* 与选中片段的描边同层（时间轴内部 z 预算 ≤5，见 tokens） */
    z-index: var(--z-clip-selected);
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

  /*
   * 转场窗口涂层：斜纹是「这里两段画面在同时存在」的通用视觉语言。
   * 用 currentColor 之外的 token（--warning）是因为它表达的是**操作语义**
   * （这块区域的行为被改写了），不是某一类数据。
   */
  .tl-transition {
    position: absolute;
    top: 3px;
    bottom: 3px;
    border-radius: var(--radius-sm);
    border: 1px solid var(--warning);
    background: repeating-linear-gradient(
      45deg,
      color-mix(in srgb, var(--warning) 55%, transparent) 0 3px,
      transparent 3px 7px
    );
    cursor: pointer;
    z-index: var(--z-edge);
  }
  .tl-transition:hover {
    background: color-mix(in srgb, var(--warning) 35%, transparent);
  }
</style>

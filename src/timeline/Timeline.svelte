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
  import { computeWaveform, decodeAudio } from '../audio/decode';
  import {
    newId,
    type AudioClip,
    type EffectClip,
    type SourceClip,
    type Track,
  } from '../core/schema';
  import { beatDur, snapTime } from '../core/time';
  import { resolveTransition } from '../core/transitions';
  import { probeVideo } from '../engine/video-source';
  import { registerVideoMedia } from '../engine/media-assets';
  import { defaultParams, getGenerator, listGenerators } from '../algos/registry';
  import { createTextElement, createTypographyDocument } from '../typography/document';
  import { canvasPalette } from '../ui/tokens';
  import { reorder } from '../ui/drag-reorder';
  import { theme } from '../ui/theme.svelte';
  import { appState } from '../ui/app-state.svelte';
  import { registryRevision } from '../ui/registry-revision.svelte';
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
    // 拍网格还是默认值（120/0）时顺手估一次 —— 用户没动过它，就是在等这个。
    // 动过就绝不覆盖：手调过的卡点比自动估计更值钱。
    await appState.autoEstimateIfDefault();
  }

  /**
   * 导入本地视频。
   *
   * 与 `addAudio` 的两处关键差别：
   *  1. **先把 `File` 句柄交给渲染层**（`registerVideoMedia`），解码从磁盘流式读；
   *     素材字节另存一份进仓只是为了保存工程 —— 视频编码器不需要它。
   *  2. 片段默认 `fit: 'cover'`：空镜头是底图，铺满画幅才符合预期
   *     （`contain` 会留黑边，那是素材与工程画幅不一致时的意外，不是意图）。
   */
  async function addVideo(trackId: string, at?: number): Promise<void> {
    closeMenus();
    const picked = await browserPlatform.pickVideoFile();
    if (!picked) return;

    const meta = await probeVideo(picked.file);
    if (!meta) {
      appState.flash(tr('err.video.unreadable', { name: picked.name }), 'error');
      return;
    }

    const assetId = newId();
    // 渲染层先拿到**磁盘句柄**：解码全程走它，不需要素材字节在场。
    registerVideoMedia(assetId, picked.file);

    // 存一份字节进仓（保存工程用）。这一步是几 GB 素材唯一的内存峰值 ——
    // 见 AGENTS 里「视频素材打开/保存的流式化」那条未决问题。
    appState.assets.put(assetId, new Uint8Array(await picked.file.arrayBuffer()), {
      kind: 'video',
      name: picked.name,
      originName: picked.name,
    });
    appState.store.commit(tr('tl.importVideo'), (p) => {
      p.assets[assetId] = {
        id: assetId,
        kind: 'video',
        name: picked.name,
        durationSec: meta.duration,
        size: { w: meta.width, h: meta.height },
      };
    });

    const start = startFor(at);
    const clip: SourceClip = {
      kind: 'source',
      id: newId(),
      start,
      end: start + Math.max(0.1, meta.duration),
      label: picked.name,
      fadeSec: 0,
      curves: {},
      source: { type: 'video', assetId, srcIn: 0, speed: 1 },
      blend: 'normal',
      opacity: 1,
      transform: { x: 0.5, y: 0.5, sx: 1, sy: 1, rot: 0 },
      fit: 'cover',
    };
    appState.store.addClip(trackId, clip);
    appState.selectedClipId = clip.id;
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
  <!--
    轨道行可拖曳排序。挂在整个 .side 上而不是每行上：拖动时要把它**兄弟**
    的 transform 一起算，只有容器才拿得到全量。
    行菜单 / 重命名输入框都在行内，所以拖曳是「位移超过阈值才算」——
    4px 以内的移动仍然是一次正常的点击。
  -->
  <div
    class="side"
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

  <div class="scroll" data-testid="tl-scroll" bind:this={scrollEl} onwheel={wheel} onscroll={() => paint(false)}>
    <div class="canvas-wrap" data-testid="tl-canvas-wrap" style:width={`${drawWidth}px`}>
      <canvas class="ruler" bind:this={rulerCanvas} onpointerdown={scrub}></canvas>
      <div
        class="rows"
        role="presentation"
        bind:this={rowsEl}
        onpointerdown={onRowsPointerDown}
      >
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

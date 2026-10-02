/**
 * app-state.svelte.ts — 全局 UI 状态（Svelte 5 runes）。
 *
 * 响应式只挂这些东西：store 的 version 镜像、播放头、播放态、吸附、
 * 缩放、选中、波形。Project 本体不放进 runes——每次 commit 后
 * store.subscribe 推 version++，组件靠读 version 建立依赖。
 *
 * 服务（renderer / sources / player）由 main.ts 装配后经 init 注入，
 * 不参与响应式。
 */

import { ProjectStore } from '../core/project-store';
import { newId, type AnyClip } from '../core/schema';
import { createBlankProject } from '../core/demo-project';
import { Renderer } from '../engine/renderer';
import { SourceManager } from '../engine/sources';
import { AudioPlayer } from '../audio/player';
import { BakeClient } from '../algos/bake-client';
import { AlgoRuntime } from '../algos/runtime';
import { createEffectRunner } from '../effects/runner';
import { FontRegistry } from '../typography/font-registry';
import { TypographyRuntime } from '../typography/runtime';
import {
  createOffscreenHost,
  createTextBackendRegistry,
  type TextBackendRegistry,
} from '../typography/rasterizer';
import { resolveImageAsset } from '../typography/image-assets';
import type { WaveformData } from '../audio/decode';
import { snapTime, type SnapMode } from '../core/time';
import type { FsDirHandle } from '../project/fs';
import type { AssetIssue } from '../project/ledger';
import type { ProjectRef } from '../project/handles';
import { createAssetStore, type AssetStore } from '../project/asset-store';
import { DENSITY } from './tokens';

/* ------------------------------------------------------------ UI 偏好持久化
 *
 * 只存「跟内容无关、丢了只是回到默认值」的东西。工程真相永远只在磁盘
 * （AGENTS §1.7），所以这里绝不能放工程数据。
 */
const UI_KEY = 'artmatic.ui';

interface UiPrefs {
  drawerOpen: boolean;
  drawerWidth: number;
}

function loadUiPrefs(): UiPrefs {
  const fallback: UiPrefs = { drawerOpen: true, drawerWidth: DENSITY.drawerW };
  try {
    const raw = localStorage.getItem(UI_KEY);
    if (!raw) return fallback;
    const p = JSON.parse(raw) as Partial<UiPrefs>;
    return {
      drawerOpen: typeof p.drawerOpen === 'boolean' ? p.drawerOpen : fallback.drawerOpen,
      drawerWidth: clampDrawerWidth(Number(p.drawerWidth) || fallback.drawerWidth),
    };
  } catch {
    return fallback;
  }
}

function clampDrawerWidth(w: number): number {
  if (!Number.isFinite(w)) return DENSITY.drawerW;
  return Math.min(DENSITY.drawerMaxW, Math.max(DENSITY.drawerMinW, Math.round(w)));
}

function saveUiPrefs(p: UiPrefs): void {
  try {
    localStorage.setItem(UI_KEY, JSON.stringify(p));
  } catch {
    /* 存不下不中断操作 */
  }
}

/* ------------------------------------------------------------ 打开的工程
 *
 * 顶栏的选项卡 = **工程**，不是一个网页里的「页面」。
 * 一个网页里同时开多份工程是这类工具的常态（比对两版剪辑、把 A 的片段搬到 B），
 * 而「时间轴 / 排版编辑」是**工程内部**的视图，跟着工程走 —— 切回某个工程时，
 * 它上次停在哪个视图就回到哪里，像浏览器标签页记住自己的位置。
 *
 * 所有「跟这一份工程走」的东西都挂在 `OpenProject` 上。这样切换工程 =
 * 换一个 `activeProjectId`，而不是把一堆散落的状态逐个同步一遍 ——
 * 后者的 bug 形态是「切过去以后播放头还停在上一个工程的位置」，
 * 而且每加一个工程级状态就多一个漏同步的机会。
 */

/** 工程内部视图。排版编辑页不再是顶栏的一级页面。 */
export type ProjectView = { kind: 'timeline' } | { kind: 'typography'; clipId: string };

export interface OpenProject {
  readonly id: string;
  /** 文档真相。 */
  store: ProjectStore;
  /**
   * 每个工程自己的素材仓。
   * **共用一份会让保存 A 时把 B 导入的素材一起写进 A 的 `assets/`。**
   */
  assets: AssetStore;
  view: ProjectView;
  /** 盘上位置。null = 还没选过目录。 */
  dir: FsDirHandle | null;
  /** IndexedDB 里的句柄键。 */
  key: string | null;
  /** 上次保存时的 `store.version`；-1 = 从未保存过。 */
  savedVersion: number;
  savedAt: number;
  issues: AssetIssue[];
  /** 播放头（秒）。**工程级**：切回来时停在离开的位置。 */
  playT: number;
  selectedClipId: string | null;
}

class AppState {
  /* 响应式 —— 这里只放**全局**（不跟工程走）的 UI 状态。
     跟工程走的东西在 `OpenProject` 上，由 getter/setter 转发（见「打开的工程」段）。
     `playT` 与 `selectedClipId` 就属于后者：它们是工程状态，不是界面状态。 */
  version = $state(0);
  playing = $state(false);
  snap = $state<SnapMode>('beat');
  pxPerBeat = $state(28);
  /**
   * 拖拽中的落点是否会被 reject 策略拒收（给被拖片段加「不可落」样式）。
   * 只读，由 timeline/drag.ts 的 onHint 写入——拖动结束时必须归 false。
   */
  dragIllegal = $state(false);
  waveforms = $state<Record<string, WaveformData>>({});
  /** 新关键帧默认锚到拍（Inspector 的 ◆ 按钮读这个）。 */
  beatAnchorNewKeys = $state(true);
  /** 导出进行中的进度（null = 没在导出）。 */
  exportProgress = $state<number | null>(null);
  /** 导出的取消器（非响应式）。 */
  exportAbort: AbortController | null = null;
  /**
   * 一次性操作提示（Alt+↑↓ 被策略挡住、保存结果等）。
   *
   * `noticeLevel` 决定底栏那段的颜色 —— 保存成功再用红色报，
   * 用户第一眼会以为失败了。
   */
  notice = $state<string | null>(null);
  noticeLevel = $state<'info' | 'success' | 'error'>('info');
  private noticeTimer: ReturnType<typeof setTimeout> | null = null;

  /**
   * 预览帧率。**只用于 UI 展示**，不参与任何渲染求值——AGENTS §1.1 规定渲染
   * 时间的唯一来源是 t，这里读 performance.now() 仅仅是统计显示，不喂给 renderFrame。
   */
  fps = $state(0);
  private fpsFrames = 0;
  private fpsAt = 0;

  /** 右侧检查器抽屉。默认展开，宽度可拖，两者都持久化。 */
  drawerOpen = $state(true);
  // 显式标注 number：DENSITY 是 as const，不标注会推成字面量类型 300。
  drawerWidth = $state<number>(DENSITY.drawerW);

  /* ---- 排版编辑器（全局，不跟工程走：这是「怎么看」，不是「看什么」） ---- */

  /** 预览光栅化倍率（1 = 跟随渲染尺寸，0.5 / 0.25 = 低画质）。 */
  typoPreviewScale = $state<number>(1);
  /** 对齐目标：「画布」= 相对幻灯片（PPT 叫法），「选区」= 相对选中集外接框。 */
  typoAlignTarget = $state<'canvas' | 'selection'>('canvas');
  /**
   * 已注册的字体族（Ribbon 的字体下拉读它）。
   * 做成响应式而不是每次读 registry：注册发生在异步导入之后，
   * 不触发重算的话「导入成功了但下拉里没有」。
   */
  fontFamilies = $state<string[]>([]);

  /** 字体表变更后调一次（注册内置字体、用户导入之后）。 */
  refreshFontFamilies(): void {
    this.fontFamilies = this.fonts.families();
  }

  /* ---------------------------------------------------------- 打开的工程 */

  /** 至少一个，顺序即选项卡顺序。 */
  projects = $state<OpenProject[]>([]);
  activeProjectId = $state<string>('');

  get activeProject(): OpenProject {
    return this.projects.find((p) => p.id === this.activeProjectId) ?? this.projects[0]!;
  }

  /**
   * 当前工程的文档真相。**所有写库都走它**，所以它必须是动态的 ——
   * 任何 `const store = appState.store` 之后跨越工程切换的代码，
   * 都会写到已经不在前台的那份工程上。
   */
  get store(): ProjectStore {
    return this.activeProject.store;
  }

  /**
   * 当前工程的素材仓。
   *
   * ⚠️ **不要 import 模块级的素材仓**（那是个跨工程单例）：
   * 共用它会让保存 A 时把 B 导入的素材一起写进 A 的 `assets/`。
   */
  get assets(): AssetStore {
    return this.activeProject.assets;
  }

  /* 播放头与选中态是**工程级**的：切回来时停在离开的位置，
     而不是被另一份工程的进度带走。 */
  get playT(): number {
    return this.activeProject.playT;
  }
  set playT(v: number) {
    this.activeProject.playT = v;
  }

  get selectedClipId(): string | null {
    return this.activeProject.selectedClipId;
  }
  set selectedClipId(v: string | null) {
    this.activeProject.selectedClipId = v;
  }

  /* ---- 会话属性：原来是单例上的字段，现在转发到激活工程 ---- */

  get projectDir(): FsDirHandle | null {
    return this.activeProject.dir;
  }
  set projectDir(v: FsDirHandle | null) {
    this.activeProject.dir = v;
  }

  get projectKey(): string | null {
    return this.activeProject.key;
  }
  set projectKey(v: string | null) {
    this.activeProject.key = v;
  }

  /**
   * 展示名。**只读** —— 它直接来自 `Project.name`。改名要写库
   * （`store.commit`），不另存一份，否则「面板显示的名字」与
   * 「磁盘上 `project.json` 里的名字」会漂移。
   */
  get projectName(): string {
    return this.activeProject.store.project.name || '未命名工程';
  }

  /** 上次保存时的 `store.version`；-1 = 从未保存过。 */
  get savedVersion(): number {
    return this.activeProject.savedVersion;
  }
  set savedVersion(v: number) {
    this.activeProject.savedVersion = v;
  }

  get savedAt(): number {
    return this.activeProject.savedAt;
  }
  set savedAt(v: number) {
    this.activeProject.savedAt = v;
  }

  get projectIssues(): AssetIssue[] {
    return this.activeProject.issues;
  }
  set projectIssues(v: AssetIssue[]) {
    this.activeProject.issues = v;
  }

  /**
   * 有未保存改动。
   *
   * `savedVersion !== version` 是个**近似**（改完再撤销回原样仍然算脏），
   * 但方向是安全的那一边：假阳性只是多问一句「要保存吗」，
   * 假阴性才是丢工作。
   */
  get projectDirty(): boolean {
    return this.activeProject.savedVersion !== this.activeProject.store.version;
  }

  /* ------------------------------------------------------ 工程的增删切换 */

  /**
   * 把一个**已经装配好**的工程挂到选项卡上并激活它。
   *
   * 装配（建空白 / 读盘 / 装素材）在 `ui/project-actions.ts` ——
   * 这里只管登记与切换，不碰文件系统。分开是为了让「新开一份」与
   * 「从磁盘打开」共用同一条登记路径。
   */
  adoptProject(init: {
    store: ProjectStore;
    assets?: AssetStore;
    dir?: FsDirHandle | null;
    key?: string | null;
    savedVersion?: number;
    savedAt?: number;
    issues?: AssetIssue[];
    /** 立刻激活。默认 true。 */
    activate?: boolean;
  }): OpenProject {
    const p: OpenProject = {
      id: newId(),
      store: init.store,
      assets: init.assets ?? createAssetStore(),
      view: { kind: 'timeline' },
      dir: init.dir ?? null,
      key: init.key ?? null,
      savedVersion: init.savedVersion ?? -1,
      savedAt: init.savedAt ?? 0,
      issues: init.issues ?? [],
      playT: 0,
      selectedClipId: null,
    };
    this.projects.push(p);
    if (init.activate !== false) this.activateProject(p.id);
    return p;
  }

  /**
   * 切到另一份工程。
   *
   * 顺序有讲究：**先 `pause()` 再改 `activeProjectId`** —— `pause` 会把
   * 播放位置写回「当前工程」，而 getter 在改完 id 之后就指向新工程了，
   * 那样会把 A 的播放头写进 B。
   */
  activateProject(id: string): void {
    if (this.activeProjectId === id) return;
    if (!this.projects.some((p) => p.id === id)) return;

    if (this.playing) this.pause();
    // 离开前取消未结算的手势：绝不能让 beginTx 悬空，否则撤销栈会错乱。
    this.pendingGestureCancel?.();
    this.pendingGestureCancel = null;

    this.activeProjectId = id;
    this.subscribeActive();
    // 两份工程的分辨率可能不同，必须重新同步显示尺寸。
    this.refreshPreview();
    // 音频位置属于上一份工程，停掉。素材仓各自独立，不用动。
    this.player?.stop();
  }

  /**
   * 关闭一份工程。
   *
   * - **脏的返回 `'dirty'`，由调用方弹确认**（`force: true` 才真关）。
   *   这里刻意不「直接拒绝」：拒绝之后用户既关不掉、也不知道下一步该干什么。
   *   改动只活在内存里，所以确认框必须说清后果是**丢失**。
   * - **关掉最后一份会补一个空白工程**：工作区不允许 0 份工程 ——
   *   否则所有 `activeProject` 的读取者都要处理空集，代价远大于收益。
   *   补出来的是一份**崭新的空白**，不是「原来那个又回来了」，所以不会误导。
   */
  closeProject(id: string, opts: { force?: boolean } = {}): 'ok' | 'dirty' | 'missing' {
    const i = this.projects.findIndex((p) => p.id === id);
    if (i < 0) return 'missing';
    const p = this.projects[i]!;
    if (!opts.force && p.savedVersion !== p.store.version) return 'dirty';

    const wasActive = p.id === this.activeProjectId;
    if (wasActive) {
      if (this.playing) this.pause();
      this.pendingGestureCancel?.();
      this.pendingGestureCancel = null;
    }

    this.projects.splice(i, 1);

    if (this.projects.length === 0) {
      this.adoptProject({ store: new ProjectStore(createBlankProject()) });
      return 'ok';
    }

    if (wasActive) {
      // 落在原来那个位置（删掉末尾就往前退一个）。
      this.activeProjectId = this.projects[Math.min(i, this.projects.length - 1)]!.id;
      this.subscribeActive();
      this.refreshPreview();
      this.player?.stop();
    }
    return 'ok';
  }

  /**
   * 有没有**任何**一份工程带未保存改动。
   *
   * 给 `beforeunload` 用：关整个页面会把所有工程一起丢掉，
   * 而且浏览器不会给我们第二次机会。这里不做响应式（一次性求值），
   * 所以直接读 `store.version` 也拿得到当前值。
   */
  get anyDirty(): boolean {
    return this.projects.some((p) => p.savedVersion !== p.store.version);
  }

  /**
   * 把 `version` 绑到**当前激活工程**的 store 上。
   *
   * 每份工程有自己的 version 计数，所以切换时必须换订阅 —— 否则后台工程的
   * 改动会去刷新前台界面，而前台自己的改动反而看不见。
   */
  private subscribeActive(): void {
    this.unsubActive?.();
    this.version = this.store.version;
    this.unsubActive = this.store.subscribe(() => {
      this.version = this.store.version;
    });
  }

  private unsubActive: (() => void) | null = null;

  /* ------------------------------------------------------------ 工程视图 */

  get editorOpen(): boolean {
    return this.activeProject.view.kind === 'typography';
  }

  get activeTypoClipId(): string | null {
    const v = this.activeProject.view;
    return v.kind === 'typography' ? v.clipId : null;
  }

  /**
   * 打开某个排版片段的编辑页。双击片段、检查器按钮都走这里。
   *
   * 视图是**工程级**的：切到别的工程再切回来，还停在排版页。
   * tab 里**只存 clipId，不复制文档** —— 文档真相始终在 `store.project`，
   * 这是「关掉编辑器再打开，内容还在」的结构保证，不靠「记得保存」。
   */
  openTypographyTab(clipId: string): void {
    this.activeProject.view = { kind: 'typography', clipId };
    if (this.playing) this.pause();
    this.renderer?.onSeek();
  }

  /** 回到某份工程的时间轴视图。默认当前那份。 */
  closeTypographyView(projectId: string = this.activeProjectId): void {
    const p = this.projects.find((x) => x.id === projectId);
    if (!p || p.view.kind !== 'typography') return;
    if (projectId === this.activeProjectId) {
      this.pendingGestureCancel?.();
      this.pendingGestureCancel = null;
    }
    p.view = { kind: 'timeline' };
    if (projectId === this.activeProjectId) this.refreshPreview();
  }

  /**
   * 双击片段 = 打开它自己的编辑器。**一律不切分** ——
   * 破坏性操作不该绑在高误触手势上，切分保留 S 键与检查器按钮两个入口。
   *
   * 目前只有 text 源有独立页面；其余类型聚焦检查器（接各自的页面时，
   * 只需要在这里加分支，ClipView 不用动）。
   */
  openClipEditor(clip: AnyClip): void {
    if (clip.kind === 'source' && clip.source.type === 'text') {
      this.openTypographyTab(clip.id);
      return;
    }
    this.drawerOpen = true;
    if (clip.kind === 'source') {
      this.flash('该类型的独立编辑器在后续里程碑提供；已打开属性检查器');
    }
  }

  /**
   * 切回时间轴后重同步预览。
   *
   * 隐藏期间显示区域尺寸是 0，不重算的话预览会糊或尺寸不对；
   * `onSeek()` 清反馈历史，免得 echo 的拖尾错乱（与 seek 同语义）。
   */
  private refreshPreview(): void {
    this.renderer?.onSeek();
    this.renderer?.syncSize(this.store.project.resolution);
    this.renderer?.renderFrame(this.store.project, this.playT);
  }

  /** 编辑器注册「取消当前手势」的钩子（切工程 / 关排版页时调用）。 */
  registerGestureCancel(fn: (() => void) | null): void {
    this.pendingGestureCancel = fn;
  }

  private pendingGestureCancel: (() => void) | null = null;

  constructor() {
    const prefs = loadUiPrefs();
    this.drawerOpen = prefs.drawerOpen;
    this.drawerWidth = prefs.drawerWidth;
  }

  setDrawerOpen(open: boolean): void {
    if (this.drawerOpen === open) return;
    this.drawerOpen = open;
    this.persistUi();
  }

  toggleDrawer(): void {
    this.setDrawerOpen(!this.drawerOpen);
  }

  setDrawerWidth(w: number): void {
    const next = clampDrawerWidth(w);
    if (this.drawerWidth === next) return;
    this.drawerWidth = next;
    this.persistUi();
  }

  private persistUi(): void {
    saveUiPrefs({ drawerOpen: this.drawerOpen, drawerWidth: this.drawerWidth });
  }

  /* ---------------------------------------------------- 工程面板的全局状态 */

  /** 保存 / 打开进行中。挡住连点两次弹出两个目录选择器。 */
  projectBusy = $state(false);
  recentProjects = $state<ProjectRef[]>([]);

  /* 服务（非响应式，装配见 init / attachPreview）。
     ⚠️ 这里**没有** `store` —— 它是 getter，指向当前激活工程的那一份。
     服务本身（renderer / player / fonts / 排版运行时）是进程级的：
     它们渲染「当前工程」，不持有任何工程数据。 */
  renderer!: Renderer;
  sources!: SourceManager;
  player!: AudioPlayer;
  fonts!: FontRegistry;
  textBackends!: TextBackendRegistry;
  textRaster!: TypographyRuntime;
  private servicesReady = false;

  /**
   * main.ts 在 mount 之前调。首份工程必须在这里就存在，
   * 组件一挂载就会读 `appState.store.project`。
   */
  init(store: ProjectStore): void {
    this.adoptProject({ store });
  }

  /**
   * Preview.onMount 调：canvas 此刻才存在，渲染服务在这里惰性创建。
   * 挂载顺序由此单一化——不存在「renderer 还没建组件就先渲染」的窗口。
   */
  attachPreview(canvas: HTMLCanvasElement, host: Element): void {
    if (!this.servicesReady) {
      this.renderer = new Renderer(canvas, () => null, () => {});
      this.sources = new SourceManager(this.renderer.kit);
      const bake = new BakeClient(this.renderer.kit, () => this.store.touch());
      const algos = new AlgoRuntime(this.renderer.kit, bake);
      this.sources.setAlgoResolver((clip, t, frame) =>
        algos.resolve(
          clip,
          t,
          frame,
          this.store.project.beatGrid,
          this.store.project.seed,
          this.renderer.kit.w,
          this.renderer.kit.h,
        ),
      );
      this.renderer.setResolver(this.sources.resolve);
      this.renderer.setEffectRunner(createEffectRunner(this.renderer.kit, () => this.store.project.seed));

      // 排版层与 algo 烘焙同构：异步光栅化 → 结果就绪时 touch() → 下一帧重绘。
      // 光栅化本身必须在主线程做（要走 DOM 与 document.fonts），
      // 所以只有「异步结果 → 缓存 → bump version」这一层是复用的。
      this.fonts = new FontRegistry();
      // 随软件分发的 OFL 西文（Inter 400/700）。只登记 URL，第一次用才 fetch。
      this.fonts.registerBundled();
      this.fontFamilies = this.fonts.families();
      this.textBackends = createTextBackendRegistry(createOffscreenHost(), this.fonts);
      this.textRaster = new TypographyRuntime(this.renderer.kit, this.textBackends, this.fonts, {
        onReady: () => this.store.touch(),
        fps: () => this.store.project.fps,
      });
      this.sources.setTextResolver(this.textRaster.resolve);
      // 图片素材的 URL 解析（排版文档里的 image 元素要用它）。
      this.textRaster.resolveImage = resolveImageAsset;
      this.renderer.setPrewarm((p, t) => this.textRaster.prewarmFrame(p, t));
      this.renderer.setFontPrewarm((p) => this.textRaster.prewarmFonts(p));
      this.renderer.setExportLifecycle(
        () => this.textRaster.enterExportMode(),
        () => this.textRaster.exitExportMode(),
      );

      this.player = new AudioPlayer();
      this.servicesReady = true;
    }
    this.renderer.attachDisplay(host);
    this.renderer.syncSize(this.store.project.resolution);
    this.renderer.renderFrame(this.store.project, this.playT);
  }

  get project() {
    return this.store.project;
  }

  /** 显示一条短提示（自动消失）。 */
  flash(text: string, level: 'info' | 'success' | 'error' = 'info'): void {
    this.notice = text;
    this.noticeLevel = level;
    if (this.noticeTimer) clearTimeout(this.noticeTimer);
    this.noticeTimer = setTimeout(() => {
      this.notice = null;
      this.noticeTimer = null;
    }, 2600);
  }

  seek(t: number, opts: { snap?: boolean } = {}): void {
    const p = this.store.project;
    let nt = Math.max(0, Math.min(t, p.duration));
    if (opts.snap) nt = snapTime(nt, this.snap, p.beatGrid);
    this.playT = nt;
    this.renderer.onSeek();
    if (this.playing) void this.player.play(p, nt);
  }

  async play(): Promise<void> {
    this.playing = true;
    await this.player.play(this.store.project, this.playT);
  }

  pause(): void {
    const t = this.player.currentT();
    this.player.stop();
    this.playing = false;
    if (t !== null) this.playT = Math.max(0, Math.min(t, this.store.project.duration));
  }

  stop(): void {
    this.player.stop();
    this.playing = false;
    this.seek(0);
  }

  togglePlay(): void {
    if (this.playing) this.pause();
    else void this.play();
  }

  /** Preview 的 rAF 每帧调一次：播放中推进播放头，然后渲染当前帧。 */
  tick(): void {
    // 导出期间预览循环停手：rAF 在预览尺寸下渲染会重排反馈历史
    // （feedbackFor 按尺寸重建目标），污染正在进行的顺序导出。
    if (this.exportProgress !== null) return;

    // 排版编辑页激活时**不渲染 WebGL**：.body 已被 display:none 隐藏，
    // measureDisplaySize() 会量到 0 并触发 UNMEASURED_MAX_PIXELS 兜底分配，
    // 既浪费显存又会让预览尺寸无谓变形。
    // 但播放头照常推进 —— 排版页的 CSS 动画就是靠 playT 驱动 seek 的。
    if (this.editorOpen) {
      if (this.playing) this.advancePlayhead();
      return;
    }

    if (this.playing) this.advancePlayhead();
    this.renderer.renderFrame(this.store.project, this.playT);
    this.countFrame();
  }

  /** 播放头推进。抽出来给「渲染 WebGL」与「只推进不渲染」两条路共用。 */
  private advancePlayhead(): void {
    const t = this.player.currentT();
    if (t === null) return;
    if (t >= this.store.project.duration) {
      this.pause();
      this.playT = this.store.project.duration;
    } else {
      this.playT = t;
    }
  }

  /** FPS 统计。用 performance.now() 只是为了算频率，不进渲染求值路径。 */
  private countFrame(): void {
    this.fpsFrames += 1;
    const now = performance.now();
    if (this.fpsAt === 0) {
      this.fpsAt = now;
      return;
    }
    const dt = now - this.fpsAt;
    if (dt >= 500) {
      const next = Math.round((this.fpsFrames * 1000) / dt);
      if (next !== this.fps) this.fps = next;
      this.fpsFrames = 0;
      this.fpsAt = now;
    }
  }
}

export const appState = new AppState();

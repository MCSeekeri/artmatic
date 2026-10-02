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
import type { AnyClip } from '../core/schema';
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

/* ------------------------------------------------------------ 顶栏选项卡
 *
 * 「时间轴」是常驻页面，永不关闭；排版编辑器是临时页，跟着片段走。
 * tab 里**只存 clipId，不复制文档** —— 文档真相始终在 store.project，
 * 这是「关掉编辑器再打开，内容还在」的结构保证，不靠「记得保存」。
 */
export interface TimelineShellTab {
  id: 'timeline';
  kind: 'timeline';
  title: string;
  closable: false;
}

export interface TypographyShellTab {
  /** `typo:<clipId>` */
  id: string;
  kind: 'typography';
  title: string;
  clipId: string;
  closable: true;
}

export type ShellTab = TimelineShellTab | TypographyShellTab;

class AppState {
  /* 响应式 */
  version = $state(0);
  playT = $state(0);
  playing = $state(false);
  snap = $state<SnapMode>('beat');
  pxPerBeat = $state(28);
  selectedClipId = $state<string | null>(null);
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
  /** 一次性操作提示（当前只服务 Alt+↑↓：被策略挡住时要说明原因，不然就是静默失灵）。 */
  notice = $state<string | null>(null);
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

  /* ---------------------------------------------------------- 顶栏选项卡 */

  /** 首项恒为时间轴页，不可关。 */
  shellTabs = $state<ShellTab[]>([
    { id: 'timeline', kind: 'timeline', title: '时间轴', closable: false },
  ]);
  activeTabId = $state<string>('timeline');

  /** 排版编辑器的预览光栅化倍率（1 = 跟随渲染尺寸，0.5 / 0.25 = 低画质）。 */
  typoPreviewScale = $state<number>(1);
  /** 排版对齐目标：「画布」= 相对幻灯片（PPT 叫法），「选区」= 相对选中集外接框。 */
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

  get activeTab(): ShellTab {
    return this.shellTabs.find((t) => t.id === this.activeTabId) ?? this.shellTabs[0]!;
  }

  get editorOpen(): boolean {
    return this.activeTab.kind === 'typography';
  }

  get activeTypoClipId(): string | null {
    const t = this.activeTab;
    return t.kind === 'typography' ? t.clipId : null;
  }

  /**
   * 打开（或聚焦）某个排版片段的编辑页。双击片段、检查器按钮都走这里。
   * 同一个片段只会有一个 tab —— 重复打开是聚焦而不是再开一个。
   */
  openTypographyTab(clipId: string): void {
    const id = `typo:${clipId}`;
    if (!this.shellTabs.some((t) => t.id === id)) {
      const clip = this.store.findClip(clipId)?.clip;
      this.shellTabs.push({
        id,
        kind: 'typography',
        clipId,
        title: clip?.label || '排版',
        closable: true,
      });
    }
    this.activateTab(id);
  }

  /**
   * 双击片段 = 打开它自己的编辑器。**一律不切分** ——
   * 破坏性操作不该绑在高误触手势上，切分保留 S 键与检查器按钮两个入口。
   *
   * 目前只有 text 源有独立页面；其余类型聚焦检查器（M5 再接各自的页面时，
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

  activateTab(id: string): void {
    if (this.activeTabId === id) return;
    // 进编辑器前暂停：排版页的动画由 playT 驱动，不需要 WebGL 预览在后台推进。
    if (this.playing) this.pause();
    this.activeTabId = id;
    // 切页清反馈历史，免得回到时间轴时 echo 的拖尾错乱（与 seek 同语义）。
    this.renderer?.onSeek();
    if (id === 'timeline') {
      // 隐藏期间显示区域尺寸是 0，不重新同步尺寸会糊/尺寸不对。
      this.renderer?.syncSize(this.store.project.resolution);
      this.renderer?.renderFrame(this.store.project, this.playT);
    }
  }

  closeTab(id: string): void {
    const i = this.shellTabs.findIndex((t) => t.id === id);
    if (i < 0 || !this.shellTabs[i]!.closable) return;
    // 关页前取消未结算的手势：绝不能让 beginTx 悬空，否则撤销栈会错乱。
    this.pendingGestureCancel?.();
    this.pendingGestureCancel = null;
    this.shellTabs.splice(i, 1);
    if (this.activeTabId === id) this.activateTab('timeline');
  }

  /** 编辑器注册「取消当前手势」的钩子（关页 / 切页时调用）。 */
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

  /* 服务（非响应式，装配见 init / attachPreview） */
  store!: ProjectStore;
  renderer!: Renderer;
  sources!: SourceManager;
  player!: AudioPlayer;
  fonts!: FontRegistry;
  textBackends!: TextBackendRegistry;
  textRaster!: TypographyRuntime;
  private servicesReady = false;

  /** main.ts 在 mount 之前调：store 必须先存在，组件才能安全读工程。 */
  init(store: ProjectStore): void {
    this.store = store;
    store.subscribe(() => {
      this.version = store.version;
    });
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
  flash(text: string): void {
    this.notice = text;
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

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
import { Renderer } from '../engine/renderer';
import { SourceManager } from '../engine/sources';
import { AudioPlayer } from '../audio/player';
import type { WaveformData } from '../audio/decode';
import { snapTime, type SnapMode } from '../core/time';

class AppState {
  /* 响应式 */
  version = $state(0);
  playT = $state(0);
  playing = $state(false);
  snap = $state<SnapMode>('beat');
  pxPerBeat = $state(28);
  selectedClipId = $state<string | null>(null);
  waveforms = $state<Record<string, WaveformData>>({});
  /** 新关键帧默认锚到拍（Inspector 的 ◆ 按钮读这个）。 */
  beatAnchorNewKeys = $state(true);
  /** 导出进行中的进度（null = 没在导出）。 */
  exportProgress = $state<number | null>(null);
  /** 导出的取消器（非响应式）。 */
  exportAbort: AbortController | null = null;

  /* 服务（非响应式，装配见 init / attachPreview） */
  store!: ProjectStore;
  renderer!: Renderer;
  sources!: SourceManager;
  player!: AudioPlayer;
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
      this.renderer.setResolver(this.sources.resolve);
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
    if (this.playing) {
      const t = this.player.currentT();
      if (t !== null) {
        if (t >= this.store.project.duration) {
          this.pause();
          this.playT = this.store.project.duration;
        } else {
          this.playT = t;
        }
      }
    }
    this.renderer.renderFrame(this.store.project, this.playT);
  }
}

export const appState = new AppState();

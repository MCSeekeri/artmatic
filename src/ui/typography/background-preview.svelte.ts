/**
 * background-preview.svelte.ts — 「背景预览」的**界面态**（runes 单例）。
 *
 * 它只管状态与播放循环，不认识 DOM、也不碰 renderer（取帧在
 * `BackgroundLayer.svelte` 里做 —— 那一半要 await、要挂卸载清理，属于组件）。
 *
 * ## 时间：**局部**，不动工程的播放头
 *
 * `at` 是「编辑器局部预览时间」（绝对秒）。它非 null 时，舞台的动画与底图都改由
 * 它驱动（见 TypographyEditor 的 `stageTime`），而 `appState.playT` **一帧都不改** ——
 * 那是时间轴的播放头，属于另一份状态；在排版页里推它会把时间轴的播放头也带着走。
 *
 * 语义：
 *  - `at === null`：跟随 `appState.playT`（编辑器平时就是这一档）。
 *  - 拖动进度条 / 播放：`at` 生效，舞台与底图跟着它。
 *  - 播放到片段尾：**停**（不回环），并把 `at` 复原到「进入播放前」的值。
 *  - 关掉背景预览 / 关编辑器：`at` 回到 null、跟随播放头。
 */

import { appState } from '../app-state.svelte';
import { BG_DEFAULT_OPACITY, advancePreviewTime, clampBgOpacity } from './background-preview';
import { editorState } from './editor-state.svelte';

class BackgroundPreviewState {
  /** 开关：是否显示半透明底图。默认**关** —— 不主动给每个用户加渲染开销与视觉噪声。 */
  enabled = $state(false);

  /** 底图不透明度（0..1）。 */
  opacity = $state(BG_DEFAULT_OPACITY);

  /** 是否正在播放局部预览。 */
  playing = $state(false);

  /** 局部预览时间（绝对秒）。null = 跟随 `appState.playT`。 */
  at = $state<number | null>(null);

  /** 当前底图的对象 URL（`<img src>`）。 */
  url = $state<string | null>(null);

  private raf = 0;
  private lastTs = 0;
  /** 进入播放前的 `at`（可能是 null）—— 播到尾时复原到它。 */
  private restoreAt: number | null = null;

  /* ------------------------------------------------------------ 开关 */

  toggleEnabled(): void {
    if (this.enabled) this.disable();
    else this.enabled = true;
  }

  /** 关掉背景预览：停止播放、回到跟随播放头，并立刻释放底图对象 URL。 */
  disable(): void {
    this.stopLoop();
    this.playing = false;
    this.at = null;
    this.enabled = false;
    this.releaseUrl();
  }

  setOpacity(v: number): void {
    this.opacity = clampBgOpacity(v);
  }

  /* ------------------------------------------------------------ 时间 */

  /** 拖动进度条 / 跳到某个绝对时间：暂停播放并进入局部覆盖态。 */
  seekLocal(t: number): void {
    if (!Number.isFinite(t)) return;
    this.stopLoop();
    this.playing = false;
    this.at = t;
  }

  /** 从当前预览位置（越界时从片段起点）播到片段末尾。 */
  play(): void {
    if (this.playing) return;
    const clip = editorState.clip;
    if (!clip) return;
    // 时间轴若在播，先停 —— 两套时钟同时推 playT / at 会互相打架。
    if (appState.playing) appState.pause();
    this.restoreAt = this.at;
    const from0 = this.at ?? clip.start;
    const from = from0 >= clip.end ? clip.start : Math.max(clip.start, from0);
    this.at = from;
    this.playing = true;
    this.lastTs = 0;
    this.raf = requestAnimationFrame(this.tick);
  }

  /** 暂停（保持当前帧，不还原）。 */
  pause(): void {
    if (!this.playing) return;
    this.playing = false;
    this.stopLoop();
  }

  /** 回到片段起点（暂停态）。 */
  rewind(): void {
    const clip = editorState.clip;
    if (!clip) return;
    this.seekLocal(clip.start);
  }

  /**
   * 每帧推进。**到片段尾就停，不回环**，并把 `at` 复原到进入播放前的值
   * （`restoreAt`，通常是 null = 回到跟随播放头）。
   */
  private tick = (ts: number): void => {
    if (!this.playing) return;
    const clip = editorState.clip;
    if (!clip) {
      this.pause();
      return;
    }
    if (this.lastTs === 0) this.lastTs = ts;
    const dt = (ts - this.lastTs) / 1000;
    this.lastTs = ts;

    const step = advancePreviewTime(this.at ?? clip.start, dt, clip);
    if (step.ended) {
      this.playing = false;
      this.at = this.restoreAt;
      this.stopLoop();
      return;
    }
    this.at = step.at;
    this.raf = requestAnimationFrame(this.tick);
  };

  private stopLoop(): void {
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
  }

  /** 释放底图对象 URL。每次换新图也要调它，否则旧 blob 一直占着内存。 */
  releaseUrl(): void {
    if (this.url) URL.revokeObjectURL(this.url);
    this.url = null;
  }

  /** 编辑器卸载时调用：停播、复原时间、释放 URL。 */
  dispose(): void {
    this.stopLoop();
    this.playing = false;
    this.at = null;
    this.enabled = false;
    this.releaseUrl();
  }
}

export const bgPreview = new BackgroundPreviewState();

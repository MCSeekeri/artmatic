/**
 * background-preview.svelte.ts — 「背景预览」的**界面态**（runes 单例）。
 *
 * 它只管状态与播放循环，不认识 DOM、也不碰 renderer（取帧在
 * `BackgroundLayer.svelte` 里做 —— 那一半要 await、要挂卸载清理，属于组件）。
 *
 * ## 时间：就是**工程播放头**（`appState.playT`），没有第二份时钟
 *
 * 这里曾经有一份「编辑器局部时间」（`at`，非 null 时盖住 `playT`）。它的本意是
 * 「在排版页里预览不该推动时间轴」，但它把两条时间线**劈成了两份状态**：
 * 拖动底栏进度条只改 `at`，关键帧面板的播放头读 `playT` 一动不动 —— 两个控件
 * 看着是同一个播放头，实际各走各的，反向拖动就「断开绑定」。
 *
 * 现在只有一个时钟：进度条拖动 = `appState.seek()`，播放 = 每帧写 `playT`。
 * 于是底栏进度条、关键帧面板的播放头、时间轴播放头、舞台动画、底图取帧永远是
 * 同一时刻（硬约束 1.1：时间只有一个来源）。
 *
 * 语义：
 *  - 播放到**片段尾就停，不回环**，停在片尾（不再复原到播放前的位置 —— 那会
 *    把别人也看得见的播放头一起拽回去）。
 *  - 播放期间**别人挪了 `playT`**（拖标尺 / 拖关键帧 / 时间轴操作）⇒ 本循环立刻
 *    停手，不跟用户抢时钟（判据见 `tick` 里的 `written`）。
 *  - 时间轴自己在播时（`appState.playing`）本循环不启动 / 立刻退出：两套推进器
 *    同时写 `playT` 只会打架。
 */

import { appState } from '../app-state.svelte';
import { BG_DEFAULT_OPACITY, advancePreviewTime, clampBgOpacity } from './background-preview';
import { editorState } from './editor-state.svelte';

class BackgroundPreviewState {
  /** 开关：是否显示半透明底图。默认**关** —— 不主动给每个用户加渲染开销与视觉噪声。 */
  enabled = $state(false);

  /** 底图不透明度（0..1）。 */
  opacity = $state(BG_DEFAULT_OPACITY);

  /** 是否正在推进播放头（底栏那个播放按钮）。 */
  playing = $state(false);

  /** 当前底图的对象 URL（`<img src>`）。 */
  url = $state<string | null>(null);

  private raf = 0;
  private lastTs = 0;
  /** 上一帧由**本循环**写进 `playT` 的值。外部 seek 会让它对不上（见 `tick`）。 */
  private written = 0;

  /* ------------------------------------------------------------ 开关 */

  toggleEnabled(): void {
    if (this.enabled) this.disable();
    else this.enabled = true;
  }

  /** 关掉背景预览：停止播放并立刻释放底图对象 URL。 */
  disable(): void {
    this.stopLoop();
    this.playing = false;
    this.enabled = false;
    this.releaseUrl();
  }

  setOpacity(v: number): void {
    this.opacity = clampBgOpacity(v);
  }

  /* ------------------------------------------------------------ 时间 */

  /**
   * 拖动进度条 / 跳到某个时刻：**推工程播放头**。
   *
   * 走 `appState.seek()` 而不是直接赋 `playT`：它会夹到工程时长、清反馈历史
   * （`renderer.onSeek()`，模拟状态要重新对齐）—— 与时间轴的拖动同一条路径。
   */
  seekTo(t: number): void {
    if (!Number.isFinite(t)) return;
    this.stopLoop();
    this.playing = false;
    appState.seek(t);
  }

  /** 从当前播放头（越界时从片段起点）推到片段末尾。 */
  play(): void {
    if (this.playing) return;
    const clip = editorState.clip;
    if (!clip) return;
    // 时间轴若在播，先停 —— 两套推进器同时写 playT 会互相打架。
    if (appState.playing) appState.pause();
    const from = appState.playT >= clip.end ? clip.start : Math.max(clip.start, appState.playT);
    appState.seek(from);
    this.written = from;
    this.playing = true;
    this.lastTs = 0;
    this.raf = requestAnimationFrame(this.tick);
  }

  /** 暂停（保持当前帧）。 */
  pause(): void {
    if (!this.playing) return;
    this.playing = false;
    this.stopLoop();
  }

  /** 回到片段起点（暂停态）。 */
  rewind(): void {
    const clip = editorState.clip;
    if (clip) this.seekTo(clip.start);
  }

  /** 每帧推进播放头。**到片段尾就停**，不回环。 */
  private tick = (ts: number): void => {
    if (!this.playing) return;
    const clip = editorState.clip;
    // 片段被关掉 / 时间轴开始播：让位。
    if (!clip || appState.playing) {
      this.pause();
      return;
    }
    /*
     * 外部 seek 检测：`playT` 与本循环上一帧写进去的值对不上，说明用户正在别处
     * 挪播放头（拖关键帧面板的标尺、拖时间轴、按回退…）。此时停手 —— 否则下一帧
     * 就把用户的落点覆盖掉，表现是「在播放中拖播放头，它自己弹回去」。
     */
    if (Math.abs(appState.playT - this.written) > 1e-6) {
      this.pause();
      return;
    }
    if (this.lastTs === 0) this.lastTs = ts;
    const dt = (ts - this.lastTs) / 1000;
    this.lastTs = ts;

    const step = advancePreviewTime(appState.playT, dt, clip);
    if (step.ended) {
      this.pause();
      appState.playT = clip.end;
      return;
    }
    appState.playT = step.at;
    this.written = step.at;
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

  /** 编辑器卸载时调用：停播并释放 URL（播放头是工程状态，不在这里复原）。 */
  dispose(): void {
    this.stopLoop();
    this.playing = false;
    this.enabled = false;
    this.releaseUrl();
  }
}

export const bgPreview = new BackgroundPreviewState();

/**
 * export.ts — 导出动作。从 Transport 抽出来，因为触发入口搬进了窄侧栏。
 *
 * 保留原有的全部语义：导出期间禁二次触发、进度写 appState（底栏与侧栏面板
 * 都读它）、可取消。导出本身走 exporters/ 的紧循环，这里只管编排与下载。
 *
 * 三种格式（ADR-001）：
 *   mp4   WebCodecs 编码 + mediabunny 封装，含音轨。**主路径**。
 *   png   PNG 序列 zip。永远可用的逃生舱 —— 浏览器不支持 H.264 时它仍在，
 *         而且「帧要一张张交给达芬奇 / Cavalry」本身就是正当用途。
 *   gif   GIF89a，纯 CPU 软编（gifenc）。**分享格式**：256 色、无音轨，
 *         但哪里都能直接播。它也是唯一会**主动降分辨率与降帧率**的格式。 
 *
 * ## 关于磁盘占用（重要）
 *
 * MP4 是有损压缩，体积比 PNG 序列小一到两个数量级，但**仍然是几十 MB 级**：
 * 一段 16s / 1080p / 16 Mbps 的导出约 32 MB。反复导出不做清理，
 * 一下午就能在下载目录堆掉几个 GB。
 *
 * 三条防线：
 * 1. **导出前估算体积并显示**，让用户在点之前就知道要花多少磁盘（见 estimateMp4Bytes）。
 * 2. **下载用完立刻 revoke**，不留 objectURL（`browserPlatform.download` 已有 10s 延迟，
 *    这里不重复造）。
 * 3. **E2E 一律短时长 + 小分辨率，且产物落临时目录、断言后立刻删**。
 *    测试绝不能靠「导一次看看」—— 一次全量 E2E 有 13 个 spec。
 */

import { appState } from './app-state.svelte';
import { ExportCancelled, runExport } from '../exporters/export-runner';
import { Mp4Sink, MP4_CODEC } from '../exporters/mp4-sink';
import { PngSequenceSink } from '../exporters/png-sequence';
import { GifSink, GIF_SINK_CODEC } from '../exporters/gif-sink';
import { planGif, type GifPlan } from '../exporters/gif-plan';
import { mixdown } from '../exporters/mixdown';
import { browserPlatform } from '../platform/browser';
import { tr } from '../i18n/index.svelte';

export type ExportFormat = 'mp4' | 'png' | 'gif';

/** 本次导出会产出多少帧。帧率来自工程（renderer 与导出共用同一个值）。 */
export function totalFrames(): number {
  const p = appState.store.project;
  return Math.max(1, Math.ceil(p.duration * p.fps));
}

export function isExporting(): boolean {
  return appState.exportProgress !== null;
}

/** 本机是否支持 MP4 主路径。不支持时 UI 应把 MP4 按钮标成不可用。 */
export function mp4Supported(): boolean {
  return typeof VideoEncoder !== 'undefined' && typeof VideoFrame !== 'undefined';
}

/**
 * 估算 MP4 产物体积（字节）。
 *
 * **只是估算**，UI 用来在点之前给个心理预期，不做额度管控。
 * 算法：视频码率（与 `Mp4Sink` 的分档一致）× 时长 + 音频码率 × 时长 + 1 MB 容器余量。
 * 真实体积受内容复杂度影响很大 —— 全屏噪声比静态平色高得多。
 */
export function estimateMp4Bytes(): number {
  const p = appState.store.project;
  const px = p.resolution.w * p.resolution.h;
  const videoBitrate = px <= 1280 * 720 ? 8_000_000 : px <= 1920 * 1080 ? 16_000_000 : 32_000_000;
  const audioBitrate = hasAudioClips() ? 192_000 : 0;
  const seconds = Math.max(1 / p.fps, p.duration);
  return Math.round(((videoBitrate + audioBitrate) * seconds) / 8) + 1_000_000;
}

function hasAudioClips(): boolean {
  return appState.store.project.tracks.some((t) => t.enabled && t.kind === 'audio' && t.clips.length > 0);
}

/** 体积的可读文本。UI 与提示共用，避免两处格式不一致。 */
export function fmtSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function baseName(): string {
  return appState.store.project.name || 'artmatic';
}

/**
 * 本次导出的文件名（不含扩展名）。
 *
 * 由导出面板传入：面板里有一个可编辑的「文件名」输入框，默认取工程名。
 * 传空串/全是空白时回落到工程名 —— 一个只剩扩展名的下载文件（`.mp4`）
 * 是纯粹的困惑来源。
 */
function safeBase(name?: string): string {
  const n = (name ?? '').trim();
  return n || baseName();
}

/**
 * 导出 MP4（含音轨）。
 *
 * 混流在开跑之前做完，这样渲染循环里一次 `await` 都不用为音频分心，
 * 而且混流出的 PCM 长度与工程时长对齐，音视频时间戳共用一个 fps。
 */
export async function exportMp4(name?: string): Promise<void> {
  if (appState.exportProgress !== null) return;
  if (!mp4Supported()) {
    appState.flash(tr('err.export.noWebCodecs'), 'error');
    return;
  }

  const project = appState.store.project;
  const audio = mixdown(project, (id) => appState.player.buffer(id));
  if (audio && audio.peak < 1e-4) {
    // 全静音还给用户一个带音轨的 MP4，会让人以为混流坏了。
    appState.flash(tr('err.export.silentAudio'), 'info');
  }

  const ctrl = new AbortController();
  appState.exportAbort = ctrl;
  appState.exportProgress = 0;

  try {
    const sink = new Mp4Sink({ audio });
    const blob = (await runExport(appState.renderer, project, {
      sink,
      codec: MP4_CODEC,
      onProgress: (f) => {
        appState.exportProgress = f;
      },
      signal: ctrl.signal,
    })) as Blob;
    const size = fmtSize(blob.size);
    appState.flash(tr('err.export.mp4Done', { size }), 'success');
    await browserPlatform.download(blob, `${safeBase(name)}.mp4`);
  } catch (e) {
    if (!(e instanceof ExportCancelled)) {
      appState.flash(tr('err.export.failed', { detail: e instanceof Error ? e.message : String(e) }), 'error');
    }
  } finally {
    appState.exportProgress = null;
    appState.exportAbort = null;
  }
}

/** 导出 PNG 序列（zip）。重复调用是空操作。 */
export async function exportPngSequence(name?: string): Promise<void> {
  if (appState.exportProgress !== null) return;

  const ctrl = new AbortController();
  appState.exportAbort = ctrl;
  appState.exportProgress = 0;

  try {
    const blob = await runExport(appState.renderer, appState.store.project, {
      sink: new PngSequenceSink(),
      onProgress: (f) => {
        appState.exportProgress = f;
      },
      signal: ctrl.signal,
    });
    await browserPlatform.download(
      blob as Blob,
      `${safeBase(name)}-png.zip`,
    );
  } catch (e) {
    if (!(e instanceof ExportCancelled)) {
      appState.flash(tr('err.export.failed', { detail: e instanceof Error ? e.message : String(e) }), 'error');
    }
  } finally {
    appState.exportProgress = null;
    appState.exportAbort = null;
  }
}

/* ------------------------------------------------------------------- GIF */

/**
 * GIF 帧率档位。
 *
 * **全都能整除 100**，这是刻意的：GIF 的显示时长单位是厘秒，只有 `100 / n`
 * 是整数时逐帧时长才落得下。15fps 这种「整数、但不整除 100」的值每帧是 6.67cs，
 * 无论怎么取整都会漂（见 `gif-plan.ts::gifFrameDelays`）。
 */
export const GIF_FPS_CHOICES = [10, 12.5, 20, 25] as const;

/**
 * GIF 宽度档位（像素）。
 *
 * 上限只到 640：GIF 体积随像素数线性涨，而它是**发出去给人看**的格式，
 * 再宽就该用 MP4 了。高度按工程宽高比换算 —— 竖屏工程选 480 得到的是
 * 480×853，不是 480×270。
 */
export const GIF_WIDTH_CHOICES = [240, 360, 480, 640] as const;

/** 默认档位：480px 宽 @ 12.5fps。480 在聊天窗口里够看，12.5 恰好是 8cs/帧。 */
export const GIF_DEFAULT_FPS = 12.5;
export const GIF_DEFAULT_WIDTH = 480;

/** 调色板上限。GIF 的格式上限就是 256；给个常量只是为了让调用点能读懂。 */
export const GIF_MAX_COLORS = 256;

/** GIF 导出的参数。三项都能在导出面板上改。 */
export interface GifOptions {
  /** 目标帧率。应当取 `GIF_FPS_CHOICES` 里的值（理由见那个常量）。 */
  fps: number;
  /** 目标宽度（像素）。高度按工程宽高比换算。 */
  width: number;
  /**
   * 只导出工程时间轴上的这一段（秒）。省略 = 整段。
   *
   * 这是 GIF 最实用的一个旋钮：体积与「时长 × 面积」成正比，而一段 24 秒的
   * 片子往往只有几秒值得发出去。**不用自己 clamp** —— `gifPlan` 会夹。
   */
  range?: { start: number; end: number };
}

/**
 * 按当前工程算一份 GIF 导出计划。
 *
 * 面板上的尺寸 / 帧数 / 体积提示，与导出本身，共用这一个入口 ——
 * 两边各算一遍的 bug 形态是「提示说 12.5fps 300 帧，导出来是别的数」。
 */
export function gifPlan(opts: GifOptions): GifPlan {
  const p = appState.store.project;
  return planGif({
    srcSize: p.resolution,
    srcFps: p.fps,
    duration: p.duration,
    range: opts.range,
    width: opts.width,
    fps: opts.fps,
  });
}

/**
 * 跑完一条真实的 GIF 导出，回传产物。
 *
 * 只做编码：不写 appState 的进度、不触发下载 —— 这样 `exportGif` 那边只剩编排
 * （进度 / 取消 / 下载），而 page 内的 E2E 探针也能直接拿到字节，不必再走一遍
 * 「算 plan → 建 sink → runExport」那套（那样测的就不是面板走的那条路了）。
 */
export async function gifBlob(
  opts: GifOptions,
  hooks: { onProgress?: (frac: number) => void; signal?: AbortSignal } = {},
): Promise<Blob> {
  const plan = gifPlan(opts);
  return (await runExport(appState.renderer, appState.store.project, {
    sink: new GifSink({
      width: plan.size.w,
      height: plan.size.h,
      maxColors: GIF_MAX_COLORS,
      delaysMs: plan.delaysMs,
      loop: 0, // 无限循环：GIF 的默认预期，也是各平台上的实际行为
    }),
    codec: GIF_SINK_CODEC,
    size: plan.size,
    frameStep: plan.frameStep,
    // 区间用帧号传：秒 → 帧号的换算只有 gif-plan 那一处，面板的帧数与
    // 真正渲的帧数因此不可能各算一套。
    frameRange: plan.frameRange,
    // 量化是纯 CPU 的（每帧几十毫秒），默认的「10 帧让渡一次」会让取消按钮
    // 半秒才响应。理由见 ExportOptions.yieldEvery。
    yieldEvery: 1,
    onProgress: hooks.onProgress,
    signal: hooks.signal,
  })) as Blob;
}

/** 导出 GIF。重复调用是空操作。 */
export async function exportGif(name: string | undefined, opts: GifOptions): Promise<void> {
  if (appState.exportProgress !== null) return;

  const ctrl = new AbortController();
  appState.exportAbort = ctrl;
  appState.exportProgress = 0;

  try {
    const blob = await gifBlob(opts, {
      onProgress: (f) => {
        appState.exportProgress = f;
      },
      signal: ctrl.signal,
    });
    appState.flash(tr('err.export.gifDone', { size: fmtSize(blob.size) }), 'success');
    await browserPlatform.download(blob, `${safeBase(name)}.gif`);
  } catch (e) {
    if (!(e instanceof ExportCancelled)) {
      appState.flash(tr('err.export.failed', { detail: e instanceof Error ? e.message : String(e) }), 'error');
    }
  } finally {
    appState.exportProgress = null;
    appState.exportAbort = null;
  }
}

export function cancelExport(): void {
  appState.exportAbort?.abort();
}

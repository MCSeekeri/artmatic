/**
 * export.ts — 导出动作。从 Transport 抽出来，因为触发入口搬进了窄侧栏。
 *
 * 保留原有的全部语义：导出期间禁二次触发、进度写 appState（底栏与侧栏面板
 * 都读它）、可取消。导出本身走 exporters/ 的紧循环，这里只管编排与下载。
 *
 * 两种格式（ADR-001）：
 *   mp4   WebCodecs 编码 + mediabunny 封装，含音轨。**主路径**。
 *   png   PNG 序列 zip。永远可用的逃生舱 —— 浏览器不支持 H.264 时它仍在，
 *         而且「帧要一张张交给达芬奇 / Cavalry」本身就是正当用途。
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
import { mixdown } from '../exporters/mixdown';
import { browserPlatform } from '../platform/browser';

export type ExportFormat = 'mp4' | 'png';

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
 * 导出 MP4（含音轨）。
 *
 * 混流在开跑之前做完，这样渲染循环里一次 `await` 都不用为音频分心，
 * 而且混流出的 PCM 长度与工程时长对齐，音视频时间戳共用一个 fps。
 */
export async function exportMp4(): Promise<void> {
  if (appState.exportProgress !== null) return;
  if (!mp4Supported()) {
    appState.flash('本机浏览器不支持 WebCodecs，请改用 PNG 序列导出', 'error');
    return;
  }

  const project = appState.store.project;
  const audio = mixdown(project, (id) => appState.player.buffer(id));
  if (audio && audio.peak < 1e-4) {
    // 全静音还给用户一个带音轨的 MP4，会让人以为混流坏了。
    appState.flash('音轨混流结果是静音，本次只导出画面', 'info');
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
    appState.flash(`已导出 MP4 · ${size}`, 'success');
    await browserPlatform.download(blob, `${baseName()}.mp4`);
  } catch (e) {
    if (!(e instanceof ExportCancelled)) {
      appState.flash(`导出失败：${e instanceof Error ? e.message : String(e)}`, 'error');
    }
  } finally {
    appState.exportProgress = null;
    appState.exportAbort = null;
  }
}

/** 导出 PNG 序列（zip）。重复调用是空操作。 */
export async function exportPngSequence(): Promise<void> {
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
      `${baseName()}-png.zip`,
    );
  } catch (e) {
    if (!(e instanceof ExportCancelled)) {
      appState.flash(`导出失败：${e instanceof Error ? e.message : String(e)}`, 'error');
    }
  } finally {
    appState.exportProgress = null;
    appState.exportAbort = null;
  }
}

export function cancelExport(): void {
  appState.exportAbort?.abort();
}

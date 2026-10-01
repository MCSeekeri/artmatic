/**
 * export.ts — 导出动作。从 Transport 抽出来，因为触发入口搬进了窄侧栏。
 *
 * 保留原有的全部语义：导出期间禁二次触发、进度写 appState（底栏与侧栏面板
 * 都读它）、可取消。导出本身走 exporters/ 的紧循环，这里只管编排与下载。
 */

import { appState } from './app-state.svelte';
import { ExportCancelled, runExport } from '../exporters/export-runner';
import { PngSequenceSink } from '../exporters/png-sequence';
import { browserPlatform } from '../platform/browser';

/** 本次导出会产出多少帧。帧率来自工程（renderer 与导出共用同一个值）。 */
export function totalFrames(): number {
  const p = appState.store.project;
  return Math.max(1, Math.ceil(p.duration * p.fps));
}

export function isExporting(): boolean {
  return appState.exportProgress !== null;
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
      `${appState.store.project.name || 'artmatic'}-png.zip`,
    );
  } catch (e) {
    if (!(e instanceof ExportCancelled)) {
      appState.flash(`导出失败：${e instanceof Error ? e.message : String(e)}`);
    }
  } finally {
    appState.exportProgress = null;
    appState.exportAbort = null;
  }
}

export function cancelExport(): void {
  appState.exportAbort?.abort();
}

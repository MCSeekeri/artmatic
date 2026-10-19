/**
 * package-actions.ts — 工程面板的「打包 / 导入工程包」两个动作。
 *
 * 打包走 `platform.saveStream`（FSA 流式写），内存峰值与包大小无关；
 * 导入先校验清单与 CRC，再落到用户选的空目录，最后按普通工程打开。
 */

import { appState } from './app-state.svelte';
import { platform } from '../platform/index';
import { packProject, unpackProject } from '../project/package';
import { hasDirectoryPicker, isNativeBacked, pickDirectory } from '../project/fs';
import { keyForHandle, putHandle } from '../project/handles';
import { openProjectDirectory } from './project-actions';
import { formatBytes } from '../core/format';
import { tr } from '../i18n/index.svelte';

function msg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function safeName(name: string): string {
  const base = name.replace(/[\\/:*?"<>|]+/g, '_').trim();
  return base || 'project';
}

/**
 * 打包当前工程（收集全部未移除素材，含「未使用素材」）。
 *
 * 流式写：素材是一个一个从 `AssetStore.open()` 捞出来直接进 ZIP 的，
 * 不经过「先做一份完整 Blob」那一步。
 */
export async function packProjectNow(): Promise<boolean> {
  if (!appState.hasProject || appState.projectBusy) return false;
  const p = appState.activeProject;
  const filename = `${safeName(p.store.project.name)}.artmatic`;

  appState.flash(tr('app.packing'), 'info');
  appState.projectBusy = true;
  try {
    const stream = await platform.saveStream({
      suggestedName: filename,
      description: tr('app.packDescription'),
      mime: 'application/zip',
      ext: '.artmatic',
    });
    if (!stream) {
      appState.flash(tr('app.packNoStream'), 'error');
      return false;
    }
    const report = await packProject({
      project: p.store.project,
      store: p.assets,
      sink: (chunk) => stream.write(chunk),
    });
    await stream.close();
    if (report.missing.length) {
      appState.flash(
        tr('app.packedWithMissing', {
          n: report.missing.length,
          names: report.missing.slice(0, 3).join('、'),
        }),
        'info',
      );
    } else {
      appState.flash(tr('app.packed', { n: report.assets, size: formatBytes(report.bytes) }), 'success');
    }
    return true;
  } catch (e) {
    appState.flash(tr('app.packFailed', { detail: msg(e) }), 'error');
    return false;
  } finally {
    appState.projectBusy = false;
  }
}

/**
 * 导入一个 `.artmatic` 包：选包 → 选空目录 → 校验并解包 → 按普通工程打开。
 *
 * **不自动执行包里的插件**：`unpackProject` 只会跳过并告警。
 */
export async function importProjectPackage(): Promise<boolean> {
  if (appState.projectBusy) return false;
  if (!hasDirectoryPicker()) {
    appState.flash(tr('err.platform.openDirUnsupported'), 'error');
    return false;
  }
  const picked = await platform.pickArchiveFile();
  if (!picked) return false;
  const dest = await pickDirectory({ mode: 'readwrite', id: 'artmatic-import' });
  if (!dest) return false;

  appState.projectBusy = true;
  try {
    // 目标目录已有一份工程就不覆盖：用户很可能选错了目录。
    const existing = await dest.dir.list().catch(() => []);
    if (existing.some((i) => i.name === 'project.json' && i.kind === 'file')) {
      appState.flash(tr('app.importNotEmpty'), 'error');
      return false;
    }
    appState.flash(tr('app.importingPack'), 'info');
    const res = await unpackProject(picked.blob, dest.dir);
    const key = await keyForHandle(dest.raw, dest.dir.name);
    if (isNativeBacked(dest.dir)) await putHandle(key, dest.raw);
    const ok = await openProjectDirectory(dest.dir, { raw: dest.raw, key });
    if (ok) {
      appState.flash(tr('app.imported', { name: res.project.name, n: res.assets }), 'success');
      for (const w of res.warnings.slice(0, 2)) appState.flash(w, 'info');
    }
    return ok;
  } catch (e) {
    appState.flash(tr('app.importPackFailed', { detail: msg(e) }), 'error');
    return false;
  } finally {
    appState.projectBusy = false;
  }
}

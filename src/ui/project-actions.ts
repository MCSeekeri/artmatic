/**
 * project-actions.ts — 工程级动作（新建 / 打开 / 保存 / 另存为 / 最近工程）。
 *
 * 这一层是**唯一**把「磁盘上的工程」和「内存里的 store」接起来的地方。
 * 分出来的理由：`project/` 里的模块刻意不认识 appState（那是 UI 状态），
 * 而 UI 组件不该知道 `assets/` 怎么同步、句柄怎么存。两边都靠这层汇合。
 *
 * ## 新建 / 打开 = 再开一份，不是替换
 *
 * 顶栏的选项卡就是工程，所以这两个动作都走 `appState.adoptProject()` ——
 * 装配出一份**新的** `OpenProject` 挂上去并激活它，原来那些一份不动。
 * 装配顺序刻意是「先把素材读进来，再登记」：读盘失败时不会在选项卡上
 * 留下一个半成品工程。
 */

import { appState } from './app-state.svelte';
import { createAssetStore, type AssetStore } from '../project/asset-store';
import { NotAProjectError, openProject, saveProject } from '../project/io';
import {
  adoptNativeDir,
  hasDirectoryPicker,
  pickDirectory,
  queryPermission,
  requestPermission,
  type FsDirHandle,
} from '../project/fs';
import {
  getHandle,
  keyForHandle,
  listRecentProjects,
  putHandle,
  rememberProject,
  type ProjectRef,
} from '../project/handles';
import { ProjectStore } from '../core/project-store';
import { createBlankProject, createDemoProject, DEMO_ASSET_ID } from '../core/demo-project';
import { renderDemoAudio } from '../audio/demo-audio';
import { decodeAudio, computeWaveform } from '../audio/decode';
import { mimeForImageFilename, putImageBytes } from '../typography/image-assets';

function msg(e: unknown): string {
  if (e instanceof NotAProjectError) return e.message;
  return e instanceof Error ? e.message : String(e);
}

/** 启动时填充最近工程列表。**不做自动打开**：那需要用户手势，做不到。 */
export function refreshRecentProjects(): void {
  appState.recentProjects = listRecentProjects();
}

/* ------------------------------------------------------------ 新建 */

/**
 * 把演示工程依赖的「程序生成素材」登记进某个素材仓。
 *
 * 这些素材由代码确定性重放，所以不落盘（`mode: 'generated'`），
 * 而且因为 id 固定、生成确定，**多份 demo 工程共用同一条**没问题。
 */
export function registerDemoAssets(target: AssetStore = appState.assets): void {
  target.putGenerated(DEMO_ASSET_ID, {
    kind: 'audio',
    name: '演示节拍 120 BPM',
    originName: 'demo-song',
  });
}

/**
 * 在同一页里**再开一份**工程并激活它。
 *
 * 新工程没有盘上位置（`dir: null`）、也从未保存过（`savedVersion: -1`），
 * 所以它一出现就是「脏」的 —— 这正是我们想要的：用户必须主动决定存到哪里。
 */
export async function newProject(demo = false): Promise<void> {
  if (appState.projectBusy) return;
  const store = new ProjectStore(demo ? createDemoProject() : createBlankProject());
  appState.adoptProject({
    store,
    savedVersion: -1,
    savedAt: 0,
  });

  if (demo) {
    // 音频是程序生成的，解码一次给播放器与波形。id 固定，所以多份 demo 共用。
    registerDemoAssets();
    const buf = await renderDemoAudio();
    appState.player.register(DEMO_ASSET_ID, buf);
    appState.waveforms = { ...appState.waveforms, [DEMO_ASSET_ID]: await computeWaveform(buf) };
  }

  appState.flash(demo ? '已新开一份演示工程（尚未保存到磁盘）' : '已新开一份空白工程（尚未保存到磁盘）');
}

/* ------------------------------------------------------------ 打开 */

/** 打开一份工程并把它**挂到选项卡上**（原来是替换当前那份，现在是多开）。 */
async function openAt(dir: FsDirHandle, raw: unknown, key?: string): Promise<boolean> {
  appState.projectBusy = true;
  try {
    const res = await openProject(dir);

    // 先把素材读回来，再登记 —— 读盘失败时不会在顶栏留下一个半成品 tab。
    const store = new ProjectStore(res.project);
    const assetStore = createAssetStore();
    const loaded = await assetStore.loadFrom(dir, res.ledger, res.project);

    const k = key ?? (await keyForHandle(raw, dir.name));
    if (raw) await putHandle(k, raw);

    appState.adoptProject({
      store,
      assets: assetStore,
      dir,
      key: k,
      savedVersion: store.version,
      savedAt: Date.now(),
      issues: res.issues,
    });
    await hydrateRenderAssets(assetStore);

    appState.recentProjects = rememberProject({
      key: k,
      name: dir.name,
      openedAt: Date.now(),
      assetCount: Object.keys(res.ledger.entries).length,
    });

    // 只数 error 级的：info 级的（unhashed / untracked）是提示不是故障，
    // 每次都弹一句「有 N 个问题」会让真正该看的 missing 被淹没。
    const problems = res.issues.filter((i) => i.severity === 'error').length;
    if (problems) {
      appState.flash(`已打开「${dir.name}」，但有 ${problems} 个素材找不到 —— 见「工程」面板`, 'error');
    } else {
      appState.flash(`已打开「${dir.name}」 · ${loaded.loaded} 个素材`, 'success');
    }
    return true;
  } catch (e) {
    appState.flash(`打开失败：${msg(e)}`, 'error');
    return false;
  } finally {
    appState.projectBusy = false;
  }
}

/** 选一个目录打开（新开一份，不关掉现有的）。 */
export async function openProjectPicker(): Promise<boolean> {
  if (appState.projectBusy) return false;
  if (!hasDirectoryPicker()) {
    appState.flash('这个浏览器不支持打开本地目录（需要 Chrome / Edge）', 'error');
    return false;
  }
  const picked = await pickDirectory({ mode: 'readwrite', id: 'artmatic-open' });
  if (!picked) return false;
  return openAt(picked.dir, picked.raw);
}

/**
 * 打开一个**已经拿到的**目录句柄（不弹选择器）。
 *
 * 存在的理由是 E2E：`showDirectoryPicker` 是系统对话框，自动化驱动不了，
 * 而 OPFS 的根目录句柄是同一个 `FileSystemDirectoryHandle` 类型。
 * 于是测试可以 `navigator.storage.getDirectory()` 拿一个真目录喂进来，
 * 走的是与生产完全相同的代码路径 —— 不是 mock。
 */
export async function openProjectDirectory(
  dir: FsDirHandle,
  opts: { raw?: unknown; key?: string } = {},
): Promise<boolean> {
  return openAt(dir, opts.raw ?? null, opts.key);
}

/**
 * 把某个目录句柄接成**当前工程**的位置，之后保存直接写它。
 *
 * E2E 用它把 OPFS 的子目录喂进来（`showDirectoryPicker` 驱动不了），
 * 也预留给将来真正的「另存到此处」动作。
 */
export function attachProjectDirectory(dir: FsDirHandle, key: string): void {
  appState.projectDir = dir;
  appState.projectKey = key;
}

/** 从最近工程列表恢复（新开一份）。 */
export async function openRecentProject(ref: ProjectRef): Promise<boolean> {
  if (appState.projectBusy) return false;
  const raw = await getHandle(ref.key);
  if (!raw) {
    appState.flash(`「${ref.name}」的访问凭据已失效，请用「打开工程」重新选择目录`, 'error');
    return false;
  }
  const dir = adoptNativeDir(raw);
  // 这里是**唯一在用户手势里**调 requestPermission 的地方 —— 新会话里
  // 句柄的权限多半已降级成 'prompt'，只有点击能把它申请回来。
  if ((await queryPermission(dir, 'readwrite')) !== 'granted') {
    const state = await requestPermission(dir, 'readwrite');
    if (state !== 'granted') {
      appState.flash(`没有拿到「${ref.name}」的访问权限`, 'error');
      return false;
    }
  }
  return openAt(dir, raw, ref.key);
}

/* ------------------------------------------------------------ 保存 */

/**
 * 保存**当前激活的那份**工程。
 *
 * 注意所有 `appState.*` 都是转发到激活工程的 getter/setter ——
 * 保存的是前台那一份，不会误写到后台的工程上。
 */
async function writeTo(dir: FsDirHandle, key: string): Promise<boolean> {
  appState.projectBusy = true;
  try {
    const ledger = await appState.assets.buildLedger();
    const report = await saveProject({
      dir,
      project: appState.store.project,
      ledger,
      bytesFor: (id) => appState.assets.get(id),
    });

    appState.projectDir = dir;
    appState.projectKey = key;
    appState.savedVersion = appState.store.version;
    appState.savedAt = Date.now();
    appState.recentProjects = rememberProject({
      key,
      name: dir.name,
      openedAt: Date.now(),
      assetCount: Object.keys(ledger.entries).length,
    });

    // 保存成功了，但带着警告 —— 用中性的 info 而不是绿色：
    // 绿字会说「一切都好」，而这里有东西需要看。
    if (report.warnings.length) {
      appState.flash(`已保存（${report.warnings.length} 条警告）：${report.warnings[0]}`);
    } else {
      appState.flash(
        `已保存 · ${report.assetsWritten} 个素材 · ${(report.project.bytes / 1024).toFixed(1)} KB · ${report.durationMs} ms`,
        'success',
      );
    }
    return true;
  } catch (e) {
    appState.flash(`保存失败：${msg(e)}`, 'error');
    return false;
  } finally {
    appState.projectBusy = false;
  }
}

/** 另存为：选一个新目录（或已有目录，会覆盖其中的工程文件）。 */
export async function saveProjectAs(): Promise<boolean> {
  if (appState.projectBusy) return false;
  if (!hasDirectoryPicker()) {
    appState.flash('这个浏览器不支持保存到本地目录（需要 Chrome / Edge）', 'error');
    return false;
  }
  const picked = await pickDirectory({ mode: 'readwrite', id: 'artmatic-save' });
  if (!picked) return false;
  const key = await keyForHandle(picked.raw, picked.dir.name);
  await putHandle(key, picked.raw);
  return writeTo(picked.dir, key);
}

/** 保存。没有位置时自动走「另存为」—— 第一次保存本来就要问位置。 */
export async function saveProjectNow(): Promise<boolean> {
  if (appState.projectBusy) return false;
  const dir = appState.projectDir;
  const key = appState.projectKey;
  if (!dir || !key) return saveProjectAs();
  return writeTo(dir, key);
}

/* ------------------------------------------------------- 渲染期素材恢复 */

/**
 * 把某个素材仓里的字节重新变成「能画出来的东西」。
 *
 * 持久化层存的是字节，渲染层要的是 objectURL / AudioBuffer，两者之间
 * 必须有一次重建。**单条素材解不开不中断整个流程**：画面照旧能开，
 * 只是那一条没声音/不显示，而 `issues` 里通常已经有记录了。
 */
async function hydrateRenderAssets(store: AssetStore): Promise<void> {
  for (const id of store.ids()) {
    const bytes = store.get(id);
    const input = store.input(id);
    if (!bytes || !input) continue;

    if (input.kind === 'image') {
      putImageBytes(id, bytes.slice().buffer as ArrayBuffer, mimeForImageFilename(input.originName));
      continue;
    }

    if (input.kind === 'audio') {
      try {
        // slice() 是为了给 decodeAudio 一份可被 detach 的拷贝：
        // 它会把传进去的 ArrayBuffer 用掉，而素材仓里那份还要留着保存。
        const buf = await decodeAudio(bytes.slice().buffer as ArrayBuffer);
        appState.player.register(id, buf);
        appState.waveforms = { ...appState.waveforms, [id]: await computeWaveform(buf) };
      } catch {
        /* 见函数头：单条失败不挡打开 */
      }
    }
  }
}

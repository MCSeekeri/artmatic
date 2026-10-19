/**
 * platform/browser.ts — Platform 的浏览器实现。
 *
 * 文件选择走 <input type="file">，下载走 anchor + objectURL；
 * saveProject 优先 File System Access（Chromium），回退 anchor 下载。
 */

import { tr } from '../i18n/index.svelte';
import type { MachineCapacity } from '../core/capacity';
import type {
  ClipboardWriteResult,
  PickedFile,
  PickedLinked,
  PickedVideo,
  Platform,
  SaveStream,
} from './types';

/**
 * `showSaveFilePicker` 的最小类型。
 *
 * 刻意不依赖 `lib.dom` 里那套实验版本：它在不同 TS 版本里时有时无，
 * 而这里只用得到两个方法（与 `saveProject` 里那份同源，只是那次是内联的）。
 */
interface WritableFileLike {
  write(chunk: unknown): Promise<void>;
  close(): Promise<void>;
  abort?(reason?: unknown): Promise<void>;
}
interface SaveHandleLike {
  name?: string;
  createWritable(): Promise<WritableFileLike>;
}
type SavePicker = (opts: unknown) => Promise<SaveHandleLike>;

function savePicker(): SavePicker | null {
  const p = (window as unknown as Record<string, unknown>).showSaveFilePicker as SavePicker | undefined;
  return typeof p === 'function' ? p : null;
}

/**
 * `ClipboardItem` 的最小类型。
 *
 * 与 `showSaveFilePicker` 那份同样的理由：`lib.dom` 里这个类在不同 TS 版本里
 * 时有时无，而这里只用得到一个构造签名（`{ 'image/png': blob }`）。
 * 运行期还必须是**函数**才算数 —— Firefox 早期版本是有的、但只认文本。
 */
interface ClipboardItemCtor {
  new (items: Record<string, Blob>): unknown;
}

interface ClipboardLike {
  write?(items: unknown[]): Promise<void>;
}

function clipboardItemCtor(): ClipboardItemCtor | null {
  const c = (window as unknown as Record<string, unknown>).ClipboardItem as ClipboardItemCtor | undefined;
  return typeof c === 'function' ? c : null;
}

/** 选一个文件，**保留 `File` 句柄**（不读字节）。视频那条路要用它。 */
function pickFileHandle(accept: string): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.onchange = () => resolve(input.files?.[0] ?? null);
    // 用户取消时部分浏览器不发任何事件——focus 回来视为取消。
    window.addEventListener('focus', () => setTimeout(() => resolve(null), 400), { once: true });
    input.click();
  });
}

function pick(accept: string): Promise<PickedFile | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return resolve(null);
      resolve({ name: file.name, data: await file.arrayBuffer() });
    };
    // 用户取消时部分浏览器不发任何事件——focus 回来视为取消。
    window.addEventListener('focus', () => setTimeout(() => resolve(null), 400), { once: true });
    input.click();
  });
}

/** 多选版本。字体一次导入多款（常规 + 粗体）是常态，单选太磨人。 */
function pickMany(accept: string): Promise<PickedFile[] | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = true;
    input.accept = accept;
    input.onchange = async () => {
      const files = Array.from(input.files ?? []);
      if (!files.length) return resolve(null);
      const out: PickedFile[] = [];
      for (const f of files) out.push({ name: f.name, data: await f.arrayBuffer() });
      resolve(out);
    };
    window.addEventListener('focus', () => setTimeout(() => resolve(null), 400), { once: true });
    input.click();
  });
}

/* ------------------------------------------------------ 引用式（linked） */

interface OpenFileHandleLike {
  name: string;
  getFile(): Promise<File>;
}
type OpenFilePicker = (opts: unknown) => Promise<OpenFileHandleLike[]>;

function openFilePicker(): OpenFilePicker | null {
  const p = (window as unknown as Record<string, unknown>).showOpenFilePicker as OpenFilePicker | undefined;
  return typeof p === 'function' ? p : null;
}

const LINK_ACCEPT: Record<'audio' | 'image' | 'video', Record<string, string[]>> = {
  audio: { 'audio/*': ['.mp3', '.wav', '.ogg', '.m4a', '.flac'] },
  image: { 'image/*': ['.png', '.jpg', '.jpeg', '.webp', '.gif', '.avif'] },
  video: { 'video/*': ['.mp4', '.m4v', '.mov', '.webm', '.mkv'] },
};

async function pickLinked(kind: 'audio' | 'image' | 'video'): Promise<PickedLinked | null> {
  const picker = openFilePicker();
  // 没有 showOpenFilePicker（Firefox/Safari）就没有可持久化的句柄：
  // 返回 null，让调用方明确退回 bundled，而不是假装「引用成功」。
  if (!picker) return null;
  try {
    const [h] = await picker({ multiple: false, types: [{ accept: LINK_ACCEPT[kind] }] });
    if (!h) return null;
    const file = await h.getFile();
    return {
      kind,
      name: file.name,
      file,
      handle: h,
      path: null,
      size: file.size,
    };
  } catch (e) {
    if ((e as { name?: string }).name === 'AbortError') return null;
    throw e;
  }
}

export const browserPlatform: Platform = {
  pickAudioFile: () => pick('audio/*'),
  pickImageFile: () => pick('image/*'),
  pickLinkedFile: pickLinked,
  /*
   * 在装配时固定：`showOpenFilePicker` 不会中途出现/消失，逐次判断只会
   * 让「取消」与「不支持」两条路混在一起。
   *
   * **自动化浏览器里强制走 bundled**：Playwright 驱动不了系统文件对话框
   * （`waitForEvent('filechooser')` 只认 `<input>`）。真用户拿到 linked，
   * E2E 拿到它一直在测的 `<input>` 路径 —— linked 的行为由
   * `linked-assets.spec.ts` 用 OPFS 句柄单独覆盖。
   */
  supportsLinked: openFilePicker() !== null && !navigator.webdriver,
  async pickVideoFile(): Promise<PickedVideo | null> {
    const file = await pickFileHandle('video/*,.mp4,.m4v,.mov,.webm,.mkv');
    return file ? { name: file.name, file, size: file.size } : null;
  },
  pickFontFiles: () => pickMany('.ttf,.otf,.woff,.woff2,font/ttf,font/otf,font/woff2'),
  pickPluginFile: () => pick('.js,text/javascript'),
  pickArchiveFile: () =>
    new Promise((resolve) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.artmatic,application/zip';
      input.onchange = () => {
        const f = input.files?.[0];
        resolve(f ? { name: f.name, blob: f } : null);
      };
      window.addEventListener('focus', () => setTimeout(() => resolve(null), 400), { once: true });
      input.click();
    }),

  async download(blob: Blob, filename: string): Promise<void> {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  },

  /**
   * 写一张 PNG 到系统剪贴板。
   *
   * 三条边界都要分得清（返回值见 `ClipboardWriteResult`）：
   *  - 没有 `ClipboardItem` / 没有 `clipboard.write`（非安全上下文、老浏览器）
   *    → `unsupported`，调用方回退下载；
   *  - `NotAllowedError`（权限被拒、或不在用户手势里）→ `denied`；
   *  - 其余异常（例如 Chromium 对不支持的图片类型抛 TypeError）→ `failed`。
   *
   * **不在这里回退下载**：平台层只报事实，「回退成什么」是 UI 的决定
   * （它还要跟着报一句为什么）。
   */
  async writeImageToClipboard(blob: Blob): Promise<ClipboardWriteResult> {
    const Ctor = clipboardItemCtor();
    const clip = navigator.clipboard as ClipboardLike | undefined;
    if (!Ctor || typeof clip?.write !== 'function') return 'unsupported';
    try {
      await clip.write([new Ctor({ 'image/png': blob })]);
      return 'ok';
    } catch (e) {
      return (e as { name?: string } | null)?.name === 'NotAllowedError' ? 'denied' : 'failed';
    }
  },

  /**
   * 写一段文本进系统剪贴板（片段复制 / 剪切）。
   *
   * 与 `writeImageToClipboard` 同一条约束（必须在用户手势里）与同一套返回值，
   * 但**失败不是终点**：调用方同时留了一份内存副本，写不进去也照样能在本
   * 应用内粘贴（跨标签页不行，那本来也做不到）。
   */
  async writeTextToClipboard(text: string): Promise<ClipboardWriteResult> {
    const clip = navigator.clipboard as ({ writeText?: (t: string) => Promise<void> }) | undefined;
    if (typeof clip?.writeText !== 'function') return 'unsupported';
    try {
      await clip.writeText(text);
      return 'ok';
    } catch (e) {
      return (e as { name?: string } | null)?.name === 'NotAllowedError' ? 'denied' : 'failed';
    }
  },

  async saveProject(json: string, suggestedName: string): Promise<void> {
    const blob = new Blob([json], { type: 'application/json' });
    const picker = savePicker();
    if (picker) {
      try {
        const handle = await picker({
          suggestedName,
          types: [{ description: tr('proj.filePickerDescription'), accept: { 'application/json': ['.json'] } }],
        });
        const w = await handle.createWritable();
        await w.write(blob);
        await w.close();
        return;
      } catch {
        return; // 用户取消
      }
    }
    await this.download(blob, suggestedName);
  },

  async openProject(): Promise<{ name: string; json: string } | null> {
    const file = await pick('.json,application/json');
    if (!file) return null;
    return { name: file.name, json: new TextDecoder().decode(file.data) };
  },

  /**
   * 问开发/预览服务端要机器能力。**任何异常都返回 null**（纯静态部署时这个路由
   * 根本不存在，`fetch` 会拿到 SPA fallback 的 HTML → `json()` 抛错）。
   *
   * 超时给 2 s：首次请求要在服务端 spawn `nvidia-smi` / `reg query`，
   * 而这条路径是**启动时后台跑的**，没有任何东西 await 它 —— 慢一点无所谓，
   * 但别因为超时把一次成功的探测丢掉（消费者是「用到时读」的）。
   */
  async probeCapacity(): Promise<{
    machine: MachineCapacity;
    overrides: Partial<Record<string, number>> | null;
  } | null> {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 2000);
      const res = await fetch('/__capacity.json', { signal: ctrl.signal, cache: 'no-store' });
      clearTimeout(timer);
      if (!res.ok) return null;
      const data = (await res.json()) as {
        machine?: MachineCapacity | null;
        overrides?: Partial<Record<string, number>> | null;
      };
      return data.machine ? { machine: data.machine, overrides: data.overrides ?? null } : null;
    } catch {
      return null;
    }
  },

  /**
   * 流式落盘：FSA 保存对话框 → `createWritable()`。
   *
   * 三个刻意的选择：
   *  - **必须由调用方在手势里调**（见 `Platform.saveStream` 的注释）；
   *  - 用户取消（`AbortError`）返回 null，与「环境不支持」同一个返回值：
   *    调用方对这两种情况的处理是一样的（回退或中止）；
   *  - **默认的 siloed 写入正合我意**：不 `close()` 就什么都不会落到目标文件上，
   *    所以「取消导出」天然不会毁掉用户已有的文件。
   */
  async saveStream(opts): Promise<SaveStream | null> {
    const picker = savePicker();
    if (!picker) return null;
    let handle: SaveHandleLike;
    try {
      handle = await picker({
        suggestedName: opts.suggestedName,
        types: [{ description: opts.description, accept: { [opts.mime]: [opts.ext] } }],
      });
    } catch {
      return null; // 用户取消 / 权限被拒 —— 都不是错误，回退即可
    }
    const w = await handle.createWritable();
    let closed = false;
    return {
      name: handle.name ?? opts.suggestedName,
      // mediabunny 的 StreamTarget 要的就是 {type:'write', data, position}，
      // 而 FSA 的 write(WriteParams) 是同一个形状 —— 官方文档点名两者兼容。
      writable: w as unknown as WritableStream,
      write: async (data) => {
        await w.write(data);
      },
      close: async () => {
        if (closed) return;
        closed = true;
        await w.close();
      },
      abort: async (reason) => {
        if (closed) return;
        closed = true;
        if (w.abort) await w.abort(reason);
      },
    };
  },
};

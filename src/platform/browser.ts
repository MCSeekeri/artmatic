/**
 * platform/browser.ts — Platform 的浏览器实现。
 *
 * 文件选择走 <input type="file">，下载走 anchor + objectURL；
 * saveProject 优先 File System Access（Chromium），回退 anchor 下载。
 */

import { tr } from '../i18n/index.svelte';
import type { MachineCapacity } from '../core/capacity';
import type { PickedFile, PickedVideo, Platform, SaveStream } from './types';

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

export const browserPlatform: Platform = {
  pickAudioFile: () => pick('audio/*'),
  pickImageFile: () => pick('image/*'),
  async pickVideoFile(): Promise<PickedVideo | null> {
    const file = await pickFileHandle('video/*,.mp4,.m4v,.mov,.webm,.mkv');
    return file ? { name: file.name, file, size: file.size } : null;
  },
  pickFontFiles: () => pickMany('.ttf,.otf,.woff,.woff2,font/ttf,font/otf,font/woff2'),
  pickPluginFile: () => pick('.js,text/javascript'),

  async download(blob: Blob, filename: string): Promise<void> {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
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

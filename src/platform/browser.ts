/**
 * platform/browser.ts — Platform 的浏览器实现。
 *
 * 文件选择走 <input type="file">，下载走 anchor + objectURL；
 * saveProject 优先 File System Access（Chromium），回退 anchor 下载。
 */

import type { PickedFile, Platform } from './types';

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

export const browserPlatform: Platform = {
  pickAudioFile: () => pick('audio/*'),
  pickImageFile: () => pick('image/*'),

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
    const picker = (window as unknown as Record<string, unknown>).showSaveFilePicker as
      | ((opts: unknown) => Promise<{ createWritable: () => Promise<{ write: (b: Blob) => Promise<void>; close: () => Promise<void> }> }>)
      | undefined;
    if (picker) {
      try {
        const handle = await picker({
          suggestedName,
          types: [{ description: 'Artmatic 工程', accept: { 'application/json': ['.json'] } }],
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
};

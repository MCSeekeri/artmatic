/**
 * platform/types.ts — 平台能力接口（硬约束 1.5：渲染件与 Electron 解耦）。
 *
 * 浏览器实现在 browser.ts；M5 加 electron.ts（IPC 版），接口不动。
 * 上层只 import 这个文件，具体实例由 main.ts 注入——
 * Electron 解耦靠这一个注入点守住。
 */

export interface PickedFile {
  name: string;
  data: ArrayBuffer;
}

export interface Platform {
  pickAudioFile(): Promise<PickedFile | null>;
  pickImageFile(): Promise<PickedFile | null>;
  /**
   * 多选字体文件。浏览器：`<input type=file multiple>`；
   * Electron（M5）：文件对话框 + IPC 读盘。
   *
   * 返回 null = 用户取消；返回空数组也当取消处理。**不在这里做格式过滤**：
   * 判断交给上层（HarfBuzz 只吃 SFNT，woff2 只能整体内联），
   * 在这里丢掉会让「为什么我选的字体没反应」变成一个哑谜。
   */
  pickFontFiles(): Promise<PickedFile[] | null>;
  /** 触发一次浏览器下载（Electron 版会是写文件对话框）。 */
  download(blob: Blob, filename: string): Promise<void>;
  saveProject(json: string, suggestedName: string): Promise<void>;
  openProject(): Promise<{ name: string; json: string } | null>;
}

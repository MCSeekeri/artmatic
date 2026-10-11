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

/**
 * 选中的视频文件。
 *
 * **刻意不给 `ArrayBuffer`，给 `File` 本身**：浏览器的 `File` 是磁盘背书的
 * 句柄，mediabunny 从它 seek 读，10 GB 素材也不会把堆撑爆。音频/图片那两条
 * 路顺手给了字节（它们本来就小，且要喂给 decodeAudioData / createImageBitmap），
 * 视频如果照抄就会在「导入一个 4 GB 素材」时直接 OOM —— 这是用户专门点名的
 * 那条性能问题，所以接口形状必须不一样。
 */
export interface PickedVideo {
  name: string;
  file: File;
  size: number;
}

export interface Platform {
  pickAudioFile(): Promise<PickedFile | null>;
  pickImageFile(): Promise<PickedFile | null>;
  /** 视频：只给句柄不给字节，见 `PickedVideo`。 */
  pickVideoFile(): Promise<PickedVideo | null>;
  /**
   * 多选字体文件。浏览器：`<input type=file multiple>`；
   * Electron（M5）：文件对话框 + IPC 读盘。
   *
   * 返回 null = 用户取消；返回空数组也当取消处理。**不在这里做格式过滤**：
   * 判断交给上层（HarfBuzz 只吃 SFNT，woff2 只能整体内联），
   * 在这里丢掉会让「为什么我选的字体没反应」变成一个哑谜。
   */
  pickFontFiles(): Promise<PickedFile[] | null>;
  /**
   * 选一个插件文件（`.js`）。
   *
   * 给**文件名**是必需的：导入失败时面板上总得有一行可看，那时还没读出
   * 清单里的 id（见 `plugins/host.ts` 的 `PluginImportOutcome`）。
   *
   * `accept` 只是给文件对话框的提示，**不在这一层做格式过滤** —— 与
   * `pickFontFiles` 同一条理由：在这里丢掉会让「我选的插件没反应」变成哑谜。
   */
  pickPluginFile(): Promise<PickedFile | null>;
  /** 触发一次浏览器下载（Electron 版会是写文件对话框）。 */
  download(blob: Blob, filename: string): Promise<void>;
  saveProject(json: string, suggestedName: string): Promise<void>;
  openProject(): Promise<{ name: string; json: string } | null>;
}

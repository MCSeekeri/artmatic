/**
 * platform/types.ts — 平台能力接口（硬约束 1.5：渲染件与 Electron 解耦）。
 *
 * 浏览器实现在 browser.ts；M5 加 electron.ts（IPC 版），接口不动。
 * 上层只 import 这个文件，具体实例由 main.ts 注入——
 * Electron 解耦靠这一个注入点守住。
 */

import type { MachineCapacity } from '../core/capacity';

export interface PickedFile {
  name: string;
  data: ArrayBuffer;
}

/**
 * 流式落盘的出口。
 *
 * 存在的理由只有一条：**导出的产物可能大于内存预算**。MP4 与 PNG 序列过去都是
 * 「整份屯在内存里 → 再交给下载」，几百帧就是几百 MB，标签页 OOM 会把没保存的
 * 编辑一起带走（见 `core/capacity.ts` 的 `exportMemoryMB`）。有了它，边编码边写盘，
 * 内存占用与时长无关。
 *
 * 两种形态都给，因为两个消费方的形状不同：
 *  - `writable`：mediabunny 的 `StreamTarget` 直接吃一个
 *    `WritableStream<{type:'write', data, position}>` —— FSA 的
 *    `FileSystemWritableFileStream` 恰好就是那个形状（官方文档点名支持）；
 *  - `write`/`close`/`abort`：PNG 序列的流式 zip 是「回调里塞字节」的形状。
 */
export interface SaveStream {
  /** 给 mediabunny `StreamTarget` 用。 */
  writable: WritableStream;
  /** 直接写一块（流式 zip 用）。 */
  write(data: Uint8Array): Promise<void>;
  /** 收尾。**不调它等于什么都没写**（FSA 的 siloed 写入只在 close 时落盘）。 */
  close(): Promise<void>;
  /** 放弃这次写入：目标文件保持原样。 */
  abort(reason?: unknown): Promise<void>;
  /** 用户选的最终文件名（可能被对话框改过）。 */
  name: string;
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

/**
 * 写图片到剪贴板的四种结果。
 *
 * 分开报而不是布尔值的理由：**调用方的下一步不一样**。
 * `unsupported` / `denied` 都回退成下载并说明原因（Firefox 与权限被拒是常态，
 * 不是错误），`failed` 才是「真的写坏了」。合成一个 false 的话，用户只会看到
 * 「截图失败」，而磁盘上连文件都没有。
 */
export type ClipboardWriteResult = 'ok' | 'unsupported' | 'denied' | 'failed';

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
  /**
   * 把一张 PNG 写进系统剪贴板。
   *
   * **必须在用户手势里调用**（与 `saveStream` 同一条约束）：`clipboard.write()`
   * 要求瞬时激活，绕一层 `setTimeout` 就会拿到 `NotAllowedError`。
   * 非安全上下文（http 域名）与不认 `ClipboardItem` 的浏览器返回 `unsupported`，
   * 由调用方回退到下载 —— 截图这件事在那些环境里**必须仍然可用**。
   */
  writeImageToClipboard(blob: Blob): Promise<ClipboardWriteResult>;
  saveProject(json: string, suggestedName: string): Promise<void>;
  openProject(): Promise<{ name: string; json: string } | null>;

  /**
   * 探测**宿主机器**的内存 / 显存容量。
   *
   * 浏览器里测不准（这是本节最重要的一条约束，别绕过它去读
   * `navigator.deviceMemory`）：真正的数字由开发/预览服务端的 Node 进程给出
   * （`scripts/capacity.mjs`）。**拿不到就返回 null**，由调用方退回保守默认 ——
   * 纯静态部署、或探测失败时，这条路径必须是可缺的而不是报错。
   */
  probeCapacity(): Promise<{ machine: MachineCapacity; overrides: Partial<Record<string, number>> | null } | null>;

  /**
   * 申请一个**流式**落盘出口（浏览器：FSA 保存对话框）。
   *
   * 返回 null = 这个环境没有这条能力（Firefox/Safari），调用方必须回退到
   * 「内存里屯完再下载」。**必须在用户手势里调用**（`showSaveFilePicker` 要求
   * 瞬时激活），所以调用方要在开始渲帧之前就把它要来。
   */
  saveStream(opts: {
    suggestedName: string;
    /** 保存对话框里那行说明（i18n 后的文案）。 */
    description: string;
    mime: string;
    /** 扩展名，带点，如 `.mp4`。 */
    ext: string;
  }): Promise<SaveStream | null>;
}

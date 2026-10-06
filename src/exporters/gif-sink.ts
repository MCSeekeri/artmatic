/**
 * gif-sink.ts — GIF 导出（gifenc：感知量化 + LZW）。
 *
 * ADR-001 的第三个后端。与 `webcodecs` 的根本差别：**浏览器没有 GIF 硬件编码**，
 * 所以这条链路是纯 CPU 的 —— 每帧一次 `drawImage` → `getImageData` → 量化 → LZW。
 * 这决定了它的定位：**分享 / 预览格式，不是交付格式**（256 色、无音轨、无 alpha）。
 * 交付走 MP4，需要逐帧精确走 PNG 序列。
 *
 * ## 为什么逐帧局部调色板，而不是一张全局调色板
 *
 * 全局调色板要先看完整段素材才能量化，于是只剩两条路：把所有帧的 RGBA 屯在内存里
 * （480×270×4×N 字节，几百帧就是几十 MB，1080p 直接爆），或者渲染两遍。
 * 局部调色板是**流式**的，内存与帧数无关。
 *
 * 代价是每帧多一张色表（256 色 = 768 字节）。对算法艺术 / 故障艺术这类
 * **逐帧色彩分布会剧变**的素材，这笔开销换来的质量提升是明显的：全局调色板在
 * 场景切换处会整片失色，局部调色板不会。这也正是 gifenc 把 `palette` 做成
 * 逐帧参数的原因。
 *
 * ## 尺寸与帧率不在这里决定
 *
 * 渲染分辨率由 `runExport` 的 `opts.size` 钉死（**渲染到目标尺寸**，不做事后
 * 重采样：既准 —— 少一次采样 —— 又省，像素少一个量级），抽帧由 `opts.frameStep`
 * 做。sink 只负责「收到的每一帧都写进 GIF」，以及那份逐帧延迟表（由调用方按实际
 * 抽帧间隔算好，见 `exporters/gif-plan.ts::gifFrameDelays`）。
 *
 * ## 已知取舍：量化在主线程
 *
 * 硬约束 1.4 说「主线程只做 rAF 与 uniform 写入」，而 480×270 的量化 + LZW 每帧
 * 要几十毫秒同步占用主线程。第一版**接受**这个代价，并用「每帧让渡一次」
 * （`runExport` 的 `yieldEvery: 1`）保证进度条与取消按钮的响应延迟 ≤ 一帧。
 * 真要挪走就得把 `GIFEncoder` 实例整个搬进 Worker（它是有状态的流），
 * 那是另一件事，别在这里半途而废。
 */

import { GIFEncoder, applyPalette, quantize, type GifEncoderInstance } from 'gifenc';
import type { FrameSink, FrameSinkConfigureOptions } from './frame-sink';
import { tr } from '../i18n/index.svelte';

/**
 * `FrameSink.configure` 的 codec 参数值。与 `MP4_SINK_CODEC` 同一个位置、同一个
 * 用途：**运行期校验**调用方真的把这一路的 sink 用在了这一路格式上。
 * 它不是什么编码器标识 —— GIF 没有可协商的编码参数。
 */
export const GIF_SINK_CODEC = 'gif';

/** `delaysMs` 没覆盖到的帧用这个兜底。100ms = 10cs，是 GIF 里最常见的默认延迟。 */
const FALLBACK_DELAY_MS = 100;

export interface GifSinkOptions {
  /** 输出宽高。必须与 `runExport` 钉的 `size` 一致（会交叉校验）。 */
  width: number;
  height: number;
  /**
   * 调色板上限，2..256。GIF 的格式上限就是 256，超过会被上游静默按 256 处理。
   * 调低能明显减小文件（色表变小 + 索引更集中），代价是色带。
   */
  maxColors?: number;
  /**
   * 逐帧延迟（毫秒），下标 = 输出帧序号。比实际帧数短时，多出的帧用
   * `FALLBACK_DELAY_MS`。
   */
  delaysMs?: number[];
  /** 循环次数：-1 = 播一次、0 = 无限、>0 = 额外轮数。默认 0（无限，GIF 的常态）。 */
  loop?: number;
}

export class GifSink implements FrameSink {
  private readonly w: number;
  private readonly h: number;
  private readonly maxColors: number;
  private readonly delays: number[];
  private readonly loop: number;

  private gif: GifEncoderInstance | null = null;
  /** 2D 暂存画布：WebGL canvas 取不到 `getImageData`，必须经它拷一次。 */
  private ctx: CanvasRenderingContext2D | null = null;
  /** 已写出的帧数。用来索引 `delays`，也是「零帧」判据。 */
  private written = 0;
  private outSize = { w: 0, h: 0 };

  constructor(opts: GifSinkOptions) {
    this.w = Math.max(2, Math.round(opts.width));
    this.h = Math.max(2, Math.round(opts.height));
    // 上游对 >256 的 maxColors 没有防护（会造出超过 256 项的表并写出越界索引），
    // 所以夹在这里，而不是指望调用方。
    this.maxColors = Math.min(256, Math.max(2, Math.round(opts.maxColors ?? 256)));
    this.delays = opts.delaysMs ?? [];
    this.loop = opts.loop ?? 0;
  }

  async configure(
    size: { w: number; h: number },
    _fps: number,
    codec: string,
    opts?: FrameSinkConfigureOptions,
  ): Promise<void> {
    if (codec !== GIF_SINK_CODEC) {
      throw new Error(tr('err.export.gifSinkCodec', { want: GIF_SINK_CODEC, got: codec }));
    }
    // 与 Mp4Sink 一样的交叉校验：声明尺寸与真实 canvas 不符时，产出的是一张
    // 内容错位 / 被拉伸的 GIF，而且没有任何提示。顺序错了就在这里炸。
    const canvas = opts?.canvas;
    if (canvas && (canvas.width !== this.w || canvas.height !== this.h)) {
      throw new Error(
        tr('err.export.canvasSizeMismatch', {
          cw: canvas.width,
          ch: canvas.height,
          dw: this.w,
          dh: this.h,
        }),
      );
    }
    this.outSize = size;

    this.gif = GIFEncoder();
    const staging = document.createElement('canvas');
    staging.width = this.w;
    staging.height = this.h;
    // willReadFrequently：我们每帧都要 getImageData，明说一句能让浏览器把它留在
    // CPU 侧，省掉一次 GPU 回读。
    const ctx = staging.getContext('2d', { willReadFrequently: true });
    if (!ctx) throw new Error(tr('err.export.gifNo2d'));
    this.ctx = ctx;
    this.written = 0;
  }

  async submit(_frameIndex: number, source: HTMLCanvasElement): Promise<void> {
    if (!this.gif || !this.ctx) throw new Error(tr('err.export.notConfigured'));

    // 同步拷贝。`renderer.kit.canvas` 的上下文带 preserveDrawingBuffer，所以此刻
    // 读到的就是本帧 —— 与 PngSequenceSink 的 `toBlob` 是同一个前提。
    this.ctx.drawImage(source, 0, 0, this.w, this.h);
    const { data } = this.ctx.getImageData(0, 0, this.w, this.h);

    // 量化与映射必须用同一个 format，否则最近邻查找会按另一套位深算，颜色整体偏移。
    const palette = quantize(data, this.maxColors);
    const index = applyPalette(data, palette);

    this.gif.writeFrame(index, this.w, this.h, {
      palette,
      delay: this.delays[this.written] ?? FALLBACK_DELAY_MS,
      // repeat 只在第一帧被读（上游在 first 分支里写 NETSCAPE 块），每帧传一样的值即可。
      repeat: this.loop,
    });
    this.written++;
  }

  async finalize(): Promise<Blob> {
    if (!this.gif) throw new Error(tr('err.export.notConfigured'));
    // gifenc 是**惰性写头**的：`GIF89a` + 逻辑屏描述符 + 色表 + NETSCAPE 块都由
    // 第一帧的 writeFrame 顺带写出。一帧都没写就 finish，得到的是**只有 trailer
    // 的 1 字节文件** —— 那会变成一次"成功"的空下载，比报错更难排查。
    if (this.written === 0) throw new Error(tr('err.export.gifEmpty'));

    this.gif.finish();
    const bytes = this.gif.bytes();
    // bytes 是上游内部流的视图，复制进独立 ArrayBuffer：
    // 一是 Blob 的类型要求，二是别让后续 GC 拖着一块编码器缓冲。
    const buf = new ArrayBuffer(bytes.byteLength);
    new Uint8Array(buf).set(bytes);
    return new Blob([buf], { type: 'image/gif' });
  }

  /**
   * 取消时丢掉中间产物。
   *
   * GIF 没有硬件会话要归还（这点与 Mp4Sink 不同），要放掉的是**已经编码的字节**：
   * 一段 480px 的长片能积到几十 MB，靠 GC 等不到确定的时间点。
   */
  async cancel(): Promise<void> {
    this.gif = null;
    this.ctx = null;
    this.written = 0;
  }

  /** 已写出的帧数。E2E / 性能探针用来核对「抽帧步长真的生效了」。 */
  get frameCount(): number {
    return this.written;
  }

  /** 实际写进逻辑屏描述符的尺寸（与构造参数一致，供探针回读）。 */
  get size(): { w: number; h: number } {
    return this.outSize;
  }
}

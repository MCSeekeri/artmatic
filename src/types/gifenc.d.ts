/**
 * gifenc.d.ts — 手写模块声明。
 *
 * 上游 `gifenc@1.0.3` 是**纯 JS 包且不带类型**（`package.json` 里没有 `types`
 * 字段，仓库里也没有 `.d.ts`）。不装第三方声明包的理由：本项目用得上的导出只有
 * 三个，手写一遍比追一个可能落后的 `@types` 更可控 —— 这与 `gl-transitions.d.ts`
 * 的取舍一致。
 *
 * ⚠️ 本项目的 import 边界只有一处：`exporters/gif-sink.ts`。上游换 API 只影响
 * 那一个文件；别处要 import 请先想想是不是该加进 sink。
 */

declare module 'gifenc' {
  /** 调色板里的一项。RGB 三元组或 RGBA 四元组，分量都是 0..255。 */
  export type GifPaletteColor = [number, number, number] | [number, number, number, number];

  /** 每像素 1 字节的索引图，长度 = 像素数。 */
  export type GifIndexedPixels = Uint8Array;

  /**
   * 量化与索引映射共用的像素格式。
   *
   * `rgb565`（默认）画质最好、最慢；`rgb444` 快但每个通道少一位；`rgba4444`
   * 才带 alpha —— 用到它时调色板每一项会变成四元组。
   */
  export type GifColorFormat = 'rgb565' | 'rgb444' | 'rgba4444';

  export interface QuantizeOptions {
    format?: GifColorFormat;
    oneBitAlpha?: boolean | number;
    clearAlpha?: boolean;
    clearAlphaThreshold?: number;
    clearAlphaColor?: number;
  }

  export interface WriteFrameOptions {
    /**
     * 本帧的调色板。
     *
     * **第一帧必须给**（上游会把它写成全局色表），后续帧给了就写**局部色表**。
     * 给了 `palette` 的帧会把索引解释成该调色板的下标 —— 换句话说，索引与
     * 调色板是绑定的，不能拿 A 帧的索引配 B 帧的调色板。
     */
    palette?: GifPaletteColor[];
    /**
     * 本帧显示时长，单位**毫秒**。
     *
     * 上游内部做 `Math.round(delay / 10)` 存成厘秒，所以能表达的粒度是 10ms —
     * 传 6.7 和传 6.9 会得到同一个结果。要精确控时长请按厘秒换算好再传
     * （本项目走 `exporters/gif-plan.ts::gifFrameDelays`）。
     */
    delay?: number;
    /** 循环：-1 = 只播一次、0 = 无限、>0 = 额外播几轮。**只在第一帧写入**。 */
    repeat?: number;
    transparent?: boolean;
    transparentIndex?: number;
    colorDepth?: number;
    dispose?: number;
  }

  export interface GifEncoderInstance {
    writeFrame(
      index: GifIndexedPixels,
      width: number,
      height: number,
      opts?: WriteFrameOptions,
    ): void;
    /** 写 trailer（0x3B）。之后 `bytes()` 才是完整文件。 */
    finish(): void;
    bytes(): Uint8Array;
    bytesView(): Uint8Array;
    reset(): void;
  }

  /**
   * 编码器。
   *
   * `auto`（默认 true）下，**第一帧的 `writeFrame` 会顺带写文件头**
   * （`GIF89a` + 逻辑屏描述符 + 色表 + NETSCAPE 循环块）。所以一帧都不写就
   * `finish()`，得到的是**只有 trailer 的 1 字节文件** —— 调用方必须自己
   * 挡住「零帧」这种情况（见 gif-sink 的 finalize）。
   */
  export function GIFEncoder(opt?: {
    initialCapacity?: number;
    auto?: boolean;
  }): GifEncoderInstance;

  /**
   * 把 RGBA 像素量化到不超过 `maxColors` 个颜色，返回调色板。
   * 输入是扁平的每像素 RGBA 字节（`Uint8ClampedArray` 来自 `getImageData`）。
   */
  export function quantize(
    rgba: Uint8Array | Uint8ClampedArray,
    maxColors: number,
    options?: QuantizeOptions,
  ): GifPaletteColor[];

  /**
   * 把每个像素映射到调色板里最近的颜色的下标。返回长度 = `rgba.length / 4`。
   *
   * `format` 必须与 `quantize` 时用的**一致**，否则最近邻查找会算错。
   */
  export function applyPalette(
    rgba: Uint8Array | Uint8ClampedArray,
    palette: GifPaletteColor[],
    format?: GifColorFormat,
  ): GifIndexedPixels;
}

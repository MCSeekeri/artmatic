/**
 * frame-sink.ts — ADR-001 的统一导出接口。
 *
 * 实现的规划：webcodecs（实测可用，**主路径**）、png-sequence（逃生舱）。
 * ffmmpeg-pipe 已从计划里去掉——2026-10-02 实测本机 Chrome 能编 H.264 +
 * AAC（见 mp4-sink.ts 文件头），捆绑 ffmpeg 只剩「打包成 exe 给人用」
 * 这一个理由，那是分发问题，不值得把 Electron 引进架构。
 *
 * > **2026-10-02 签名变更**：`configure` 多了第四个参数 `canvas`。
 * > 原因：mediabunny 的 `CanvasSource` 在**构造时**读 canvas 尺寸并缓存
 * > `VideoFrame` 工厂，而 `Output` 只允许 `addVideoTrack`、没有
> > `removeVideoTrack`，所以不可能「先建源后换 canvas」。(canvas 是
 * > 参照还是拷贝决定了能不能事后换，`CanvasSource` 是拷进内部缓存的。)
 * > 与其让 sink 内部藏一个 attach()，不如把 canvas 明着交给 configure。
 * > `png-sequence` 忽略该参数 —— 它的 `submit` 直接读传入的 canvas。
 */

export interface FrameSinkConfigureOptions {
  /**
   * 真实承载渲染结果的那张 canvas（`renderer.kit.canvas`）。
   *
   * 调用方**必须先 `setExportSize` 再 configure**，否则传进来的尺寸是预览尺寸。
   * 不需要它的实现可以忽略。
   */
  canvas: HTMLCanvasElement;
}

export interface FrameSink {
  configure(
    size: { w: number; h: number },
    fps: number,
    codec: string,
    opts?: FrameSinkConfigureOptions,
  ): Promise<void>;
  submit(frameIndex: number, source: HTMLCanvasElement): Promise<void>;
  finalize(): Promise<Blob | string>;
  /** 提前释放内部资源（取消导出时调用）。不实现则取消靠 GC。 */
  cancel?(): Promise<void>;
}

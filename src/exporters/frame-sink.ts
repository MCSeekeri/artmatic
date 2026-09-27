/**
 * frame-sink.ts — ADR-001 的统一导出接口。
 *
 * 三个实现的规划：ffmpeg-pipe（M5，主）、webcodecs（若实测可用）、
 * png-sequence（永远可用的兜底——MVP 就是它）。
 */

export interface FrameSink {
  configure(size: { w: number; h: number }, fps: number, codec: string): Promise<void>;
  submit(frameIndex: number, source: HTMLCanvasElement): Promise<void>;
  finalize(): Promise<Blob | string>;
}

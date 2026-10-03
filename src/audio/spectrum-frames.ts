/**
 * spectrum-frames.ts — 把「某一时刻的原始频谱」变成「某一实例这一帧该用的频谱」。
 *
 * 夹在两头中间：
 * - 上游是**原始** bin（`rawAt`）：主应用从离线预计算的 `SpectrumTrack` 取，
 *   lab 用合成信号（试炼场一贯的做法：给它一个可控的合成激励，像 `patterns.ts`
 *   的测试图那样）。
 * - 下游是 `SpectrumSource`（声明在 `engine/spectrum-texture.ts`）：
 *   `frameFor(instanceId, t, dt, smoothing)` 返回 0..255 的成品。
 *
 * **这里刻意不 import `engine/spectrum-texture.ts`** —— 那个接口由**消费方**
 * 声明，本类按结构满足它。这样 `audio/` 不必依赖 `engine/`，分层不新增边。
 */

import { SpectrumRange } from './spectrum-range';

/** 原始频谱取数：把 `t` 时刻的 bin 写进 `out`（长度 = bins，越界写 0）。 */
export type RawSpectrumAt = (t: number, out: Uint8Array) => void;

/**
 * 时间跳变超过这个值就当 seek 处理。
 *
 * 上游是在每个 seek 调用点显式调 `resetSpectrumRange()`；这里改成**按时间跳变
 * 自动判定**：归一化器是有状态的滚动窗，跨过一段跳变之后它必须重新播种，
 * 而「哪些地方算 seek」这件事散在各个调用点很容易漏。判据取 0.25 s ——
 * 远大于任何正常帧步长（30fps 是 33 ms），又远小于任何有意义的拖动。
 */
const SEEK_JUMP_SEC = 0.25;

export class SpectrumFrames {
  private readonly range = new SpectrumRange();
  private readonly raw: Uint8Array;
  /** 复用的成品缓冲。**只在下次调用前有效** —— 调用方拿到就上传，不要留着。 */
  private readonly dest: Uint8Array;
  private normalized: Uint8Array | null = null;
  private lastT = -1;

  constructor(
    readonly bins: number,
    private readonly rawAt: RawSpectrumAt,
  ) {
    this.raw = new Uint8Array(bins);
    this.dest = new Uint8Array(bins);
  }

  /**
   * 某一实例这一帧的频谱（已归一化 + 已按实例平滑）。
   *
   * 归一化**每帧只做一次**（多个实例读的是同一帧音频），包络平滑**逐实例**做
   * （平滑是特效上的参数，两个实例可以要不同的值）。
   */
  frameFor(instanceId: string, t: number, dt: number, smoothing: number): Uint8Array | null {
    if (this.lastT >= 0 && Math.abs(t - this.lastT) > SEEK_JUMP_SEC) this.range.reset();
    if (t !== this.lastT) {
      this.rawAt(t, this.raw);
      this.normalized = this.range.normalize(this.raw, dt);
      this.lastT = t;
    }
    const norm = this.normalized;
    if (!norm) return null;
    this.range.smooth(instanceId, norm, this.dest, dt, smoothing);
    return this.dest;
  }

  /** 信号不连续（换素材、重算频谱、导出开始）。 */
  reset(): void {
    this.range.reset();
    this.lastT = -1;
    this.normalized = null;
  }

  /** 实例消失时忘掉它的包络。 */
  drop(instanceId: string): void {
    this.range.drop(instanceId);
  }
}

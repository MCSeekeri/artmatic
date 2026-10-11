/**
 * frame-signature.ts — 一帧的数值指纹（方案 §5.2）。
 *
 * **纯函数**：入参是已经翻好行的 RGBA 字节（`ControlContext` 那侧负责翻行，
 * 见 `control-plane.ts::readPixels`）。抽出来是为了能在 Node 里单测口径。
 *
 * 口径直接搬 `tests/e2e/_stage.ts::gridStats`（那份是 E2E 的判据真源）：
 * 分块均值 + 每块中心的点采样 + 采样点单通道最大跨度。两处**必须是同一个口径**，
 * 否则「agent 自循环里的指纹」与「回归用例里的指纹」对不上。
 *
 * 唯一的差异：`mean` 是**逐通道**的（方案 §5.2 / AGENTS §5.6）。E2E 那份给的是
 * 标量均值，标量在余弦调色板这类图上恒为 127.5 —— 判据会退化成恒真。
 */

import type { FrameSignature } from './types';

export interface SignatureInput {
  /** 自上而下（`ImageData` 的行序），已翻好。 */
  rgba: Uint8Array;
  w: number;
  h: number;
  /** 分块数（每边）。默认 4。 */
  grid?: number;
  /** 秒，原样回填（调用方已吸附到帧栅格）。 */
  t: number;
}

export function frameSignatureOf(input: SignatureInput): FrameSignature {
  const { rgba, w, h } = input;
  const g = Math.max(1, Math.floor(input.grid ?? 4));
  const n = w * h;

  const sums = [0, 0, 0];
  let lit = 0;
  const grid = new Array<number>(g * g).fill(0);
  const cell = new Array<number>(g * g).fill(0);

  for (let y = 0; y < h; y++) {
    const by = Math.min(g - 1, Math.floor((y / h) * g));
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const r = rgba[i]!;
      const gg = rgba[i + 1]!;
      const b = rgba[i + 2]!;
      const v = r + gg + b;
      sums[0]! += r;
      sums[1]! += gg;
      sums[2]! += b;
      if (v > 0) lit += 1;
      const blk = by * g + Math.min(g - 1, Math.floor((x / w) * g));
      grid[blk]! += v / 3;
      cell[blk]! += 1;
    }
  }
  for (let i = 0; i < grid.length; i++) grid[i] = grid[i]! / (cell[i] || 1);

  const samples = new Array<number>(g * g * 3).fill(0);
  const lo = [255, 255, 255];
  const hi = [0, 0, 0];
  for (let by = 0; by < g; by++) {
    const sy = Math.min(h - 1, Math.floor(((by + 0.5) * h) / g));
    for (let bx = 0; bx < g; bx++) {
      const sx = Math.min(w - 1, Math.floor(((bx + 0.5) * w) / g));
      const i = (sy * w + sx) * 4;
      const b = (by * g + bx) * 3;
      for (let ch = 0; ch < 3; ch++) {
        const v = rgba[i + ch]!;
        samples[b + ch] = v;
        if (v < lo[ch]!) lo[ch] = v;
        if (v > hi[ch]!) hi[ch] = v;
      }
    }
  }

  return {
    t: input.t,
    w,
    h,
    mean: [sums[0]! / n, sums[1]! / n, sums[2]! / n],
    spread: Math.max(hi[0]! - lo[0]!, hi[1]! - lo[1]!, hi[2]! - lo[2]!),
    grid,
    samples,
    lit,
    total: n,
  };
}

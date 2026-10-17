/**
 * noise.ts — 种子化二维 Perlin 噪声 + fBm（等高线生成器的底座）。
 *
 * 为什么要自己写而不是引库：这是**纯函数**生成器，噪声必须由 `seed` 完全决定
 * （硬约束 1.2 / 报告 §10.5）。rahoo 的等高线用 `Math.random()` 打乱置换表，
 * 于是「每次刷新地形都不一样」—— 那条路在这里走不通。
 *
 * 实现是经典 Perlin：256 项置换表 + 5 次 fade + 8 方向梯度。输出大致在
 * [-1, 1]（乘了 0.7 归一到二维梯度的实际幅值），fBm 再按权重归一。
 */

import { mulberry32 } from '../../core/prng';

export type Noise2D = (x: number, y: number) => number;

/** 用种子建一张置换表，返回二维噪声函数。 */
export function makeNoise2D(seed: number): Noise2D {
  const rnd = mulberry32(seed >>> 0);
  const p = new Uint8Array(256);
  for (let i = 0; i < 256; i++) p[i] = i;
  // Fisher-Yates：确定性洗牌。**唯一**的随机来源是 mulberry32。
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    const t = p[i]!;
    p[i] = p[j]!;
    p[j] = t;
  }
  const perm = new Uint8Array(512);
  for (let i = 0; i < 512; i++) perm[i] = p[i & 255]!;

  const fade = (t: number): number => t * t * t * (t * (t * 6 - 15) + 10);
  const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
  /** 8 方向梯度（比 12 方向查表便宜，且不会出现轴向条纹）。 */
  const grad = (h: number, x: number, y: number): number => {
    switch (h & 7) {
      case 0:
        return x + y;
      case 1:
        return -x + y;
      case 2:
        return x - y;
      case 3:
        return -x - y;
      case 4:
        return x;
      case 5:
        return -x;
      case 6:
        return y;
      default:
        return -y;
    }
  };

  return (x: number, y: number): number => {
    const fx = Math.floor(x);
    const fy = Math.floor(y);
    const xi = fx & 255;
    const yi = fy & 255;
    const xf = x - fx;
    const yf = y - fy;
    const u = fade(xf);
    const v = fade(yf);
    const aa = perm[perm[xi]! + yi]!;
    const ba = perm[perm[xi + 1]! + yi]!;
    const ab = perm[perm[xi]! + yi + 1]!;
    const bb = perm[perm[xi + 1]! + yi + 1]!;
    const x1 = lerp(grad(aa, xf, yf), grad(ba, xf - 1, yf), u);
    const x2 = lerp(grad(ab, xf, yf - 1), grad(bb, xf - 1, yf - 1), u);
    return lerp(x1, x2, v) * 0.7;
  };
}

/**
 * fBm：把若干倍频叠加成 [0,1] 的高度场。
 *
 * `lacunarity` 固定 2（八度之间频率翻倍）：可调的话「倍频复杂度」这个滑杆
 * 会同时改频率与对比度，调参手感会变得难以预测。
 */
export function fbm2D(
  noise: Noise2D,
  x: number,
  y: number,
  octaves: number,
  gain: number,
  freq: number,
): number {
  let f = freq;
  let amp = 1;
  let sum = 0;
  let norm = 0;
  for (let o = 0; o < octaves; o++) {
    sum += ((noise(x * f, y * f) + 1) / 2) * amp;
    norm += amp;
    amp *= gain;
    f *= 2;
  }
  return norm > 0 ? sum / norm : 0;
}

/**
 * fft.ts — 自研的离线 FFT（ADR-002：不引第三方 DSP 库）。
 *
 * 只需要「一次变换一批 2048 点实数帧」这一种用法，所以刻意写得窄：
 * 复数 in-place radix-2（Cooley-Tukey 迭代式）+ 一个单边幅度谱的封装。
 *
 * 为什么不做实数 FFT 的省一半技巧（用一个 n/2 的复数变换打包偶奇两半）：
 * 那能省掉一半乘加，但要额外一段容易写错的解包公式。实测 2048 点复数变换
 * 约 20 µs，一首 4 分钟的歌 ≈ 2.4 万帧 ≈ 0.5 s，在分块让出主线程的框架下
 * 用户感知不到 —— **用一半的代码换一半的速度，这里划算**。
 *
 * 复用缓冲是刻意的：`magnitude()` 每帧都调，每次分配会让 GC 在几百毫秒里
 * 反复打断主线程（那正是硬约束 1.4 想避免的形态）。
 */

export class Fft {
  private readonly rev: Uint32Array;
  private readonly cosTab: Float32Array;
  private readonly sinTab: Float32Array;
  private readonly re: Float32Array;
  private readonly im: Float32Array;

  constructor(readonly n: number) {
    if (n < 2 || (n & (n - 1)) !== 0) throw new Error(`FFT 长度必须是 2 的幂，收到 ${n}`);
    this.rev = new Uint32Array(n);
    let bits = 0;
    while (1 << bits < n) bits += 1;
    for (let i = 0; i < n; i += 1) {
      let r = 0;
      for (let b = 0; b < bits; b += 1) if (i & (1 << b)) r |= 1 << (bits - 1 - b);
      this.rev[i] = r;
    }
    // 旋转因子按 t=0..n/2-1 预存：e^{-i·2π·t/n}
    const half = n >> 1;
    this.cosTab = new Float32Array(half);
    this.sinTab = new Float32Array(half);
    for (let t = 0; t < half; t += 1) {
      this.cosTab[t] = Math.cos((2 * Math.PI * t) / n);
      this.sinTab[t] = Math.sin((2 * Math.PI * t) / n);
    }
    this.re = new Float32Array(n);
    this.im = new Float32Array(n);
  }

  /** 就地变换。`re`/`im` 长度必须等于 n。 */
  transform(re: Float32Array, im: Float32Array): void {
    const n = this.n;
    const rev = this.rev;
    for (let i = 0; i < n; i += 1) {
      const j = rev[i]!;
      if (j > i) {
        const tr = re[i]!;
        re[i] = re[j]!;
        re[j] = tr;
        const ti = im[i]!;
        im[i] = im[j]!;
        im[j] = ti;
      }
    }
    const cos = this.cosTab;
    const sin = this.sinTab;
    for (let len = 2; len <= n; len <<= 1) {
      const half = len >> 1;
      const step = n / len;
      for (let i = 0; i < n; i += len) {
        for (let k = 0; k < half; k += 1) {
          const t = k * step;
          const wr = cos[t]!;
          const wi = -sin[t]!;
          const a = i + k;
          const b = a + half;
          const xr = re[b]! * wr - im[b]! * wi;
          const xi = re[b]! * wi + im[b]! * wr;
          re[b] = re[a]! - xr;
          im[b] = im[a]! - xi;
          re[a] = re[a]! + xr;
          im[a] = im[a]! + xi;
        }
      }
    }
  }

  /**
   * 实数帧（长度 n）→ 单边幅度谱（长度 n/2 + 1），写进 `out`。
   * 用内部缓冲，不分配。
   */
  magnitude(frame: Float32Array, out: Float32Array): void {
    const n = this.n;
    const re = this.re;
    const im = this.im;
    re.set(frame.subarray(0, n));
    im.fill(0);
    this.transform(re, im);
    const half = n >> 1;
    out[0] = Math.abs(re[0]!);
    for (let k = 1; k < half; k += 1) out[k] = Math.hypot(re[k]!, im[k]!);
    out[half] = Math.abs(re[half]!);
  }
}

/** 对称 Hann 窗（与 numpy.hanning 同式，分母 n-1）。 */
export function hannWindow(n: number): Float32Array {
  const w = new Float32Array(n);
  for (let i = 0; i < n; i += 1) w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1));
  return w;
}

import { describe, expect, test } from 'vitest';
import { computeSpectrum, SPECTRUM_FFT, SPECTRUM_FPS } from '../../src/audio/spectrum';
import { followerTaus, SpectrumRange } from '../../src/audio/spectrum-range';

/** 造一个只满足 `computeSpectrum` 所需的假 buffer（不需要 WebAudio）。 */
function fakeBuffer(
  seconds: number,
  sampleRate: number,
  sample: (t: number) => number,
): { length: number; numberOfChannels: number; sampleRate: number; getChannelData: (c: number) => Float32Array } {
  const length = Math.round(seconds * sampleRate);
  const data = new Float32Array(length);
  for (let i = 0; i < length; i += 1) data[i] = sample(i / sampleRate);
  return {
    length,
    numberOfChannels: 1,
    sampleRate,
    getChannelData: () => data,
  };
}

describe('频谱提取（离线预计算）', () => {
  test('形状：bins = N/2 + 1，帧率 = SPECTRUM_FPS', async () => {
    const track = await computeSpectrum(fakeBuffer(0.5, 44100, () => 0));
    expect(track.bins).toBe((SPECTRUM_FFT >> 1) + 1);
    expect(track.hopSec).toBeCloseTo(1 / SPECTRUM_FPS, 6);
    expect(track.frames).toBeGreaterThan(20);
  });

  test('1 kHz 正弦的能量集中在对应 bin 附近', async () => {
    const sr = 44100;
    const track = await computeSpectrum(fakeBuffer(0.5, sr, (t) => Math.sin(2 * Math.PI * 1000 * t)));
    const out = new Uint8Array(track.bins);
    track.at(0.25, out);

    const expected = Math.round((1000 / (sr / 2)) * (track.bins - 1));
    let peak = 0;
    for (let k = 0; k < out.length; k += 1) if (out[k]! > out[peak]!) peak = k;
    // Hann 窗的主瓣会摊到相邻几根 bin 上，所以给一点余量。
    expect(Math.abs(peak - expected)).toBeLessThanOrEqual(2);
    // 峰值要接近满量程（满幅正弦在该 dB 窗口下应当到顶）。
    expect(out[peak]!).toBeGreaterThan(200);
  });

  test('静音 → 全 0；越界的时间 → 全 0', async () => {
    const track = await computeSpectrum(fakeBuffer(0.3, 44100, () => 0));
    const out = new Uint8Array(track.bins).fill(7);
    track.at(0.1, out);
    expect([...out].every((v) => v === 0)).toBe(true);

    out.fill(7);
    track.at(-1, out);
    expect([...out].every((v) => v === 0)).toBe(true);
    out.fill(7);
    track.at(99, out);
    expect([...out].every((v) => v === 0)).toBe(true);
  });

  test('at() 写入传入的缓冲，不分配新数组', async () => {
    const track = await computeSpectrum(fakeBuffer(0.2, 44100, (t) => Math.sin(t * 300)));
    const out = new Uint8Array(track.bins);
    expect(track.at(0.05, out)).toBeUndefined();
    expect(out.length).toBe(track.bins);
  });
});

describe('滚动归一化', () => {
  const N = 16;
  /** 让每根 bin 都拿到同一个值的输入帧。 */
  const frame = (v: number): Uint8Array => new Uint8Array(N).fill(v);

  test('静音进 → 静音出（不会被 MIN_CEIL 撑起来）', () => {
    const r = new SpectrumRange();
    let last: Uint8Array | null = null;
    for (let i = 0; i < 200; i += 1) last = r.normalize(frame(0), 1 / 60);
    expect([...last!].every((v) => v === 0)).toBe(true);
  });

  test('恒定信号 → 输出趋近 0（扣掉地板后没有「上升」可言）', () => {
    const r = new SpectrumRange();
    let last: Uint8Array | null = null;
    for (let i = 0; i < 400; i += 1) last = r.normalize(frame(150), 1 / 60);
    // 首帧自播种时 height 就是 0，之后地板跟着走，所以恒定量不该有高度。
    expect(Math.max(...last!)).toBeLessThanOrEqual(1);
  });

  test('抬升 → 立刻有高度（地板升得慢）', () => {
    const r = new SpectrumRange();
    for (let i = 0; i < 400; i += 1) r.normalize(frame(100), 1 / 60);
    const before = r.normalize(frame(100), 1 / 60)!.slice();
    expect(Math.max(...before)).toBeLessThanOrEqual(1);

    // 抬到 200 并保持 100 ms
    let after: Uint8Array | null = null;
    for (let i = 0; i < 6; i += 1) after = r.normalize(frame(200), 1 / 60);
    expect(Math.max(...after!)).toBeGreaterThan(20);
  });

  test('MIN_CEIL：几乎没动态的素材不会被撑满', () => {
    const r = new SpectrumRange();
    for (let i = 0; i < 400; i += 1) r.normalize(frame(100), 1 / 60);
    let peak = 0;
    for (let i = 0; i < 60; i += 1) {
      // 幅度只有 5/255 ≈ 0.02，远小于 MIN_CEIL(0.15)
      const v = i % 2 === 0 ? 103 : 98;
      const out = r.normalize(frame(v), 1 / 60)!;
      peak = Math.max(peak, Math.max(...out));
    }
    // 没有 MIN_CEIL 的话这里会被拉到 255 —— 那正是「接近无声看起来像副歌」。
    expect(peak).toBeLessThan(60);
  });

  test('60fps 与 30fps 在同一条时间轴上收敛（时间常数按秒 × 帧差）', () => {
    // 信号每 0.1 s 变一次：0.1 同时是 1/30 与 1/60 的整数倍，两种步长采到同一串值。
    const at = (t: number, i: number): number =>
      Math.round(90 + 60 * Math.sin((Math.floor(t * 10) + i) * 0.7));

    const run = (fps: number): Uint8Array => {
      const r = new SpectrumRange();
      const steps = Math.round(2 * fps);
      let out: Uint8Array | null = null;
      for (let s = 0; s < steps; s += 1) {
        const t = s / fps;
        out = r.normalize(frame(at(t, 0)), 1 / fps);
      }
      return out!.slice();
    };

    const a = run(60);
    const b = run(30);
    let worst = 0;
    for (let i = 0; i < N; i += 1) worst = Math.max(worst, Math.abs(a[i]! - b[i]!));
    // 采样率不同必然有细微差别，但不该差出一个量级 —— 这正是「预览与导出同源」的依据。
    expect(worst).toBeLessThan(6);
  });

  test('reset() 之后重新播种（跨静音/seek 不会带着旧地板走）', () => {
    const r = new SpectrumRange();
    for (let i = 0; i < 400; i += 1) r.normalize(frame(200), 1 / 60);
    r.reset();
    // 播种用当帧：直接给一个不同的值，首帧高度为 0（没有任何陈旧状态）
    const first = r.normalize(frame(40), 1 / 60)!;
    expect(Math.max(...first)).toBeLessThanOrEqual(1);
  });

  test('逐实例平滑：attack 比 release 快，smoothing 越大 release 越长', () => {
    const slow = followerTaus(0);
    const fast = followerTaus(1);
    expect(slow.attack).toBeLessThan(slow.release);
    expect(fast.release).toBeGreaterThan(slow.release * 5);

    const r = new SpectrumRange();
    const src = frame(200);
    const dest = new Uint8Array(N);
    const rise = new Uint8Array(N);
    r.smooth('a', src, dest, 1 / 60, 0.45);
    rise.set(dest);

    // 掉回 0 之后，同一实例要花若干帧才落下来
    const zero = frame(0);
    r.smooth('a', zero, dest, 1 / 60, 0.45);
    const afterOne = dest[0]!;
    expect(afterOne).toBeLessThan(rise[0]!);
    expect(afterOne).toBeGreaterThan(0);

    // 另一个实例是独立的一条包络
    const other = new Uint8Array(N);
    r.smooth('b', zero, other, 1 / 60, 0.45);
    expect(other[0]).toBe(0);
  });

  test('drop() 只忘掉指定实例', () => {
    const r = new SpectrumRange();
    const dest = new Uint8Array(N);
    r.smooth('a', frame(200), dest, 1 / 60, 0.45);
    r.smooth('b', frame(200), dest, 1 / 60, 0.45);
    r.drop('a');
    const again = new Uint8Array(N);
    // a 被忘掉 → 重新从当帧播种 → 与零输入一致
    r.smooth('a', frame(0), again, 1 / 60, 0.45);
    expect(again[0]).toBe(0);
  });

  test('卡住的时钟：dt 被夹到 0.25 s（掉帧不会让包络瞬间贴到输入）', () => {
    const a = new SpectrumRange();
    const b = new SpectrumRange();
    let outA: Uint8Array | null = null;
    let outB: Uint8Array | null = null;
    for (let i = 0; i < 10; i += 1) {
      outA = a.normalize(frame(100), 1 / 60);
      outB = b.normalize(frame(100), 5); // 荒谬的 dt
    }
    // 夹到 0.25 与走 15 个 1/60 帧不等价，但都不该把输出顶到某个极端
    expect(Math.max(...outA!)).toBeLessThanOrEqual(1);
    expect(Math.max(...outB!)).toBeLessThanOrEqual(1);
  });
});

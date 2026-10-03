/**
 * spectrum.ts（lab）— 试炼场的**合成频谱**。
 *
 * 试炼场里没有工程音频，但 `audio-bars` 得能被目视验收 —— 所以给它一个可控的
 * 合成激励，和 `patterns.ts` 给合成测试图是同一个思路：**舞台上的东西全部可复现**。
 *
 * 形状刻意做得像一段有节奏的音乐：每拍一记底鼓（能量集中在低频）、每拍后半一记
 * 踩镲（高频）、每两拍换一个贝斯音，再加一条很低的底噪。这样归一化器的两步修正
 * 都能被看见（底噪决定地板、击打决定天花板）。
 *
 * 时间基准用试炼场自己的拍网格，所以它和 `sync = 按拍` 的特效是同一个时钟。
 */

import { beatAtTime } from '../src/core/time';
import { SpectrumFrames } from '../src/audio/spectrum-frames';
import { SPECTRUM_BINS } from '../src/audio/spectrum';
import { LAB_BEAT_GRID } from './build-project';

export const LAB_SPECTRUM_BINS = SPECTRUM_BINS;

export function createLabSpectrum(): SpectrumFrames {
  const top = SPECTRUM_BINS - 1;
  return new SpectrumFrames(SPECTRUM_BINS, (t, out) => {
    const beat = beatAtTime(t, LAB_BEAT_GRID);
    const within = beat - Math.floor(beat); // 一拍之内的位置 0..1
    const bar = Math.floor(beat / 4);

    // 底鼓：每拍一记，指数衰减
    const kick = Math.exp(-within * 9);
    // 踩镲：每拍后半，衰减更快
    const off = within < 0.5 ? within + 0.5 : within - 0.5;
    const hat = Math.exp(-off * 26);
    // 贝斯：每两拍换一个音，逐小节游走
    const bass = 0.5 + 0.5 * Math.sin(Math.floor(beat / 2) * 1.7 + bar * 0.9);

    out[0] = 0; // 直流分量恒为 0
    for (let k = 1; k <= top; k += 1) {
      const f = k / top; // 0..1 = 0..Nyquist
      const low = Math.exp(-f * 40) * kick; // 底鼓：最低那几十根 bin
      const mid = Math.exp(-Math.pow((f - 0.05) * 12, 2)) * bass * (0.3 + 0.7 * kick);
      const high = Math.exp(-f * 2.2) * hat * 0.55; // 踩镲：铺开到高频
      const v = 0.3 + low * 0.6 + mid * 0.3 + high * 0.4;
      out[k] = v >= 1 ? 255 : Math.round(v * 255);
    }
  });
}

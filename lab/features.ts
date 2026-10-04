/**
 * features.ts（lab）— 试炼场的**合成音频特征**。
 *
 * 与 `lab/spectrum.ts` 的合成频谱是同一个思路：试炼场里没有工程音频，
 * 但场景生成器得能被目视验收 —— 所以给它一段形状像音乐的激励。
 * 「舞台上的东西全部可复现」这条在这里同样成立：没有任何随机，全部是
 * 试炼场自己的拍网格的函数。
 *
 * 形状刻意做得像一段有节奏的音乐（与 `lab/spectrum.ts` 同一套激励）：
 * 每拍一记底鼓（低频）、每拍后半一记踩镲（高频）、每两拍换一个贝斯音。
 * `travel` 是闭式积分的**预计算表** —— 真正的实现（`audio/features.ts`）
 * 也是离线积分，这里对齐同一个口径。
 */

import { beatAtTime } from '../src/core/time';
import { AGE_SENTINEL, type AudioFeatureSource, type AudioFeatures } from '../src/algos/feature-source';
import { LAB_BEAT_GRID, LAB_DURATION } from './build-project';

/** 与 `audio/features.ts` 的 `TRAVEL_GAIN` 一致，观感才对得上。 */
const TRAVEL_GAIN = 8;
const TABLE_FPS = 100;

/** 激励：一拍之内的位置 → 各层的瞬时强度。与 `lab/spectrum.ts` 同一套。 */
function excite(t: number): {
  rms: number;
  sub: number;
  bass: number;
  mid: number;
  high: number;
  air: number;
  flux: number;
} {
  const beat = beatAtTime(t, LAB_BEAT_GRID);
  const within = beat - Math.floor(beat);
  const bar = Math.floor(beat / 4);

  const kick = Math.exp(-within * 9);
  const off = within < 0.5 ? within + 0.5 : within - 0.5;
  const hat = Math.exp(-off * 26);
  const bass = 0.5 + 0.5 * Math.sin(Math.floor(beat / 2) * 1.7 + bar * 0.9);

  return {
    rms: Math.min(1, 0.28 + kick * 0.5 + hat * 0.22),
    sub: Math.min(1, 0.15 + kick * 0.85),
    bass: Math.min(1, 0.25 + bass * 0.6 * (0.4 + 0.6 * kick)),
    mid: Math.min(1, 0.3 + bass * 0.35),
    high: Math.min(1, 0.1 + hat * 0.8),
    air: Math.min(1, 0.05 + hat * 0.5),
    flux: Math.min(1, kick * 0.7 + hat * 0.3),
  };
}

/**
 * 造一个合成特征源。
 *
 * `travel` 用**预计算表**而不是每次调用现积分：它是累积量，现积分就是
 * O(t) 的每帧开销，而且与真实现的「离线表」口径不一致。
 */
export function createLabFeatures(): AudioFeatureSource {
  const hop = 1 / TABLE_FPS;
  const n = Math.ceil(LAB_DURATION * TABLE_FPS) + 2;
  const travel = new Float32Array(n);
  let acc = 0;
  for (let i = 0; i < n; i += 1) {
    travel[i] = acc;
    acc += excite(i * hop).rms * hop * TRAVEL_GAIN;
  }

  // 每拍的 onset 时刻（试炼场的「音符」就是拍）—— 供 u_ages / u_hit
  const bpm = LAB_BEAT_GRID.bpm > 0 ? LAB_BEAT_GRID.bpm : 120;
  const secPerBeat = 60 / bpm;

  return {
    at(t: number, out: AudioFeatures): void {
      const e = excite(t);
      out.rms = e.rms;
      out.flux = e.flux;
      out.sub = e.sub;
      out.bass = e.bass;
      out.mid = e.mid;
      out.high = e.high;
      out.air = e.air;
      out.centroid = 0.32 + e.high * 0.35;
      out.flat = 0.25 + e.air * 0.4;

      const x = Math.max(0, Math.min(n - 1.001, t * TABLE_FPS));
      const i = x | 0;
      out.travel = t >= 0 && t <= LAB_DURATION ? travel[i]! + (travel[i + 1]! - travel[i]!) * (x - i) : 0;

      // 拍就是 onset：年龄 = 当前拍内已过去的时间
      const beat = beatAtTime(t, LAB_BEAT_GRID);
      const withinBeat = (beat - Math.floor(beat)) * secPerBeat;
      for (let k = 0; k < 4; k += 1) {
        const age = withinBeat + k * secPerBeat;
        out.ages[k] = beat - k < 0 ? AGE_SENTINEL : age;
      }
    },
  };
}

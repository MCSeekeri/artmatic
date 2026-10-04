/**
 * demo-audio.ts — 程序生成的演示音频：120 BPM、4/4、12 小节 = 24 秒。
 *
 * 开箱即用的 demo 不能依赖外部文件（版权与路径都麻烦），就用
 * OfflineAudioContext 合成一段节拍：kick 在每拍、hat 在反拍、
 * snare 在 2/4 拍、bass 铺底。噪声全部用 mulberry32 生成——
 * 禁止 Math.random（硬约束 1.2 对音频同样成立）。
 *
 * 12 小节而不是 8：画面按**每 4 小节一段**排了三段（见 `core/demo-project.ts`），
 * 8 小节只够两段，标题还没走完就结尾了。前两小节刻意撤掉军鼓 —— 标题淡入
 * 那两秒留白，比从头就砸满更容易读。
 */

import { mulberry32 } from '../core/prng';
import { DEMO_ASSET_ID, DEMO_DURATION } from '../core/demo-project';

export { DEMO_ASSET_ID, DEMO_DURATION };
export const DEMO_BPM = 120;
export const DEMO_BARS = 12;

function noiseBuffer(ctx: OfflineAudioContext, seconds: number, seed: number): AudioBuffer {
  const len = Math.ceil(seconds * ctx.sampleRate);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  const rng = mulberry32(seed);
  for (let i = 0; i < len; i++) d[i] = rng() * 2 - 1;
  return buf;
}

function kick(ctx: OfflineAudioContext, at: number): void {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(160, at);
  osc.frequency.exponentialRampToValueAtTime(42, at + 0.09);
  gain.gain.setValueAtTime(0.9, at);
  gain.gain.exponentialRampToValueAtTime(0.001, at + 0.24);
  osc.connect(gain).connect(ctx.destination);
  osc.start(at);
  osc.stop(at + 0.26);
}

function hat(ctx: OfflineAudioContext, at: number, noise: AudioBuffer): void {
  const src = ctx.createBufferSource();
  src.buffer = noise;
  const bp = ctx.createBiquadFilter();
  bp.type = 'highpass';
  bp.frequency.value = 7800;
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.22, at);
  gain.gain.exponentialRampToValueAtTime(0.001, at + 0.045);
  src.connect(bp).connect(gain).connect(ctx.destination);
  src.start(at, 0, 0.06);
}

function snare(ctx: OfflineAudioContext, at: number, noise: AudioBuffer): void {
  const src = ctx.createBufferSource();
  src.buffer = noise;
  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = 1900;
  bp.Q.value = 0.9;
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.5, at);
  gain.gain.exponentialRampToValueAtTime(0.001, at + 0.13);
  src.connect(bp).connect(gain).connect(ctx.destination);
  src.start(at, 0.1, 0.15);
}

function bass(ctx: OfflineAudioContext, at: number, freq: number, dur: number): void {
  const osc = ctx.createOscillator();
  osc.type = 'sawtooth';
  osc.frequency.value = freq;
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 320;
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.16, at);
  gain.gain.setValueAtTime(0.16, at + dur * 0.7);
  gain.gain.exponentialRampToValueAtTime(0.001, at + dur);
  osc.connect(lp).connect(gain).connect(ctx.destination);
  osc.start(at);
  osc.stop(at + dur + 0.02);
}

/** 渲染演示音频。确定性：同一二进制跑两次，输出逐样本一致。 */
export async function renderDemoAudio(): Promise<AudioBuffer> {
  const sr = 44100;
  const ctx = new OfflineAudioContext(2, Math.ceil(DEMO_DURATION * sr), sr);
  const beat = 60 / DEMO_BPM;
  const noise = noiseBuffer(ctx, 0.5, 0xbea7);
  // bass 走向：A1 A1 | C2 G1 | F1 G1（每两小节一变，末段落到 F1 → G1 收束）
  const bassLine = [55, 55, 65.41, 49, 43.65, 49];

  for (let bar = 0; bar < DEMO_BARS; bar++) {
    const barStart = bar * 4 * beat;
    const root = bassLine[Math.min(bar >> 1, bassLine.length - 1)]!;
    // 前两小节撤军鼓：画面那头正是标题淡入，听得见拍子但不必被砸。
    const full = bar >= 2;
    const lastBar = bar === DEMO_BARS - 1;
    for (let b = 0; b < 4; b++) {
      const at = barStart + b * beat;
      kick(ctx, at);
      hat(ctx, at + beat / 2, noise);
      if (full && (b === 1 || b === 3)) snare(ctx, at, noise);
    }
    bass(ctx, barStart, root, beat * 0.9);
    bass(ctx, barStart + 1.5 * beat, root, beat * 0.45);
    bass(ctx, barStart + 3 * beat, root * 1.5, beat * 0.8);
    // 最后一小节补一记反拍底鼓：结尾落在拍上，而不是停在半空。
    if (lastBar) kick(ctx, barStart + 3.5 * beat);
  }
  return ctx.startRendering();
}

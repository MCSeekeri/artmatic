/**
 * squeak.ts — 橡皮鸭「捏一下」的 Web Audio 合成。
 *
 * 这一层**只做三件事**：把 `squeak-plan.ts` 算出来的数字接到音频节点上、
 * 记住最近点过几下（算 stress）、维护一个惰性创建的 AudioContext。
 * 所有「听起来像不像」的判断都在计划里，这里没有分支可测 —— 所以它不配单测。
 *
 * ## 为什么音色能像橡皮鸭
 *
 *   主振荡器  富谐波波形（saw/square/triangle 随机）+ 两段频率冲高回落
 *   颤音      LFO 40..110 Hz 调制频率 —— 这就是「橡胶振膜」的抖动感
 *   鼻音带通  中心在基频的 2.6..5 倍，Q 2..7 —— 把谐波削成一条窄带 = 鸭子腔
 *   噪声层    15..40 ms 的带通白噪 = 捏下去那一下的摩擦
 *   错音      第二振荡器按 1.4x / 0.66x 混入，越急越响
 *
 * ## 为什么点太频繁会变成噪音
 *
 * `stress` 是「最近 2.2 秒点了几次」的纯函数（见 plan）。到 8 次就让
 * `noiseMode` 生效：**放弃乐音，直接给一段白噪爆**（宽而不共振的高通 + 扫频
 * 低通，见 `playNoise`）。中间那几档也不是渐变到「更难听」而已 —— 音高随机
 * 范围、噪声层、失真、错音量同时放大，所以听起来是「越捏越坏」而不是
 * 「音量越来越大」。
 *
 * ## 关于 `performance.now()`
 *
 * 硬约束 1.1 管的是**渲染求值**（渲染函数只能吃 t）。捏响是 UI 反馈：
 * 它不进任何一帧画面、不影响导出，用墙钟算「点多快」是它唯一合理的口径。
 * 随机仍然走 `core/prng.ts`（种子 = 第几次 + 墙钟毫秒），没有裸 `Math.random()`。
 */

import { hashSeed, mulberry32 } from '../../core/prng';
import { STRESS_WINDOW_SEC, squeakPlan, stressFrom, type SqueakPlan } from './squeak-plan';

/** 捏响后暴露给 E2E / 调试的读数。 */
export interface PokeStats {
  /** 捏了几次（不依赖音频是否真的播出来）。 */
  squeaks: number;
  /** 其中变成了噪音爆的几次。 */
  noiseBursts: number;
  /** 最近一次合成时的急性度 0..1。 */
  stress: number;
  /** 最近一次的完整计划（null = 还没捏过）。 */
  lastPlan: SqueakPlan | null;
  /**
   * AudioContext 的状态。`'none'` = 从没建起来（环境没有 Web Audio，
   * 或者音频那条路被摘掉了）—— 这是 E2E 唯一能读到「合成器确实接上了」的
   * 证据：Playwright 读不到声音本身。
   */
  audioState: AudioContextState | 'none';
}

let ctx: AudioContext | null = null;
let master: DynamicsCompressorNode | null = null;
let noiseBuf: AudioBuffer | null = null;

/** 最近若干次点击的墙钟毫秒。只保留窗口内的，所以不会无界增长。 */
const clicks: number[] = [];
let seq = 0;
let squeaks = 0;
let noiseBursts = 0;
let lastPlan: SqueakPlan | null = null;
let lastStress = 0;

/**
 * 惰性建 AudioContext。
 *
 * 必须在**用户手势里**第一次调用（`poke` 只在 click 里跑，所以天然满足）；
 * 已存在但被浏览器挂起时补一次 `resume()` —— 不 await，它失败也不影响出声的
 * 计划被算出来（统计与计划都与音频状态解耦，E2E 因此不脆）。
 */
function audio(): AudioContext | null {
  if (ctx) {
    if (ctx.state === 'suspended') void ctx.resume();
    return ctx;
  }
  const Ctor = (globalThis as { AudioContext?: typeof AudioContext }).AudioContext;
  if (!Ctor) return null;
  ctx = new Ctor();
  /*
   * 总线上挂一个压缩器。**它不是装饰**：连点时的目的是「变噪音」，
   * 但叠起来的峰值会直接把输出削成刺耳的方波数字化失真 —— 那会把
   * 「嘈杂」变成「破音」。压缩器把这件事交回给信号的形状处理。
   */
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -14;
  comp.knee.value = 12;
  comp.ratio.value = 8;
  comp.attack.value = 0.002;
  comp.release.value = 0.12;
  comp.connect(ctx.destination);
  master = comp;
  return ctx;
}

/** 白噪源。整块复用，每只 voice 自己新建 BufferSource 取各自的播放头。 */
function noiseBuffer(c: AudioContext): AudioBuffer {
  if (noiseBuf && noiseBuf.sampleRate === c.sampleRate) return noiseBuf;
  const len = Math.ceil(c.sampleRate * 0.5);
  const buf = c.createBuffer(1, len, c.sampleRate);
  const data = buf.getChannelData(0);
  const r = mulberry32(hashSeed('mascot-noise', len));
  for (let i = 0; i < len; i += 1) data[i] = r() * 2 - 1;
  noiseBuf = buf;
  return buf;
}

/**
 * tanh 饱和曲线。amount = 0 时接近线性，1 时接近方波。
 *
 * 返回类型显式写成 `Float32Array<ArrayBuffer>`：`WaveShaperNode.curve` 只接受
 * 非共享缓冲区的那个泛型（TS 5.7 起 TypedArray 带缓冲区参数），
 * 写成裸的 `Float32Array` 会被推成 `ArrayBufferLike` 而报错。
 */
function driveCurve(amount: number): Float32Array<ArrayBuffer> {
  const n = 1024;
  const curve = new Float32Array(n);
  const k = 1 + amount * 24;
  const norm = Math.tanh(k);
  for (let i = 0; i < n; i += 1) {
    const x = (i / (n - 1)) * 2 - 1;
    curve[i] = Math.tanh(k * x) / norm;
  }
  return curve;
}

/** 统一收尾：给每个源排好停止时刻，节点随即可以被 GC。 */
function stopAll(t: number, nodes: AudioScheduledSourceNode[]): void {
  for (const n of nodes) {
    try {
      n.stop(t);
    } catch {
      /* 已经停过 / 从未 start：忽略 */
    }
  }
}

/** 乐音那条路：振荡器 + 颤音 + 鼻音带通 + 噪声层。 */
function playTonal(c: AudioContext, out: AudioNode, plan: SqueakPlan, t0: number): void {
  const dur = plan.duration;

  const vca = c.createGain();
  vca.gain.setValueAtTime(0, t0);
  vca.gain.linearRampToValueAtTime(plan.peak, t0 + plan.attack);
  vca.gain.exponentialRampToValueAtTime(0.0008, t0 + dur);
  vca.gain.linearRampToValueAtTime(0, t0 + dur + 0.02);
  vca.connect(out);

  const sum = c.createGain();
  sum.gain.value = 1;
  if (plan.drive > 0.02) {
    const shaper = c.createWaveShaper();
    shaper.curve = driveCurve(plan.drive);
    shaper.oversample = '2x';
    sum.connect(shaper);
    shaper.connect(vca);
  } else {
    sum.connect(vca);
  }

  const sources: AudioScheduledSourceNode[] = [];
  const tPeak = t0 + dur * 0.16;
  const tSettle = t0 + dur * 0.75;

  /** 两个振荡器共用频率轨迹。 */
  const track = (f: AudioParam): void => {
    f.setValueAtTime(plan.freq * plan.glide[0], t0);
    f.exponentialRampToValueAtTime(plan.freq * plan.glide[1], tPeak);
    f.exponentialRampToValueAtTime(plan.freq * plan.glide[2], tSettle);
  };

  // 鼻音带通：两个振荡器共用一个 filter（否则「错音」会被削成两条带）。
  const band = c.createBiquadFilter();
  band.type = 'bandpass';
  band.frequency.setValueAtTime(plan.filterFreq, t0);
  band.Q.setValueAtTime(plan.filterQ, t0);
  band.connect(sum);

  const osc = c.createOscillator();
  osc.type = plan.wave;
  track(osc.frequency);
  const oscGain = c.createGain();
  oscGain.gain.value = 1;
  osc.connect(oscGain);
  oscGain.connect(band);
  osc.start(t0);
  sources.push(osc);

  // 颤音：LFO 直接调制频率。它不经过带通，所以不受鼻音带通削顶。
  const lfo = c.createOscillator();
  lfo.type = 'sine';
  lfo.frequency.setValueAtTime(plan.vibRate, t0);
  const lfoGain = c.createGain();
  lfoGain.gain.setValueAtTime(plan.vibDepth, t0);
  lfo.connect(lfoGain);
  lfoGain.connect(osc.frequency);
  lfo.start(t0);
  sources.push(lfo);

  if (plan.detuneMix > 0.01) {
    const osc2 = c.createOscillator();
    osc2.type = plan.wave;
    // 自己排一遍轨迹（乘上错音比）——**不要**先调 track() 再覆盖：
    // 同一参数上叠两套自动化事件，后面那套会把前面那套的斜坡切断。
    osc2.frequency.setValueAtTime(plan.freq * plan.glide[0] * plan.detuneRatio, t0);
    osc2.frequency.exponentialRampToValueAtTime(
      plan.freq * plan.glide[1] * plan.detuneRatio,
      tPeak,
    );
    osc2.frequency.exponentialRampToValueAtTime(
      plan.freq * plan.glide[2] * plan.detuneRatio,
      tSettle,
    );
    const g2 = c.createGain();
    g2.gain.value = plan.detuneMix;
    osc2.connect(g2);
    g2.connect(band);
    osc2.start(t0);
    sources.push(osc2);
  }

  // 摩擦噪声：独立带通，短包络。
  const nSrc = c.createBufferSource();
  nSrc.buffer = noiseBuffer(c);
  nSrc.loop = true;
  const nBand = c.createBiquadFilter();
  nBand.type = 'bandpass';
  nBand.frequency.setValueAtTime(plan.noiseFreq, t0);
  nBand.Q.setValueAtTime(plan.noiseQ, t0);
  const nGain = c.createGain();
  nGain.gain.setValueAtTime(0, t0);
  nGain.gain.linearRampToValueAtTime(plan.noise, t0 + 0.004);
  nGain.gain.exponentialRampToValueAtTime(0.0005, t0 + Math.max(0.01, plan.noiseDur));
  nSrc.connect(nBand);
  nBand.connect(nGain);
  nGain.connect(sum);
  nSrc.start(t0);
  sources.push(nSrc);

  stopAll(t0 + dur + 0.05, sources);
}

/**
 * 噪音那条路：整只不再是鸭子。
 *
 * ## 为什么是「高通 + 扫下来的低通」而不是带通
 *
 * 带通（无论 Q 多低）都会给一个中心频率，听起来是**口哨/哨音**；要让「坏掉」
 * 听起来像**白噪**，要的是**宽而不共振**：一个巴特沃斯低通（Q ≈ 0.5..1.1）
 * 从 ~10 kHz 扫到 ~1.5 kHz，前面再挂一个 200 Hz 高通把低鸣砍掉。
 * 频谱平、没有峰 → 就是噪声。这里**刻意不放振荡器** —— 有一版留了只 0.25
 * 增益的方波当「机械哭腔」，那一下就又有音高了，与「纯白噪音」正好相反。
 *
 * 振幅包络不走「一击即衰」，而是叠一段快速抖动（`flutter`）：真实的坏喇叭
 * 是断续的，恒定衰减的噪声听起来像风。
 */
function playNoise(c: AudioContext, out: AudioNode, plan: SqueakPlan, t0: number): void {
  const dur = Math.max(0.1, plan.duration * 1.6);

  const vca = c.createGain();
  vca.gain.setValueAtTime(0, t0);
  vca.gain.linearRampToValueAtTime(Math.min(0.55, plan.peak * 1.5), t0 + 0.004);
  vca.gain.exponentialRampToValueAtTime(0.0008, t0 + dur);
  vca.connect(out);

  // 高通：砍掉低鸣（不砍的话「白噪」里会混进一段闷响）。
  const hp = c.createBiquadFilter();
  hp.type = 'highpass';
  hp.frequency.setValueAtTime(plan.hissLo, t0);
  hp.Q.setValueAtTime(0.7, t0);
  hp.connect(vca);

  // 低通：从高处扫下来。Q 贴 0.707（巴特沃斯）—— 再高就是共振峰，会唱出音高。
  const lp = c.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.setValueAtTime(Math.min(16000, plan.hissHi), t0);
  lp.frequency.exponentialRampToValueAtTime(Math.max(300, plan.hissMid), t0 + dur);
  lp.Q.setValueAtTime(plan.hissQ, t0);
  lp.connect(hp);

  // 断续：坏喇叭是「啪啦啪啦」的，不是一条平稳的风声。
  const flutter = c.createGain();
  flutter.gain.setValueAtTime(1, t0);
  // 用方波 LFO 调制增益（1 ± 0.45），得到粗粝的颗粒感。
  const lfo = c.createOscillator();
  lfo.type = 'square';
  lfo.frequency.setValueAtTime(plan.hissFlutter, t0);
  const lfoGain = c.createGain();
  lfoGain.gain.setValueAtTime(0.45, t0);
  lfo.connect(lfoGain);
  lfoGain.connect(flutter.gain);
  lfo.start(t0);
  flutter.connect(lp);

  const src = c.createBufferSource();
  src.buffer = noiseBuffer(c);
  src.loop = true;
  src.connect(flutter);
  src.start(t0);
  stopAll(t0 + dur + 0.05, [src, lfo]);
}

/**
 * 捏一下：出声，并回传本次的合成计划。
 *
 * 音频不可用时（无 Web Audio）照样推进计数与 stress —— 统计描述的是
 * 「用户捏了几下」，不是「扬声器响了几下」。
 */
export function poke(nowMs: number = performance.now()): SqueakPlan {
  clicks.push(nowMs);
  while (clicks.length > 0 && nowMs - clicks[0]! > STRESS_WINDOW_SEC * 1000) clicks.shift();

  lastStress = stressFrom(clicks, nowMs);
  seq += 1;
  // 种子 = 第几次 + 墙钟毫秒：连点两次也不会撞成同一只鸭子。
  const plan = squeakPlan(hashSeed(seq, Math.round(nowMs)), lastStress);
  lastPlan = plan;
  squeaks += 1;
  if (plan.noiseMode) noiseBursts += 1;

  const c = audio();
  if (c && master) {
    const t0 = c.currentTime + 0.006;
    if (plan.noiseMode) playNoise(c, master, plan, t0);
    else playTonal(c, master, plan, t0);
  }
  return plan;
}

/** E2E / 调试读数。 */
export function mascotStats(): PokeStats {
  return {
    squeaks,
    noiseBursts,
    stress: lastStress,
    lastPlan,
    audioState: ctx ? ctx.state : 'none',
  };
}

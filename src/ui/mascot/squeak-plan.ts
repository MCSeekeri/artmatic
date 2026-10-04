/**
 * squeak-plan.ts — 「捏一下」的合成参数（**纯函数**，不碰 Web Audio、不碰 DOM）。
 *
 * 为什么把它单独抽出来：橡皮鸭的响声听起来是「一坨声音」，但真正决定像不像的
 * 只有十几个数字（基频、频率轨迹、颤音、包络、鼻音带通、噪声层、错音、失真）。
 * 这些数字是**从随机数推出来的**，把它做成纯函数之后，「音高随机」与「点太频
 * 繁变噪音」这两条行为就能被单测钉住 —— 而 `squeak.ts` 里剩下的只是把这些
 * 数字接到音频节点上，没有判断可测。
 *
 * ## 随机是带种子的
 *
 * 硬约束 1.2（`core/prng.ts`）在本项目里是全局的：`Math.random()` 一律禁止。
 * 这里的种子由调用方给（`squeak.ts` 用「第几次 + 墙钟毫秒」派生），所以
 * **同一个 seed + 同一个 stress 永远得到同一份计划** —— 单测可以逐字段比对。
 *
 * ## 两个旋钮
 *
 * 1. `seed` 决定「这一下捏的是什么声音」：音高、波形、颤音、带通、噪声量。
 * 2. `stress`（0..1）决定「你有多急」：越急音高越乱、波形越刺耳、噪声层越厚、
 *    包络越短、失真越重，到 `NOISE_MODE_CLICKS` 次/窗口就整只变成噪音爆。
 *
 * ⚠️ 所有**基础值先抽完、再整体乘 stress 的系数**。顺序反过来的话，
 * 「同一个 seed、不同 stress」就不再是同一只鸭子了，单调性也无从断言。
 */

import { hashSeed, mulberry32 } from '../../core/prng';

/** 「急不急」的统计窗口（秒）。超窗口的点击不再计入。 */
export const STRESS_WINDOW_SEC = 2.2;

/** 窗口内多少次点击 = stress 满值 1。 */
export const STRESS_FULL_CLICKS = 10;

/** 窗口内达到这么多次点击 → 放弃乐音，直接给噪音。 */
export const NOISE_MODE_CLICKS = 8;

/** 噪音门槛（= `NOISE_MODE_CLICKS / STRESS_FULL_CLICKS`）。 */
export const NOISE_MODE_STRESS = NOISE_MODE_CLICKS / STRESS_FULL_CLICKS;

/**
 * 频率轨迹：起 / 峰 / 收三个点，乘子相对基频。
 * 橡皮鸭是「捏扁时气被挤出去」——频率先冲高再落回来。
 */
export type Glide = readonly [number, number, number];

export interface SqueakPlan {
  /** 基频（Hz）。这就是「音高」。 */
  freq: number;
  /** 频率轨迹三段乘子。 */
  glide: Glide;
  /** 主振荡器波形。 */
  wave: OscillatorType;
  /** 颤音速率（Hz）与深度（Hz）。颤音是「橡胶」感的来源。 */
  vibRate: number;
  vibDepth: number;
  /** 包络（秒）。 */
  attack: number;
  duration: number;
  /** 鼻音带通（formant）。freq 越低越闷、越「脏」。 */
  filterFreq: number;
  filterQ: number;
  /** 噪声层（挤橡胶的摩擦声）。 */
  noise: number;
  noiseFreq: number;
  noiseQ: number;
  noiseDur: number;
  /**
   * 噪音爆（`noiseMode`）用的**宽带**参数：高通角 / 低通起 / 低通落 / Q。
   *
   * 为什么不复用上面那组：`noiseFreq` + `noiseQ` 描述的是**窄带**摩擦声
   * （Q 1..3.6），拿它做「坏掉的鸭子」会听起来像口哨。要的是**白噪**——
   * 判定「白」的不是中心频率而是**带宽**：Q 必须贴着 0.5..1.1（巴特沃斯），
   * 低通还得在两个八度以上扫过。这两条是可断言的，见单测。
   */
  hissLo: number;
  hissHi: number;
  hissMid: number;
  hissQ: number;
  /** 振幅抖动速率（Hz）：坏喇叭是「啪啦啪啦」的，不是一条平稳的风声。 */
  hissFlutter: number;
  /** 第二振荡器：错音频率比与混入量。越急越明显（= 越不像鸭子）。 */
  detuneRatio: number;
  detuneMix: number;
  /** 波形整形驱动量 0..1。 */
  drive: number;
  /** 峰值增益。 */
  peak: number;
  /** 真时走 `playNoise` 那条路（不再是乐音）。 */
  noiseMode: boolean;
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/**
 * 窗口内最近一次「急」的程度，0..1。
 *
 * `clicks` 是**墙钟毫秒**时间戳（升序无所谓，这里只数窗口内的）。
 * 纯函数：给同一份点击序列与同一个 now，永远同一结果 —— 所以它随时间自然
 * 衰减（老点击滑出窗口），不需要任何定时器去「降温」。
 */
export function stressFrom(clicks: readonly number[], now: number): number {
  let n = 0;
  for (const t of clicks) {
    const dt = now - t;
    if (dt >= 0 && dt <= STRESS_WINDOW_SEC * 1000) n += 1;
  }
  return Math.min(1, n / STRESS_FULL_CLICKS);
}

/**
 * 一份合成计划。`seed` 决定音色，`stress` 决定「被点急成什么样」。
 *
 * 波形在 `stress > 0.55` 之后固定为 square：这是刻意的 —— 高频、成分为奇数
 * 谐波的方波在带通里会变成刺耳的蜂鸣，比继续随机更接近「噪音化」的听感。
 */
export function squeakPlan(seed: number, stress: number): SqueakPlan {
  const s = clamp(stress, 0, 1);
  const r = mulberry32(hashSeed('mascot-squeak', seed));

  /* ---- 基础值：与 stress 无关，先一次性抽完 ---- */
  const bFreq = 720 + r() * 620; // 720..1340 Hz，橡皮鸭的典型音区
  const bWave = (['sawtooth', 'square', 'triangle'] as const)[Math.floor(r() * 3)]!;
  const bVibRate = 34 + r() * 40;
  const bVibMul = 0.018 + r() * 0.03; // 相对基频
  const bAttack = 0.004 + r() * 0.007;
  const bDuration = 0.15 + r() * 0.13;
  const bFilterMul = 2.6 + r() * 2.4;
  const bQ = 2.2 + r() * 4.5;
  const bNoise = 0.05 + r() * 0.1;
  const bNoiseFreq = 1700 + r() * 2600;
  const bNoiseQ = 1 + r() * 2.6;
  const bNoiseDur = 0.012 + r() * 0.028;
  const bRatio = r() < 0.5 ? 1.42 + r() * 0.16 : 0.62 + r() * 0.14;
  const bPeak = 0.3 + r() * 0.1;
  const bGlide: Glide = [0.7 + r() * 0.18, 1.1 + r() * 0.22, 1 + (r() - 0.5) * 0.16];
  // 宽带白噪那一组：高通压掉低鸣，低通在 1.6 个八度以上扫下来 —— 扫幅越宽、
  // 越没有共振峰，就越接近白噪而不是口哨。
  const bHissLo = 180 + r() * 220;
  const bHissHi = 9000 + r() * 5000;
  const bHissMid = 1200 + r() * 1400;
  const bHissQ = 0.6 + r() * 0.5;
  const bHissFlutter = 16 + r() * 14;

  /* ---- stress 侧：唯一一个「越急越乱」的随机量 ---- */
  const jitter = (r() - 0.5) * 2 * (0.05 + 0.55 * s);

  /* ---- 合成 ---- */
  const freq = clamp(bFreq * (1 + jitter), 180, 3200);
  const gSpread = 1 + 0.6 * s;
  const duration = bDuration * (1 - 0.45 * s);

  return {
    freq,
    // 起 / 峰 的偏离量随 stress 放大（收点 g2 本来就接近 1，放大同样处理）。
    glide: [
      1 - (1 - bGlide[0]) * gSpread,
      1 + (bGlide[1] - 1) * gSpread,
      1 + (bGlide[2] - 1) * (1 + 0.8 * s),
    ],
    wave: s > 0.55 ? 'square' : bWave,
    vibRate: bVibRate * (1 + 1.6 * s),
    vibDepth: bFreq * bVibMul * (1 + 2.2 * s),
    attack: bAttack * (1 - 0.6 * s) + 0.001,
    duration,
    // 带通跟着**基频**走（不是跟着抖动后的 freq）——这样「越急越闷」是单调的。
    filterFreq: clamp(bFreq * bFilterMul * (1 - 0.5 * s), 300, 7000),
    filterQ: bQ * (1 + 0.9 * s),
    noise: clamp(bNoise + 0.55 * s, 0, 0.85),
    noiseFreq: bNoiseFreq * (1 + 0.6 * s),
    noiseQ: bNoiseQ,
    noiseDur: Math.min(duration, bNoiseDur * (1 + 3 * s)),
    hissLo: bHissLo,
    hissHi: bHissHi * (1 + 0.2 * s),
    // 越急扫得越低（越闷、越像「喇叭糊了」），但始终与起点差一个八度以上。
    hissMid: bHissMid * (1 - 0.25 * s),
    hissQ: bHissQ * (1 - 0.3 * s),
    hissFlutter: bHissFlutter * (1 + 0.8 * s),
    detuneRatio: bRatio,
    detuneMix: 0.08 + 0.72 * s,
    drive: 0.15 + 0.85 * s,
    peak: bPeak * (1 - 0.3 * s),
    noiseMode: s >= NOISE_MODE_STRESS,
  };
}

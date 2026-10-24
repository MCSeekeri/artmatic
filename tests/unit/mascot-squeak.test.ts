import { describe, expect, it } from 'vitest';
import {
  NOISE_MODE_CLICKS,
  NOISE_MODE_STRESS,
  STRESS_FULL_CLICKS,
  STRESS_WINDOW_SEC,
  squeakPlan,
  stressFrom,
} from '../../src/ui/mascot/squeak-plan';

/**
 * 看板娘捏响的**参数层**回归。
 *
 * 这一层值得测，而 `squeak.ts` 不值得：合成节点图的对错只能靠耳朵，
 * 但「音高是不是真的随机」「点急了是不是真的转噪音」两条行为全在
 * 纯函数里，且都是可以写反的（比如把 stress 的系数乘在随机之前、
 * 或者把 noiseMode 的判据写成 `>` 而不是 `>=`）。耳朵听不出来的接线错误
 * 由 E2E 读 `mascotStats()` 兜。
 *
 * 判据都选「机制性」的量：单调性断的是**同一个 seed 下随 stress 的走向**
 * （不是两个随机样本的大小关系），所以它不会因为随机性本身而偶发假红。
 */

const T0 = 1_000_000;
const MS = 1000;
/**
 * 「连点」的间隔。必须让 `STRESS_FULL_CLICKS` 次点击**全部落进窗口**——
 * 间隔取 1 秒的话 10 次点击跨了 9 秒，窗口里只剩 3 次，那是测试写错而不是
 * 函数写错（第一次就是栽在这儿）。取 120 ms：10 次共 1.08 s < 2.2 s。
 */
const GAP = 120;

describe('stressFrom：窗口内的点击密度', () => {
  it('没有点击就是 0', () => {
    expect(stressFrom([], T0)).toBe(0);
  });

  it('窗口内每多一次就多一档', () => {
    expect(stressFrom([T0], T0)).toBeCloseTo(1 / STRESS_FULL_CLICKS, 10);
    expect(stressFrom([T0, T0 - GAP], T0)).toBeCloseTo(2 / STRESS_FULL_CLICKS, 10);
  });

  it('满档点击给 1，再多也钳在 1', () => {
    const full = Array.from({ length: STRESS_FULL_CLICKS }, (_, i) => T0 - i * GAP);
    expect(stressFrom(full, T0)).toBe(1);
    const over = Array.from({ length: STRESS_FULL_CLICKS * 3 }, (_, i) => T0 - i * GAP);
    expect(stressFrom(over, T0)).toBe(1);
  });

  it('滑出窗口的点击不再计数（这就是「降温」，不需要定时器）', () => {
    const old = T0 - STRESS_WINDOW_SEC * MS - 1;
    expect(stressFrom([old], T0)).toBe(0);
  });

  it('恰好落在窗口边界上仍算在内', () => {
    expect(stressFrom([T0 - STRESS_WINDOW_SEC * MS], T0)).toBeCloseTo(1 / STRESS_FULL_CLICKS, 10);
  });

  it('未来的时间戳不算（时钟回拨不该把 stress 顶满）', () => {
    expect(stressFrom([T0 + 50 * MS], T0)).toBe(0);
  });

  it('噪音门槛就是「窗口内点够 NOISE_MODE_CLICKS 次」', () => {
    const clicks = Array.from({ length: NOISE_MODE_CLICKS }, (_, i) => T0 - i * GAP);
    expect(stressFrom(clicks, T0)).toBeGreaterThanOrEqual(NOISE_MODE_STRESS);
    const fewer = clicks.slice(1);
    expect(stressFrom(fewer, T0)).toBeLessThan(NOISE_MODE_STRESS);
  });
});

describe('squeakPlan：同一份输入永远同一只鸭子', () => {
  it('seed 与 stress 相同 → 逐字段相同', () => {
    expect(squeakPlan(12345, 0.3)).toEqual(squeakPlan(12345, 0.3));
  });

  it('seed 变了 → 音高确实换了（不是每次都同一个音）', () => {
    const freqs = Array.from({ length: 32 }, (_, i) => squeakPlan(i, 0).freq);
    expect(new Set(freqs).size, '32 个 seed 应该给出很多不同音高').toBeGreaterThan(24);
  });
});

describe('squeakPlan：参数本身是合法的', () => {
  const seeds = Array.from({ length: 40 }, (_, i) => i * 977 + 3);
  const stresses = [0, 0.25, 0.5, 0.7, NOISE_MODE_STRESS, 1];

  it('无论怎么随机，频率与包络都在可听的范围内', () => {
    for (const seed of seeds) {
      for (const s of stresses) {
        const p = squeakPlan(seed, s);
        expect(p.freq, `seed=${seed} s=${s}`).toBeGreaterThanOrEqual(180);
        expect(p.freq).toBeLessThanOrEqual(3200);
        expect(p.attack).toBeGreaterThan(0);
        expect(p.attack, '起音必须短于整段').toBeLessThan(p.duration);
        expect(p.duration).toBeGreaterThanOrEqual(0.05);
        expect(p.duration).toBeLessThanOrEqual(0.5);
        expect(p.peak).toBeGreaterThan(0);
        expect(p.peak).toBeLessThanOrEqual(0.5);
        expect(p.filterFreq).toBeGreaterThanOrEqual(300);
        expect(p.filterFreq).toBeLessThanOrEqual(7000);
        expect(p.filterQ).toBeGreaterThan(0);
        expect(p.vibDepth).toBeGreaterThan(0);
        expect(p.noise).toBeGreaterThanOrEqual(0);
        expect(p.noise).toBeLessThanOrEqual(0.85);
        expect(p.noiseDur).toBeGreaterThan(0);
        // exponentialRamp 的两端都必须 > 0，否则 Web Audio 直接抛
        expect(p.glide.every((g) => g > 0.05)).toBe(true);
        expect(p.detuneRatio).toBeGreaterThan(0.3);
        expect(p.detuneRatio).toBeLessThan(1.8);
        expect(p.hissLo).toBeGreaterThan(20);
        expect(p.hissMid).toBeGreaterThan(p.hissLo);
        expect(p.hissHi).toBeGreaterThan(p.hissMid);
        expect(p.hissFlutter).toBeGreaterThan(0);
      }
    }
  });

  it('stress 越界会被钳住，不会算出负的包络', () => {
    const low = squeakPlan(9, -5);
    const high = squeakPlan(9, 5);
    expect(low).toEqual(squeakPlan(9, 0));
    expect(high).toEqual(squeakPlan(9, 1));
  });
});

describe('squeakPlan：越急越坏（同一个 seed 下才可比）', () => {
  /*
   * 判据是**同一 seed 在不同 stress 下的走向**：基础值先抽完再乘 stress 的
   * 系数，所以这些量随 stress 单调。换 seed 比大小是没有意义的（那比的是两只
   * 不同的鸭子）。低于噪音门槛的区间才做单调性 —— 进了 noiseMode 之后
   * 这些字段已经不再描述「乐音」了。
   */
  const seeds = [1, 42, 777, 31337];
  const a = 0;
  const b = NOISE_MODE_STRESS - 0.05;

  it('包络变短、噪声层变厚、错音与失真变重', () => {
    for (const seed of seeds) {
      const calm = squeakPlan(seed, a);
      const rushed = squeakPlan(seed, b);
      expect(rushed.duration, `seed=${seed}`).toBeLessThan(calm.duration);
      expect(rushed.noise).toBeGreaterThan(calm.noise);
      expect(rushed.detuneMix).toBeGreaterThan(calm.detuneMix);
      expect(rushed.drive).toBeGreaterThan(calm.drive);
      expect(rushed.vibRate).toBeGreaterThan(calm.vibRate);
      expect(rushed.filterQ).toBeGreaterThan(calm.filterQ);
      // 「闷」= 鼻音带通中心往下走
      expect(rushed.filterFreq).toBeLessThan(calm.filterFreq);
    }
  });

  it('急了就固定用方波（更容易被带通削成刺耳的蜂鸣）', () => {
    for (const seed of seeds) {
      expect(squeakPlan(seed, 0.7).wave).toBe('square');
    }
  });

  it('音高抖动只在急的时候明显放大', () => {
    // 以**同一个 seed 在 stress=0 时的音高**当基准（那是最小抖动的一次抽样），
    // 看偏离量的中位数怎么随 stress 走。取 64 个 seed 的中位数而不是平均值：
    // 均匀分布的绝对值它不会被单个极端样本带偏。
    const spread = (s: number): number => {
      const dev = Array.from({ length: 64 }, (_, i) => {
        const calm = squeakPlan(i, 0).freq;
        return Math.abs(squeakPlan(i, s).freq - calm) / calm;
      }).sort((x, y) => x - y);
      return dev[Math.floor(dev.length / 2)]!;
    };
    expect(spread(0)).toBe(0); // 自比 ⇒ 恒 0，这条同时证明上面那句「基准」没说错
    expect(spread(0.2)).toBeGreaterThan(spread(0));
    expect(spread(0.7)).toBeGreaterThan(spread(0.2));
  });
});

describe('squeakPlan：噪音门槛', () => {
  it('门槛之下还是鸭子', () => {
    expect(squeakPlan(5, 0).noiseMode).toBe(false);
    expect(squeakPlan(5, NOISE_MODE_STRESS - 0.01).noiseMode).toBe(false);
  });

  it('门槛之上（含恰好等于）就是噪音', () => {
    expect(squeakPlan(5, NOISE_MODE_STRESS).noiseMode).toBe(true);
    expect(squeakPlan(5, 1).noiseMode).toBe(true);
  });
});

describe('squeakPlan：坏掉之后要像**白噪**，不是口哨', () => {
  /*
   * 「白」的判据是**带宽**，不是中心频率：Q 贴着巴特沃斯（≤ 1.1）且低通在
   * 一个半八度以上扫过，频谱才是平的。Q 一高就出现共振峰 → 听起来是哨音，
   * 而那正是第一版「坏掉的鸭子」的味道（当时还用 bandpass 扫频 + 一只方波，
   * 有明确的音高）。这两条都能被改坏，所以值得钉住。
   */
  const seeds = Array.from({ length: 40 }, (_, i) => i * 613 + 11);
  const stresses = [0, 0.4, NOISE_MODE_STRESS, 1];

  it('低通的 Q 永远贴着巴特沃斯（有共振峰就不是白噪）', () => {
    for (const seed of seeds) {
      for (const s of stresses) {
        const p = squeakPlan(seed, s);
        expect(p.hissQ, `seed=${seed} s=${s}`).toBeGreaterThan(0.4);
        expect(p.hissQ, `seed=${seed} s=${s}`).toBeLessThanOrEqual(1.1);
      }
    }
  });

  it('扫频跨度至少一个半八度（窄带扫频会有可辨的音高）', () => {
    for (const seed of seeds) {
      for (const s of stresses) {
        const p = squeakPlan(seed, s);
        expect(p.hissHi / p.hissMid, `seed=${seed} s=${s}`).toBeGreaterThan(3);
      }
    }
  });


  it('越急扫得越低、Q 越宽（更闷更散）', () => {
    for (const seed of [3, 77, 9001]) {
      const calm = squeakPlan(seed, 0);
      const rushed = squeakPlan(seed, NOISE_MODE_STRESS);
      expect(rushed.hissMid).toBeLessThan(calm.hissMid);
      expect(rushed.hissQ).toBeLessThan(calm.hissQ);
      expect(rushed.hissHi).toBeGreaterThan(calm.hissHi);
      expect(rushed.hissFlutter).toBeGreaterThan(calm.hissFlutter);
    }
  });
});

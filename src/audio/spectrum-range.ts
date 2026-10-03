/**
 * spectrum-range.ts — 给音频律动条用的**滚动归一化**（移植自 openmosh，MIT）。
 *
 * 为什么需要它：普通音乐只占到 dB 窗口的一小截（bin 常落在 0.4–0.85，两头都够不着）。
 * 照原样画出来，条子永远半高，drop 来了也不怎么动。两步修正：
 *
 * 1. **逐 bin 扣地板。** 每个 bin 维护自己的滚动低点，画的是「它比自己的静息水平
 *    高出多少」而不是绝对值 —— 这一步把范围的底部收回来。
 * 2. **共享一个滚动天花板。** 之后再除以一个**跨所有 bin** 的滚动峰值，而不是逐 bin 的。
 *    逐 bin 的天花板会把每个频段各自顶到满量程，恰好把这个可视化要展示的东西抹平
 *    （整体响度就完全读不出来了）。共享意味着「响的一段会把所有条子一起抬起来」，
 *    而天花板跟得慢，所以动态在读出来之后它才追上来。
 *
 * 时间常数是不对称的（逼近新极值快、从极值退回来慢），并且全部按「秒 × 帧差」推进 ——
 * 这是 60fps 预览与 30fps 导出能收敛到同一条包络的前提，否则渲染出来的和预览看到的
 * 不是一回事（openmosh 原本从实时 AnalyserNode 取数，导出没有对应物，注释里承认了这个坑；
 * Artmatic 用离线频谱，同一份数据。）
 *
 * **状态是显式的**（类实例而不是模块级全局）：归一化器是有状态、顺序相关的，
 * 硬约束 1.3 要求它可复现 —— 那么「什么时候重置」就必须是调用方看得见的一件事。
 */

/** 逼近新极值要快、退回要慢。 */
function approach(current: number, target: number, tau: number, step: number): number {
  return current + (target - current) * (1 - Math.exp(-step / tau));
}

/**
 * 卡住的时钟会让包络直接贴到输入上，所以帧差夹到 0.25 s。
 * （掉帧、后台标签页、导出时的长阻塞都会给出荒谬的 dt。）
 */
function stepOf(dt: number): number {
  return Math.max(0, Math.min(dt, 0.25));
}

/**
 * 平滑滑杆 → 包络跟随的攻放时间常数。
 *
 * 与音量联动共用同一条曲线，于是「平滑」这个滑杆在两处的含义一致：
 * 上升保持快（鼓点还是鼓点），下降是上升的好几倍（条子滑回去而不是在两次击打之间塌掉）。
 */
export function followerTaus(smoothing: number): { attack: number; release: number } {
  const s = Math.max(0, Math.min(1, smoothing));
  return { attack: 0.02 + s * 0.08, release: 0.05 + s * s * 0.95 };
}

/**
 * 天花板几乎等于峰值保持：它必须能在瞬态**之内**够到瞬态的顶。
 * 原来取 0.3 时够不到，打击乐素材上它会一路塌到 MIN_CEIL，所有条子削平在满高，
 * 显示就分辨不出「响」和「非常响」了。只留一点点延迟，让单帧尖峰还得撑住一拍才算数。
 */
const CEIL_RISE_TAU = 0.03;
const CEIL_FALL_TAU = 2.5;

/** 逐 bin 地板取最小值的时间窗（保留两窗，等效回看 1–2 个窗口）。 */
const FLOOR_WINDOW = 2;
/**
 * 比 rise 快得多是有意的：地板没降回来之前，这个 bin 的高度会被钳在 0，
 * 所以从硬切进 breakdown 会让显示整块空掉 —— 0.3 s 时那持续约 300 ms，
 * 读起来是「卡了一下」而不是动态。减半在稳态下不要钱，又远高于信号自身抖动的尺度。
 */
const FLOOR_FALL_TAU = 0.15;
/** 比 fall 慢，否则一个持续音会悄悄把自己擦掉。 */
const FLOOR_RISE_TAU = 4;

/**
 * 用来除的最小天花板，也就是会被拉满的最小动态范围。
 *
 * 数字静音在任何取值下都安全（每个高度精确为 0）。它防的是更常见的一档：
 * 房间底噪、淡出尾巴、滤波后的 pad —— 0.08 时一个 barely 动过自己地板的信号
 * 也被撑到约 60% 高度，于是「接近无声」看起来像副歌。真实素材轻松越过这个值
 * （bin 静息在 0.4–0.85，扣掉地板后高度有 0.2 以上），所以它只在真的没有动态
 * 可展示的素材上才生效。
 */
const MIN_CEIL = 0.15;

export class SpectrumRange {
  private floors: Float32Array | null = null;
  private heights: Float32Array | null = null;
  private out: Uint8Array | null = null;
  /** 正在走的窗口的最小值，以及上一个窗口的。 */
  private winMin: Float32Array | null = null;
  private prevMin: Float32Array | null = null;
  private windowT = 0;
  private ceil = MIN_CEIL;
  /** 逐实例的包络跟随器。 */
  private readonly followers = new Map<string, Float32Array>();

  /**
   * 信号不连续时调用：seek、换素材、导出开始。
   * 不调用的话，跨过一段静音之后的地板/天花板还停在旧位置上。
   */
  reset(): void {
    this.floors = null;
    this.heights = null;
    this.out = null;
    this.winMin = null;
    this.prevMin = null;
    this.windowT = 0;
    this.ceil = MIN_CEIL;
    this.followers.clear();
  }

  /** 实例消失时忘掉它的包络（不然那个 Map 会跟着工程一直长）。 */
  drop(key: string): void {
    this.followers.delete(key);
  }

  /**
   * 归一化一帧 FFT bin。返回值**只在下次调用前有效**（复用的缓冲）——
   * 拿到就立刻上传纹理，不要留着。
   */
  normalize(src: Uint8Array | null, dt: number): Uint8Array | null {
    if (!src || src.length === 0) return src;
    const n = src.length;
    if (!this.floors || this.floors.length !== n) {
      this.floors = new Float32Array(n);
      this.heights = new Float32Array(n);
      this.winMin = new Float32Array(n);
      this.prevMin = new Float32Array(n);
      this.out = new Uint8Array(n);
      // 用当帧播种，于是播放一开始就落在音乐真正所在的位置，
      // 而不是头几秒从零扫上去。
      for (let i = 0; i < n; i += 1) {
        const v = src[i]! / 255;
        this.floors[i] = v;
        this.winMin[i] = v;
        this.prevMin[i] = v;
      }
      this.windowT = 0;
      this.ceil = MIN_CEIL;
    }
    const step = stepOf(dt);
    const h = this.heights!;
    const o = this.out!;
    const wMin = this.winMin!;
    const pMin = this.prevMin!;
    const floors = this.floors!;

    let framePeak = 0;
    for (let i = 0; i < n; i += 1) {
      const v = src[i]! / 255;
      if (v < wMin[i]!) wMin[i] = v;
      // 目标是这个 bin 近期最安静的时候，而不是它此刻在哪 ——
      // 一个此刻很响的 bin 说明不了它的地板该在哪。
      const target = wMin[i]! < pMin[i]! ? wMin[i]! : pMin[i]!;
      const f = floors[i]!;
      floors[i] = approach(f, target, target < f ? FLOOR_FALL_TAU : FLOOR_RISE_TAU, step);
      const height = v - floors[i]!;
      h[i] = height > 0 ? height : 0;
      if (h[i]! > framePeak) framePeak = h[i]!;
    }

    // 滚动窗口：刚走完的那个成为对照，下一个从敞开开始 ——
    // 这样「地板确实抬起来了」才有可能被发现。
    this.windowT += step;
    if (this.windowT >= FLOOR_WINDOW) {
      this.windowT = 0;
      for (let i = 0; i < n; i += 1) {
        pMin[i] = wMin[i]!;
        wMin[i] = src[i]! / 255;
      }
    }

    this.ceil = approach(
      this.ceil,
      framePeak,
      framePeak > this.ceil ? CEIL_RISE_TAU : CEIL_FALL_TAU,
      step,
    );
    const scale = 255 / Math.max(this.ceil, MIN_CEIL);
    for (let i = 0; i < n; i += 1) {
      const value = h[i]! * scale;
      o[i] = value > 255 ? 255 : value;
    }
    return o;
  }

  /**
   * 对已归一化的一帧做包络跟随，写进 `dest`。
   *
   * 按实例 id 键控而不是全局：平滑是**特效上的一个参数**，
   * 所以两个律动条实例完全可以对同一帧音频要不同的平滑。
   */
  smooth(
    key: string,
    src: Uint8Array,
    dest: Uint8Array,
    dt: number,
    smoothing: number,
  ): void {
    const n = src.length;
    let env = this.followers.get(key);
    if (!env || env.length !== n) {
      env = new Float32Array(n);
      for (let i = 0; i < n; i += 1) env[i] = src[i]!;
      this.followers.set(key, env);
    }
    const { attack, release } = followerTaus(smoothing);
    const step = stepOf(dt);
    const upK = 1 - Math.exp(-step / attack);
    const downK = 1 - Math.exp(-step / release);
    for (let i = 0; i < n; i += 1) {
      const v = src[i]!;
      env[i]! += (v - env[i]!) * (v > env[i]! ? upK : downK);
      dest[i] = env[i]!;
    }
  }
}

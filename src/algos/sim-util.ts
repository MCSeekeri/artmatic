/**
 * sim-util.ts — `sim` 型生成器共用的三件机械。
 *
 * 抽出来的理由：Wave 2 一次加 9 个 sim，而「环形快照 + 抽稀」「按密度撒种」
 * 「居中团块」这三段算术每个生成器都要用一遍。各写一份的下场不是「多打几个字」，
 * 而是**快照上限这种事只要有一个人写了、另一个人没写，内存泄漏就回来**。
 *
 * ## 为什么速度控制不在这里
 *
 * 曾经考虑过一个 `stepBudget`（每帧最多推进几步，超了就停）。**否掉了**：
 * 一旦在运行期砍步数，`seek(f)` 就不再等于「从 0 顺序 step f 次」——
 * 那是硬约束 1.3 直接禁止的。正确做法是把「付得起的步数」写进每个 def 的
 * `rate` 参数的 `max`：超预算的配置根本选不出来，而不是选出来之后偷偷降级。
 */

/** 能按下标写数的稠密数组（`Uint8Array` / `Float32Array` / `Uint32Array`…）。 */
export interface NumberArray {
  length: number;
  [i: number]: number;
}

/* --------------------------------------------------------------- 快照环 */

export interface SnapshotRingOptions<T> {
  /** 每多少步存一张。 */
  every: number;
  /** 最多保留多少张。超过就抽稀（不是丢弃）。 */
  cap: number;
  clone: (value: T) => T;
}

interface Entry<T> {
  frame: number;
  value: T;
}

/**
 * 有界快照环。
 *
 * ## 为什么不能简单地「只留最近 N 张」
 *
 * 那样回退到很早的帧时就只剩「从第 0 帧重放」这一条路 —— 反应扩散跑满 600 秒
 * 是 7 万步，重放一次就是几秒的卡死。所以这里用**抽稀阶梯**：
 *
 * - 第 0 帧**恒存**（任何回退都能从它重放出来）；
 * - 超过 `cap` 张时把阶梯加倍（只保留「槽位号 % stride === 0」的），
 *   于是一次抽稀就把张数降回约 `cap/2`；
 * - 回放上界因此有保证：最多 `every × stride` 步，且 stride 每次翻倍。
 *
 * 结果：内存有硬上限，回放代价有上界，而 `seek(f) ≡ 顺序 step f 次` 不受影响
 * —— 每张快照都是它那一帧的**精确状态副本**，从哪张重放都得到同一个结果。
 * （前提：快照存的是内部高精度数组的副本，**不是** `current()` 的 8-bit 量化输出。）
 *
 * 刻意**不在回退时丢弃 newer 快照**：`step` 是确定性的，同一帧的旧快照与新算出来的
 * 状态逐位相同，留着还能省一次重放。`langtons-ant` 原来会丢，那是浪费。
 */
export class SnapshotRing<T> {
  private readonly map = new Map<number, T>();
  /** 抽稀阶梯：只保留「槽位号 % stride === 0」的快照。 */
  private stride = 1;

  constructor(
    private readonly opts: SnapshotRingOptions<T>,
    initial: T,
  ) {
    this.map.set(0, opts.clone(initial));
  }

  /** 该帧是否值得存（`frame % every === 0` 才存）。 */
  shouldStore(frame: number): boolean {
    return frame > 0 && frame % this.opts.every === 0;
  }

  /** 存一张，必要时抽稀。调用方负责只在 `shouldStore(frame)` 为真时调用。 */
  store(frame: number, value: T): void {
    this.map.set(frame, this.opts.clone(value));
    if (this.map.size > this.opts.cap) this.decimate();
  }

  /** ≤ `target` 的最近一张。第 0 帧恒在，所以**永远找得到**。 */
  nearestAtOrBefore(target: number): Entry<T> {
    let best = 0;
    let found = false;
    for (const k of this.map.keys()) {
      if (k <= target && (!found || k > best)) {
        best = k;
        found = true;
      }
    }
    const value = this.map.get(best);
    if (value === undefined) {
      // 理论上不可达：构造函数就放了第 0 帧。留着是为了不在类型上撒谎。
      throw new Error('SnapshotRing: 第 0 帧不见了（构造后被改过？）');
    }
    return { frame: best, value };
  }

  /** 当前保留的张数（单测用）。 */
  get size(): number {
    return this.map.size;
  }

  /** 当前抽稀阶梯（单测用）。 */
  get currentStride(): number {
    return this.stride;
  }

  private decimate(): void {
    this.stride *= 2;
    for (const k of [...this.map.keys()]) {
      if (k === 0) continue; // 第 0 帧恒存 —— 抽掉它就没有任何回退路径了
      if ((k / this.opts.every) % this.stride !== 0) this.map.delete(k);
    }
  }
}

/* --------------------------------------------------------------- 初值 */

/**
 * 按密度在整场撒 `value`（种子的随机源由调用方给 —— 见硬约束 1.2，
 * 禁止裸 `Math.random()`）。
 *
 * 无 `value`（= 0）的位置一律写 0，所以它同时是「填零 + 撒种」。
 */
export function scatterInto(
  state: NumberArray,
  rng: () => number,
  density: number,
  value = 1,
): void {
  const d = Math.max(0, Math.min(1, density));
  for (let i = 0; i < state.length; i++) state[i] = rng() < d ? value : 0;
}

/**
 * 居中的方形团块。反应扩散的「一滴化学物质」、Lenia / SmoothLife 的
 * 「一个小岛」都是它 —— 团的**尺寸**是控制「长出几团」的主参数。
 *
 * `base` 是团外填的值（反应扩散要 u=1 而 v=0，所以两者不能共用一个填值）。
 */
export function centeredBlobInto(
  state: NumberArray,
  w: number,
  h: number,
  radius: number,
  value: number,
  base = 0,
): void {
  const r = Math.max(1, Math.round(radius));
  const cx = w >> 1;
  const cy = h >> 1;
  for (let y = 0; y < h; y++) {
    const dy = y - cy;
    for (let x = 0; x < w; x++) {
      const dx = x - cx;
      state[y * w + x] = dx * dx + dy * dy <= r * r ? value : base;
    }
  }
}

/* --------------------------------------------------------------- 稀疏核卷积 */

/**
 * 只保留权重 > `eps` 的抽头（预计算）。
 *
 * 为什么必须稀疏：Lenia / SmoothLife 的核活脱脱是「半径 R 的圆盘」——
 * 朴素的 `(2R+1)²` 在 R=20 时是 1681 个抽头，而环状核真正有值的那一圈
 * 只占其中一部分。把低于 eps 的丢掉，通常能省掉大半的乘法。
 *
 * 同时也把「环」这个形状变成一个数据表 —— 想换核只改这里的构造，不动卷积循环。
 */
export interface SparseKernel {
  dx: Int32Array;
  dy: Int32Array;
  /** 已归一化（Σw = 1）。 */
  w: Float32Array;
}

function buildKernel(R: number, weight: (dist: number) => number, eps: number): SparseKernel {
  const dxs: number[] = [];
  const dys: number[] = [];
  const ws: number[] = [];
  let sum = 0;
  for (let dy = -R; dy <= R; dy++) {
    for (let dx = -R; dx <= R; dx++) {
      const dist = Math.sqrt(dx * dx + dy * dy) / R;
      if (dist > 1) continue;
      const w = weight(dist);
      if (!(w > eps)) continue;
      dxs.push(dx);
      dys.push(dy);
      ws.push(w);
      sum += w;
    }
  }
  const w = new Float32Array(ws.length);
  for (let i = 0; i < ws.length; i++) w[i] = ws[i]! / sum;
  return { dx: Int32Array.from(dxs), dy: Int32Array.from(dys), w };
}

/**
 * 环状核：峰值在 `center`（相对半径，0..1），宽度 `width`。Lenia 用的就是它。
 * `center = 0.5` 是原论文的口径。
 *
 * ⚠️ **`eps` 在 `width = 0.15` 下几乎剪不掉东西。** 峰值在 d=0.5，权重
 * `exp(-(d-0.5)²/(2·0.15²))`；在 d=0（圆心）仍是 `exp(-5.6) ≈ 3.8e-3`，
 * 比 1e-4 大得多 —— 也就是说这个「环」实际是**整个圆盘**：实测 R=10 时
 * 317 个抽头，正好是 πR²。所以成本是 Θ(n²·πR²)，把 R 从 10 调到 16 是 2.5 倍。
 * 要真的省，得走 `TorusField` 那条路（消掉环面回绕的分支，实测 2.06×），
 * 或者把 `width` 调窄让 eps 真的起作用（会改变形态）。
 */
export function annulusKernel(R: number, center = 0.5, width = 0.15, eps = 1e-4): SparseKernel {
  return buildKernel(
    R,
    (d) => Math.exp(-((d - center) * (d - center)) / (2 * width * width)),
    eps,
  );
}

/** 实心圆盘核（SmoothLife 的内核）。 */
export function discKernel(R: number, eps = 1e-6): SparseKernel {
  return buildKernel(R, () => 1, eps);
}

/**
 * 环面上的稀疏核卷积（**带 halo 的快速路径**）。
 *
 * 朴素写法每个抽头都要做一次环面回绕：
 *
 * ```
 * let yy = y + dy[t]; if (yy < 0) yy += n; else if (yy >= n) yy -= n;
 * let xx = x + dx[t]; if (xx < 0) xx += n; else if (xx >= n) xx -= n;
 * acc += w[t] * src[yy * n + xx];
 * ```
 *
 * 那是每个抽头 4 个分支 + 2 次下标乘加。这里改成**先把场连同一圈 R 宽的
 * 环面 halo 复制进一块 `(w+2R) × (h+2R)` 的缓冲**，内层循环就只剩 `acc += w * pad[base + off]`
 * —— 一条乘加、零分支。halo 刷新是 O(n·R) 的拷贝，相对 O(n²·taps) 的卷积可以忽略。
 *
 * 实测（112²、R=10、317 抽头）：**7.82 → 3.80 ms/次，2.06×**，且
 * **逐位相同**（`maxDiff === 0`）—— 累加顺序没变，所以不是近似。
 *
 * 两条使用纪律：
 * - `conv` 是**复用**的输出缓冲：读走再下一次卷积就被覆盖了。
 * - 一个实例绑一个核；换 R 要新建（偏移表是按核预计算的）。
 */
export class TorusField {
  /** 带 halo 的场，宽 = w + 2R、高 = h + 2R。 */
  private readonly pad: Float32Array;
  /** 带 halo 的场的**行宽**（不是网格宽度 —— 别拿它当 `w` 用）。 */
  private readonly pw: number;
  private readonly off: Int32Array;
  private readonly wt: Float32Array;
  /** 网格列数。 */
  readonly w: number;
  /** 网格行数。 */
  readonly h: number;
  /** 上一次卷积的原始结果（w×h）。调用方直接读，省一次拷贝。 */
  readonly conv: Float32Array;

  /** 正方形（大部分调用点 / 单测）。 */
  constructor(w: number, kernel: SparseKernel);
  /** 矩形网格。 */
  constructor(w: number, h: number, kernel: SparseKernel);
  constructor(w: number, hOrKernel: number | SparseKernel, maybeKernel?: SparseKernel) {
    const h = typeof hOrKernel === 'number' ? hOrKernel : w;
    const kernel = typeof hOrKernel === 'number' ? maybeKernel! : hOrKernel;
    const taps = kernel.w.length;
    let R = 0;
    for (let t = 0; t < taps; t++) {
      const r = Math.max(Math.abs(kernel.dx[t]!), Math.abs(kernel.dy[t]!));
      if (r > R) R = r;
    }
    this.w = w;
    this.h = h;
    this.pw = w + 2 * R;
    this.pad = new Float32Array(this.pw * (h + 2 * R));
    this.off = new Int32Array(taps);
    for (let t = 0; t < taps; t++) this.off[t] = kernel.dy[t]! * this.pw + kernel.dx[t]!;
    this.wt = kernel.w.slice();
    this.conv = new Float32Array(w * h);
  }

  /** 卷积 `src`（w×h），结果在 `this.conv`。 */
  convolve(src: Float32Array): void {
    const { w, h, pw, pad, off, wt } = this;
    const R = (pw - w) >> 1;

    for (let y = 0; y < h; y++) {
      const row = y * w;
      const prow = (y + R) * pw + R;
      pad.set(src.subarray(row, row + w), prow);
      // 左右 halo
      for (let r = 0; r < R; r++) {
        pad[prow - 1 - r] = src[row + w - 1 - r]!;
        pad[prow + w + r] = src[row + r]!;
      }
    }
    // 上下 halo：**整行**复制（连左右 halo 一起，否则四个角是错的）
    for (let r = 0; r < R; r++) {
      const srcTop = (R + h - 1 - r) * pw;
      const dstTop = (R - 1 - r) * pw;
      const srcBot = (R + r) * pw;
      const dstBot = (R + h + r) * pw;
      for (let x = 0; x < pw; x++) {
        pad[dstTop + x] = pad[srcTop + x]!;
        pad[dstBot + x] = pad[srcBot + x]!;
      }
    }

    const taps = off.length;
    const out = this.conv;
    for (let y = 0; y < h; y++) {
      const base = (y + R) * pw + R;
      const orow = y * w;
      for (let x = 0; x < w; x++) {
        const b = base + x;
        let acc = 0;
        for (let t = 0; t < taps; t++) acc += wt[t]! * pad[b + off[t]!]!;
        out[orow + x] = acc;
      }
    }
  }
}

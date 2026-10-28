/**
 * sandpile.ts — 阿贝尔沙堆（Bak–Tang–Wiesenfeld），`sim` 型。
 *
 * 规则：每格堆着一摞沙粒。**≥ 4 粒就崩塌**：自己减 4，四个 von Neumann 邻居各加 1。
 * 反复崩塌到没有格子 ≥ 4 为止 —— 那个终止状态叫「稳定态」。
 *
 * 它值得做一个生成器的理由只有一条：**一遍遍往里加沙，稳定态会自己长成一个
 * 分形**。那个形状不是谁设计的，是「局部规则 + 大量重复」的产物，而且
 * 每一次加沙都精确地重画它一次。
 *
 * ## 两个实现决定
 *
 * 1. **用工作队列而不是整场扫描。** 整场扫描是 O(格数 × 崩塌轮数)，而队列是
 *    O(总崩塌次数) —— 后者可能小好几个数量级（大部分格子大部分时候是稳定的）。
 * 2. **每一步的随机位置由 `hashSeed(seed, step)` 现算，不用一条长随机流。**
 *    长流的内部游标是状态的一部分：seek 从中间某张快照重放时，游标位置也必须
 *    一起回退，否则重放出来的图和顺序播放不一样。每步现算 hash 就没有这个状态。
 *
 * ## 「阿贝尔」是什么意思
 *
 * 崩塌的**顺序不影响最终稳定态** —— 这是能单测的强不变量（打乱队列顺序、
 * 甚至用两种完全不同的顺序各跑一遍，终止状态逐格相同）。
 *
 * ⚠️ 它有个前提：**总沙量 ≤ 容量**（容量 = `3 × 格数`，稳定态每格最多 3 粒）。
 * 超过容量时环面上根本不存在稳定态，稳定化永不终止，只能靠 `maxTopple` 截断
 * —— 而截断点与处理顺序有关，性质随之失效。单测里那条「阿贝尔性」用例原先
 * 用 4000 粒跑 24² 网格（容量 1728），是靠运气过的。
 *
 * 这条性质也是「去重优化不改变任何一帧画面」的依据：去重只改**顺序**，
 * 不改每步之后的稳定态。而每步只把稳定化**之后**的状态送上纹理。
 *
 * ## ⚠️ 成本表（实测，这决定了默认参数）
 *
 * 中心落点模式下所有沙都倒进**同一个格子**，要把它推到边界只能靠一次次崩塌，
 * 所以总崩塌数 ≈ (总沙量)^1.5，**与网格大小无关**。于是「把网格铺得多满」
 * 这个看似审美的选择直接决定了能不能算得完：
 *
 * | 配置（24 秒轴） | 总沙量 | 沙/容量 | 整条轴 | 最坏未稳定格 |
 * |---|---|---|---|---|
 * | 256² 200/步@30 | 144,000 | 73% | 3.39 s | **418** ← 撞闸门 |
 * | 160² 60/步@60 | 172,800 | 75% | 1.28 s | **192** ← 撞闸门 |
 * | 256² 40/步@30 | 43,200 | 15% | 0.22 s | 0 |
 * | **160² 60/步@30（默认）** | 43,200 | 56% | **0.52 s** | 0 |
 * | 128² 50/步@30 | 36,000 | 73% | 0.42 s | 0 |
 *
 * 「未稳定格」= 一步结束之后还有 `h >= 4` 的格子，也就是**画面已经不在表达
 * 模型状态**了（`MAX_TOPPLE_PER_STEP` 把它截断了）。判据是**绝对沙量**：
 * 四万多粒随便跑，十四万粒必截断。默认值按「四万多粒 + 尽量铺得满」取。
 * 有单测钉着「出厂默认跑满 demo 长度不许出现未稳定格」。
 */

import { hashSeed, mulberry32 } from '../core/prng';
import { gridSizeOf } from './grid-dims';
import { SnapshotRing } from './sim-util';
import { bgColorVisible, bgModeParam } from './shader-lib';
import type { GeneratorDef, SimHandle } from './types';

/** 网格尺寸约束：与参数表里 `width` / `height` 的 min / max / default 同源。 */
const SAND_GRID = { min: 32, max: 512, fallback: 160 } as const;

/** 崩塌阈值。4 是二维 von Neumann 邻域下的经典取值。 */
export const TOPPLE_AT = 4;

const SNAPSHOT_OPTS = {
  every: 8,
  cap: 48,
  clone: (v: Uint32Array): Uint32Array => v.slice(),
};

/**
 * 每一步最多处理多少次崩塌。
 *
 * 这是一个**防卡死的闸门**，不是模型的一部分。为什么需要它：沙堆逼近饱和
 * （每格都接近 3）时，一粒沙可能引发极其庞大的雪崩 —— 实测把 5000 粒倒进
 * 32² 的格子里、再一次性稳定化，光是那一次雪崩就能跑几十秒。运行期每步都会
 * 稳定化，正常情况下远到不了这个量级，但没有闸门就意味着「用户把撒沙量拉满
 * + 网格调小」可以直接把主线程卡死。
 *
 * **闸门不影响确定性**：上限是步数的固定函数，同样的 t 永远得到同样的中间态。
 * 代价只是「雪崩特别大的那几步，堆暂时没完全稳定」—— 下一步会接着塌。
 */
export const MAX_TOPPLE_PER_STEP = 400_000;

/**
 * 把 `h` 稳定化（就地改）。`order` 只影响**中间过程**，不影响终止状态。
 *
 * `order === 'fifo'` 用队列（广度优先），`'lifo'` 用栈（深度优先）——
 * 单测拿这两种顺序对拍来验证阿贝尔性。
 *
 * 返回**实际处理了多少次崩塌**（探针与单测用）。
 */
export function stabilize(
  h: Uint32Array,
  w: number,
  height: number,
  seedQueue: number[] = [],
  order: 'fifo' | 'lifo' = 'lifo',
  maxTopple: number = MAX_TOPPLE_PER_STEP,
  scratch?: Uint8Array,
): number {
  const q = seedQueue;
  /*
   * 入队去重（`queued[i] === 1` 表示「已经在队列里等着」）。
   *
   * 这一条不是微优化，是沙堆的**主要**开销所在：一次崩塌会把四个邻居各推一次，
   * 而那些邻居多半早就排着队了。不去重的话队列吞吐是「崩塌数 × 4 + 陈旧条目」，
   * 实测占掉稳定态每一步 6 ms 里的大头；去重后每个格的每个「排队回合」只进一次。
   *
   * **不改变结果**：阿贝尔性质保证稳定态与处理顺序无关，而单步的中间过程
   * 从不上传到画面（只有稳定化之后的 `current()` 才走纹理）。唯一的例外是
   * `maxTopple` 真的截断时 —— 那种情况本来就与顺序有关，闸门的意义就是
   * 「宁可暂时不稳，也不卡死」。
   */
  const queued = scratch ?? new Uint8Array(w * height);
  queued.fill(0);
  if (q.length === 0) {
    for (let i = 0; i < w * height; i++) {
      if (h[i]! >= TOPPLE_AT) {
        queued[i] = 1;
        q.push(i);
      }
    }
  } else {
    // 种子（`stepOnce` 那边撒进来的）：**只打标记，不去重**。
    // 去重要就地重排 `q`，而 `q` 是调用方传进来的数组 —— 就地改它是个
    // 看不见的副作用（调用方可能还要用，单测就拿同一个起点集合跑两种顺序）。
    // 种子里重复的条目代价很小：弹出时一次 `h < 4` 的比较就过去了。
    for (let r = 0; r < q.length; r++) {
      const i = q[r]!;
      if (h[i]! >= TOPPLE_AT) queued[i] = 1;
    }
  }
  let head = 0;
  let done = 0;
  while (order === 'fifo' ? head < q.length : q.length > 0) {
    if (done >= maxTopple) break;
    const i = order === 'fifo' ? q[head++]! : q.pop()!;
    queued[i] = 0;
    if (h[i]! < TOPPLE_AT) continue;
    done++;
    h[i] = h[i]! - TOPPLE_AT;
    // **崩塌之后如果还 >= 4 就要重新入队。** 少了这一句、只靠「被邻居推高时才入队」，
    // 高塔会停在一半：沙堆的中心模式一次往同一格倒 200 粒，先前的写法靠
    // 「同一格重复入队 200 次」蒙对了，去重之后就直接暴露成「塌一次就停手」。
    if (h[i]! >= TOPPLE_AT && !queued[i]) {
      queued[i] = 1;
      q.push(i);
    }
    const x = i % w;
    const y = (i - x) / w;
    // von Neumann + 环面。
    //
    // **四个邻居写开、不写成 `for (const j of [a,b,c,d])`**：那个数组字面量是
    // **每次崩塌分配一个数组**，而稳定态下一步要塌十万次上下（见文件头的成本表）。
    // 实测 8.8 → 6.4 ms/步 —— 有收益但不是数量级，真正的开销在队列进出上（见
    // 上面「去重」那段注释）。
    const up = (y === 0 ? height - 1 : y - 1) * w + x;
    const dn = (y === height - 1 ? 0 : y + 1) * w + x;
    const row = y * w;
    const lf = row + (x === 0 ? w - 1 : x - 1);
    const rt = row + (x === w - 1 ? 0 : x + 1);
    let v = h[up]! + 1;
    h[up] = v;
    if (v >= TOPPLE_AT && !queued[up]!) { queued[up] = 1; q.push(up); }
    v = h[dn]! + 1;
    h[dn] = v;
    if (v >= TOPPLE_AT && !queued[dn]!) { queued[dn] = 1; q.push(dn); }
    v = h[lf]! + 1;
    h[lf] = v;
    if (v >= TOPPLE_AT && !queued[lf]!) { queued[lf] = 1; q.push(lf); }
    v = h[rt]! + 1;
    h[rt] = v;
    if (v >= TOPPLE_AT && !queued[rt]!) { queued[rt] = 1; q.push(rt); }
  }
  return done;
}

export function createSandpile(params: Record<string, number | string>, seed: number): SimHandle {
  const { w, h: height } = gridSizeOf(params, SAND_GRID);
  const total = w * height;
  const stepsPerSec = Math.max(1, Number(params.rate) || 30);
  const batchRaw = Math.max(1, Math.min(2000, Math.round(Number(params.batch) || 200)));
  // 撒沙量相对于网格要有上限：格子的容量是 3·格数，一次倒进去太多就永远稳不下来
  // （每步都塌不完，下一轮再往上加）。格数/32 是实测能撑住的比例。
  const batch = Math.max(1, Math.min(batchRaw, Math.floor(total / 32)));
  const center = params.dropMode !== 'random';

  const h = new Uint32Array(total);
  let frame = 0;
  const snapshots = new SnapshotRing<Uint32Array>(SNAPSHOT_OPTS, h);
  const out = new Uint8Array(total);
  const queue: number[] = [];
  /** `stabilize` 的去重标记（复用，避免每步分配 65KB 再填零）。 */
  const queued = new Uint8Array(total);

  /** 一步 = 撒 `batch` 粒沙 + 稳定化。 */
  const stepOnce = (): void => {
    const rnd = mulberry32(hashSeed(seed, 'sandpile', frame));
    const ci = (height >> 1) * w + (w >> 1);
    for (let g = 0; g < batch; g++) {
      const i = center ? ci : Math.floor(rnd() * total);
      h[i] = h[i]! + 1;
      if (h[i]! >= TOPPLE_AT) queue.push(i);
    }
    stabilize(h, w, height, queue, 'lifo', MAX_TOPPLE_PER_STEP, queued);
    queue.length = 0;
  };

  const stepTo = (target: number): void => {
    while (frame < target) {
      stepOnce();
      frame++;
      if (snapshots.shouldStore(frame)) snapshots.store(frame, h);
    }
  };

  return {
    gridW: w,
    gridH: height,
    stepsPerSec,
    seek(simFrame: number): void {
      const target = Math.max(0, Math.floor(simFrame));
      if (target < frame) {
        const snap = snapshots.nearestAtOrBefore(target);
        h.set(snap.value);
        frame = snap.frame;
      }
      stepTo(target);
    },
    current(): Uint8Array {
      // 稳定态的每格只有 0..3，直接量化就是一片纯黑 —— 必须拉开对比。
      // 用 sqrt 让低值也看得见：稳定态里 2 与 3 的差别才是分形的纹理所在。
      for (let i = 0; i < out.length; i++) {
        const v = h[i]!;
        out[i] = v === 0 ? 0 : Math.min(255, Math.round(Math.sqrt(v) * 96));
      }
      return out;
    },
  };
}

export const sandpileDef: GeneratorDef = {
  id: 'sandpile',
  nameKey: 'algo.sandpile',
  kind: 'sim',
  volatile: ['rate', 'colorBg', 'colorLive', 'palette', 'bgMode'],
  params: [
    // ⚠️ 默认网格是 160 而**不是** 256。理由不是审美，是**成本随倒在中间的沙量
    // 超线性增长**：所有沙都落在同一个格子，得靠崩塌把它推到边界，总崩塌数
    // ≈ (总沙量)^1.5，与网格大小无关。于是「把 256² 铺到七成满」需要 14.4 万粒，
    // 单步崩塌量能到 440 万次 —— 既慢（整条 24 秒轴 3.4 秒）又**会撞上
    // `MAX_TOPPLE_PER_STEP` 被静默截断**（实测 t=8s 起就有 h>=4 的格子残留，
    // 也就是画面已经不在表达模型的状态了）。实测见文件头。
    { key: 'width', labelKey: 'algo.simGrid.width', type: 'range', min: 32, max: 512, step: 32, defaultValue: 160 },
    { key: 'height', labelKey: 'algo.simGrid.height', type: 'range', min: 32, max: 512, step: 32, defaultValue: 160 },
    {
      key: 'batch',
      labelKey: 'algo.sandpile.batch',
      type: 'range',
      min: 1,
      max: 2000,
      step: 1,
      // 60/步 × 30 步/秒 = 1800 粒/秒 → 24 秒 4.3 万粒（网格容量的 56%）。
      // 这是实测出来的上限附近：43,200 粒能完整稳定化且整条轴只花 0.52 秒，
      // 而 7.2 万粒就已经开始偶发截断了。取 200 那种「看起来更壮观」的值，
      // 代价是模型静默失真 —— 见 size 的注释。
      defaultValue: 60,
    },
    {
      key: 'dropMode',
      labelKey: 'algo.sandpile.dropMode',
      type: 'select',
      defaultValue: 'center',
      options: [
        { labelKey: 'algo.sandpile.dropCenter', value: 'center' },
        { labelKey: 'algo.sandpile.dropRandom', value: 'random' },
      ],
    },
    { key: 'rate', labelKey: 'algo.sandpile.speed', type: 'range', min: 1, max: 120, step: 1, defaultValue: 30 },
    {
      key: 'colorBg',
      labelKey: 'algo.sandpile.colorBg',
      type: 'color',
      defaultValue: '#05060c',
      visibleWhen: bgColorVisible,
    },
    { key: 'colorLive', labelKey: 'algo.sandpile.colorLive', type: 'color', defaultValue: '#ffd489' },
    bgModeParam(),
  ],
  create: createSandpile,
};

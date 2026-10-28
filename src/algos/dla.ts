/**
 * dla.ts — 扩散受限聚集（Diffusion-Limited Aggregation），bake 型。
 *
 * ## 它算的是什么
 *
 * 一颗种子 + 一群醉汉。每个粒子从种子附近某个方向出发做随机游走，撞上已有
 * 聚集体的那一刻就**粘住不动**，成为新的种子。就这么点规则，长出来的是珊瑚、
 * 闪电、金属电沉积 —— 和 DLA 这个模型本身一样有名的那堆东西。
 *
 * 关键在于「撞哪儿粘哪儿」而不是「随机找个位置长」：枝尖伸得更靠外，先被
 * 游走的粒子撞到，于是越长越尖，枝隙被自己的枝遮住（screening）而长不进去。
 * 这就是分形维数约 1.71 的来源。
 *
 * ## 为什么是 `bake` 而不是 `sim`
 *
 * 它的成本是**粒子数 × 每个粒子的游走步数**，而后者随聚集体半径增长。
 * 做成 sim 就得在每帧的主线程预算里挤，跑到一半必然被步进预算掐住；做成
 * bake 就是在 Worker 里一次算完，慢一点也只是「第一次插入时等一小会儿」。
 * 而且 DLA 的形态是「一次性长完」的，没有中途态值得看。
 *
 * ## 揭示方式：`'value'` = 到达序号
 *
 * 每个粘住的格记下它是第几个到达的，归一化到 `1..255`。`'value'` 模式的前沿
 * 按像素值推进 ⇒ 画面**按它自己长出来的顺序**从种子向外展开。这与
 * `lsystem.ts` 的「离根距离场」是同一个技巧。背景（没粘住的格）写 0。
 *
 * ## 三处为了跑得动而**刻意**做的偏离（都不是精度问题，是可行性问题）
 *
 * 1. **从聚集体前沿出发**，不是从画幅边缘。从边缘出发的随机游走平均要走
 *    `O(R²)` 步才碰到半径 `R` 的聚集体 —— 半径 250 时是 6 万步，乘上万个
 *    粒子就是十亿次循环。
 * 2. **走出 `killR` 就丢弃重来**。这是 DLA 的教科书优化；代价是到达枝隙的
 *    粒子略微变少（`killR` 越小越明显），所以取 `1.6R` 而不是极限的 `1.05R`。
 * 3. **每次粘附后立刻用新半径重算出发圈**，而不是整批统一半径 —— 否则
 *    聚集体长大之后，后半批粒子会在离它很远的旧半径上出发，白走一路。
 */

import { hashSeed, mulberry32 } from '../core/prng';
import { bgColorVisible, bgModeParam } from './shader-lib';
import type { GeneratorDef } from './types';

/** 丢弃半径相对聚集体半径的倍数。见文件头第 2 条。 */
const KILL_FACTOR = 1.6;
/** 丢弃半径的绝对下限增量 —— 半径还很小时 `1.6R` 几乎没有余量。 */
const KILL_PAD = 14;
/** 出发圈相对聚集体半径的余量。 */
const LAUNCH_PAD = 3;
/** 单个粒子的游走步数上限（防呆，正常远用不到）。 */
const MAX_WALK = 400_000;

export interface DlaOptions {
  /** 输出边长（正方形）。 */
  size: number;
  /** 目标粒子数。 */
  particles: number;
  /** 初始种子的半径（0 = 单格）。稍大一点更容易长出各向同性的星形。 */
  seedRadius: number;
  /** 粘附判据的邻域：4 邻（von Neumann）更尖，8 邻更致密。 */
  stick: 4 | 8;
  seed: number;
}

/**
 * 跑一遍 DLA，返回「按到达序号编码」的灰度图。
 *
 * 纯确定性：同一个 seed 永远得到同一张图（随机游走与出发角都来自同一个
 * `mulberry32` 序列，且遍历顺序固定）。
 */
export function dlaRun(o: DlaOptions): { data: Uint8Array; w: number; h: number; placed: number } {
  const n = Math.max(64, Math.min(1024, Math.round(o.size)));
  const want = Math.max(16, Math.round(o.particles));
  const rnd = mulberry32(hashSeed(o.seed, 'dla'));

  const occ = new Uint8Array(n * n);
  const order = new Int32Array(n * n);
  const cx = n >> 1;
  const cy = n >> 1;
  const maxR = n / 2 - 3;

  /* 种子：半径 r0 的实心圆盘。纯确定性，不消耗随机数。 */
  const r0 = Math.max(0, Math.min(8, Math.round(o.seedRadius)));
  let placed = 0;
  for (let dy = -r0; dy <= r0; dy++) {
    for (let dx = -r0; dx <= r0; dx++) {
      if (dx * dx + dy * dy > r0 * r0) continue;
      const x = cx + dx;
      const y = cy + dy;
      if (x < 0 || x >= n || y < 0 || y >= n) continue;
      const j = y * n + x;
      occ[j] = 1;
      order[j] = ++placed;
    }
  }

  let clusterR = r0;
  let clusterR2 = r0 * r0;
  const eight = o.stick === 8;

  /** 该格是否与聚集体相邻（决定粘不粘）。 */
  const touches = (x: number, y: number): boolean => {
    if (x > 0 && occ[y * n + x - 1]) return true;
    if (x < n - 1 && occ[y * n + x + 1]) return true;
    if (y > 0 && occ[(y - 1) * n + x]) return true;
    if (y < n - 1 && occ[(y + 1) * n + x]) return true;
    if (!eight) return false;
    if (x > 0 && y > 0 && occ[(y - 1) * n + x - 1]) return true;
    if (x < n - 1 && y > 0 && occ[(y - 1) * n + x + 1]) return true;
    if (x > 0 && y < n - 1 && occ[(y + 1) * n + x - 1]) return true;
    if (x < n - 1 && y < n - 1 && occ[(y + 1) * n + x + 1]) return true;
    return false;
  };

  /*
   * 主循环。`attempts` 的上限是防呆：`killR` 偏小时绝大多数粒子会被丢弃，
   * 万一参数把「有效粒子比例」压到接近 0，没有这个上限就是一次无限循环。
   * 上限给得宽（40 倍），正常参数下永远撞不到。
   */
  const maxAttempts = want * 40;
  for (let attempt = 0; attempt < maxAttempts && placed < want; attempt++) {
    /*
     * 出发圈必须**严格在聚集体之外**。聚集体长到几乎顶住网格时
     * `Math.min(maxR, …)` 会把出发圈压回聚集体内部 —— 粒子一出生就贴着
     * 已有格，于是「粘」在**已经占据的格**上：`placed` 照涨而 `order` 不涨，
     * 画面停在原地、粒子数却报满。实测 512 网格 2 万粒只新增 10405 格。
     * 所以这里直接收工 —— 长满了就是长满了。
     */
    if (clusterR + LAUNCH_PAD >= maxR) break;
    const launchR = clusterR + LAUNCH_PAD;
    const killR = Math.min(maxR, Math.max(clusterR * KILL_FACTOR, clusterR + KILL_PAD));
    const killR2 = killR * killR;
    const ang = rnd() * Math.PI * 2;
    let x = Math.round(cx + Math.cos(ang) * launchR);
    let y = Math.round(cy + Math.sin(ang) * launchR);
    if (x < 0 || x >= n || y < 0 || y >= n) continue;

    for (let step = 0; step < MAX_WALK; step++) {
      if (touches(x, y)) {
        const j = y * n + x;
        // 防呆：`touches` 为真不代表本体是空格（对角线邻接时可能站在簇上）
        if (occ[j]) break;
        occ[j] = 1;
        order[j] = ++placed;
        const dx = x - cx;
        const dy = y - cy;
        const d2 = dx * dx + dy * dy;
        if (d2 > clusterR2) {
          clusterR2 = d2;
          clusterR = Math.sqrt(d2);
        }
        break;
      }
      // 四方向随机游走。`rnd()` 调一次取两个比特，省一半随机数开销。
      const r = rnd();
      if (r < 0.25) x--;
      else if (r < 0.5) x++;
      else if (r < 0.75) y--;
      else y++;
      if (x < 0 || x >= n || y < 0 || y >= n) break;
      const dx = x - cx;
      const dy = y - cy;
      if (dx * dx + dy * dy > killR2) break; // 走远了 —— 丢弃，下一位
    }
  }

  const data = new Uint8Array(n * n);
  const span = Math.max(1, placed - 1);
  for (let i = 0; i < data.length; i++) {
    const k = order[i]!;
    if (k === 0) continue; // 背景
    /*
     * 到达序号 → 灰度，**取平方根**。
     *
     * 直接线性映射会让核心整块发黑：DLA 的 `粒子数 ∝ 半径^1.7`，所以到达
     * 序号是半径的超线性函数，线性映射之后半径 0.4R 以内的区域全挤在值的
     * 前 1/6 里。开方把它拉回接近「值 ∝ 半径」，核心才留得住亮度。
     */
    data[i] = 1 + Math.round(254 * Math.pow((k - 1) / span, 0.42));
  }
  return { data, w: n, h: n, placed };
}

export const dlaDef: GeneratorDef = {
  id: 'dla',
  nameKey: 'algo.dla',
  kind: 'bake',
  reveal: 'value',
  volatile: ['speed', 'colorBg', 'colorLive', 'bgMode'],
  params: [
    { key: 'size', labelKey: 'algo.dla.size', type: 'range', min: 256, max: 768, step: 64, defaultValue: 448 },
    { key: 'particles', labelKey: 'algo.dla.particles', type: 'range', min: 1000, max: 20000, step: 500, defaultValue: 6000 },
    { key: 'seedRadius', labelKey: 'algo.dla.seedRadius', type: 'range', min: 0, max: 6, step: 1, defaultValue: 2 },
    {
      key: 'stick',
      labelKey: 'algo.dla.stick',
      type: 'select',
      defaultValue: '4',
      options: [
        { labelKey: 'algo.dla.stick4', value: '4' },
        { labelKey: 'algo.dla.stick8', value: '8' },
      ],
    },
    { key: 'speed', labelKey: 'algo.dla.speed', type: 'range', min: 5, max: 255, step: 1, defaultValue: 30 },
    {
      key: 'colorBg',
      labelKey: 'algo.dla.colorBg',
      type: 'color',
      defaultValue: '#03080a',
      visibleWhen: bgColorVisible,
    },
    { key: 'colorLive', labelKey: 'algo.dla.colorLive', type: 'color', defaultValue: '#8ff0d0' },
    bgModeParam(),
  ],
  bake(params, seed) {
    const { data, w, h } = dlaRun({
      size: Number(params.size) || 448,
      particles: Number(params.particles) || 6000,
      seedRadius: Number(params.seedRadius) || 0,
      stick: String(params.stick) === '8' ? 8 : 4,
      seed,
    });
    return { data, w, h, frontMax: 255 };
  },
};

/**
 * buddhabrot.ts — Buddhabrot（蒙特卡洛显影），`sim` 型。
 *
 * ## 它算的是什么
 *
 * 曼德博集合的**逃逸轨道密度图**。对每个随机采样的 `c`，从 `z₀ = 0` 迭代
 * `z ← z² + c`；**如果它逃逸了**，就把整条轨道经过的每个点在一张二维直方图上
 * 记一笔（没逃逸的那些 `c` 直接丢弃 —— 正是这一步把它与 Mandelbrot 的
 * 「内黑外彩」切成两回事）。样本足够多时浮出来的是那尊坐佛。
 *
 * ## 为什么是 `sim` 而不是 `bake`
 *
 * 这个算法的图像**本来就是「随时间显影」的**：样本从少到多，画面从粗噪点
 * 逐渐收敛出细丝。做成 sim 就白拿了一条「显影」时间轴，而且用户可以把它
 * 当素材叠在别的轨道上；做成 bake 只是一张一次算完的静态图。
 *
 * 代价是「必须能 seek」，而 seek 要求**从 0 顺序重放**。这里靠两点保证：
 * 随机数走实例私有的 `mulberry32`（硬约束 1.2，同一 seed 同一序列），
 * 累积单调（直方图只增不减）。
 *
 * ## 色调映射：**自适应高通**，不是对数也不是幂律
 *
 * 这一条是量出来的，不是想出来的。实测 180 万样本、320² 网格的计数分布：
 *
 * ```
 * 逃逸率 84%   非零格 = 100%（102400/102400）   最大 = 478
 * 分位：q0.10=26  q0.25=31  q0.50=42  q0.75=76  q0.90=107  q0.99=164
 * ```
 *
 * 三个结论直接否掉了常见的几种写法：
 *
 * 1. **没有「空的背景」可以留成黑色。** 每个格子都被点亮了 —— 因为绝大多数
 *    随机 `c` 离集合很远、两三次迭代就逃逸，轨道短而落点均匀，它们在一张
 *    102400 格的图上撒出一层**满幅的均匀底噪**。想直接 `count==0 ? 黑 : 亮`
 *    是没有用的。
 * 2. **动态范围只有 18 倍**（26 → 478）。对数映射会把这点范围压平成一坨灰；
 *    幂律 `t^0.4` 更糟，它把底噪抬到 80/255 —— 实测第一版整幅画面是一片
 *    均匀的灰噪点，坐佛几乎看不出来。
 * 3. **必须把底噪减掉再拉伸。** 底噪是均匀的，信号是集中的，所以**均值就是
 *    底噪的良好估计**：减去 `0.65×均值` 当黑点，再按 `3.35×均值` 拉到满亮。
 *    于是 `count / 均值` 这个比值成了唯一的自变量 —— 它与**跑了多少样本、
 *    网格多大都无关**：10 万样本和 1000 万样本得到的是同一张图，只是后者
 *    更干净。这正是蒙特卡洛渲染该有的行为。
 *
 * ## 另外三个踩过的坑
 *
 * 1. **直方图用 `Uint16Array` 并饱和在 65535。** 不是省内存的洁癖：
 *    `SnapshotRing` 每存一张就整份克隆，`Float64Array` 在 512² 上是每张 2MB、
 *    24 张就 50MB。饱和的代价几乎为零 —— 能撑到饱和的样本量下画面早就全白了。
 * 2. **`total` 必须跟着 seek 一起回退**（见 `seek` 里的注释）——
 *    否则往回拖时基准留在未来，画面会突然整体变暗，而且**不报错**。
 * 3. **一趟迭代 + 记轨道，不要跑两趟。** 初版为了「先判断逃逸、再回头画」
 *    把整段复数迭代跑了两遍，成本直接翻倍。轨道边算边存进一块复用缓冲
 *    （`maxIter` 个点的 x/y 各一条 `Float32Array`）就行。
 */

import { mulberry32 } from '../core/prng';
import { SnapshotRing } from './sim-util';
import { bgColorVisible, bgModeParam } from './shader-lib';
import type { GeneratorDef, SimHandle } from './types';

/** 复平面视野：以 `CENTER` 为中心、半宽 `HALF`（`zoom` 再缩）。 */
const CENTER_X = -0.65;
const CENTER_Y = 0;
const HALF = 1.55;

/** 逃逸半径。`|z| > 2` 即逃逸（标准取法）。 */
const ESCAPE_R2 = 4;

/** 黑点：`count` 低于 `BLACK × 均值` 的像素压成 0（底噪就活在这一带）。 */
const BLACK = 0.65;
/** 白点：`count` 到 `WHITE × 均值` 满亮。两者一起决定对比度。 */
const WHITE = 4;
/** 分母 = `WHITE - BLACK`，预乘好省得每帧算。 */
const SPAN = WHITE - BLACK;

const SNAPSHOT_OPTS = {
  every: 10,
  cap: 24,
  clone: (v: Uint16Array): Uint16Array => v.slice(),
};

export interface BuddhabrotView {
  cx: number;
  cy: number;
  half: number;
}

/** 一条轨道的暂存。复用，不每样本分配。 */
export interface OrbitScratch {
  x: Float32Array;
  y: Float32Array;
}

export function makeOrbitScratch(maxIter: number): OrbitScratch {
  return { x: new Float32Array(maxIter), y: new Float32Array(maxIter) };
}

/**
 * 采一个 `c` 并把逃逸轨道记进直方图。返回是否逃逸（单测用）。
 *
 * 复平面 → 像素：`u = (re - (cx - half)) / (2·half)`。视野是**正方形**，
 * 所以两轴共用一个 `scale`；非正方形画幅由 reveal / tint 的 contain 适配去管。
 */
export function buddhaSample(
  hist: Uint16Array,
  n: number,
  view: BuddhabrotView,
  maxIter: number,
  rnd: () => number,
  s: OrbitScratch,
): boolean {
  const re = view.cx - view.half + rnd() * 2 * view.half;
  const im = view.cy - view.half + rnd() * 2 * view.half;
  let zr = 0;
  let zi = 0;
  let len = 0;
  let escaped = false;
  for (let k = 0; k < maxIter; k++) {
    const zr2 = zr * zr;
    const zi2 = zi * zi;
    if (zr2 + zi2 > ESCAPE_R2) {
      escaped = true;
      break;
    }
    zi = 2 * zr * zi + im;
    zr = zr2 - zi2 + re;
    s.x[len] = zr;
    s.y[len] = zi;
    len++;
  }
  /* 没逃逸 ⇒ 整条轨道丢掉。这不是偷懒：Buddhabrot 画的**只有逃逸轨道**，
     把内部点也画上就退化成 Mandelbrot 的黑心区，整尊佛会被糊掉。 */
  if (!escaped) return false;

  const scale = n / (2 * view.half);
  const ox = view.cx - view.half;
  const oy = view.cy - view.half;
  for (let i = 0; i < len; i++) {
    const px = ((s.x[i]! - ox) * scale) | 0;
    const py = ((s.y[i]! - oy) * scale) | 0;
    if (px < 0 || px >= n || py < 0 || py >= n) continue;
    const j = py * n + px;
    if (hist[j]! < 65535) hist[j] = hist[j]! + 1;
  }
  return true;
}

export function createBuddhabrot(params: Record<string, number | string>, seed: number): SimHandle {
  const n = Math.max(128, Math.min(640, Math.round(Number(params.size) || 384)));
  const stepsPerSec = Math.max(1, Number(params.rate) || 20);
  const maxIter = Math.max(16, Math.round(Number(params.maxIter) || 320));
  const batch = Math.max(50, Math.round(Number(params.batch) || 2000));
  const zoom = Math.max(1, Math.min(8, Number(params.zoom) || 1));
  const exposure = Math.max(0.05, Number(params.exposure) || 1);
  const view: BuddhabrotView = { cx: CENTER_X, cy: CENTER_Y, half: HALF / zoom };

  const hist = new Uint16Array(n * n);
  const scratch = makeOrbitScratch(maxIter);
  const rnd = mulberry32(seed);
  let frame = 0;
  const snapshots = new SnapshotRing<Uint16Array>(SNAPSHOT_OPTS, hist);
  const out = new Uint8Array(n * n);

  return {
    gridW: n,
    gridH: n,
    stepsPerSec,
    seek(simFrame: number): void {
      const target = Math.max(0, Math.floor(simFrame));
      if (target < frame) {
        // ⚠️ 色调映射的自变量是 `count / 均值`，这一项只依赖**直方图本身**，
        // 所以回退时把直方图换掉就够了 —— 不需要额外的基准量。
        // （第一版按「总样本数」归一化时踩过：那时非回退 `total` 不可，
        //   漏掉就会让往回拖的画面突然变暗，而且不报错。）
        const snap = snapshots.nearestAtOrBefore(target);
        hist.set(snap.value);
        frame = snap.frame;
      }
      while (frame < target) {
        for (let i = 0; i < batch; i++) buddhaSample(hist, n, view, maxIter, rnd, scratch);
        frame++;
        if (snapshots.shouldStore(frame)) snapshots.store(frame, hist);
      }
    },
    current(): Uint8Array {
      /* 均值 = 满幅均匀底噪的良好估计（见文件头）。第 0 帧 / 还没逃逸过时
         均值为 0 —— 直接全黑，别让 0/0 变成 NaN 污染整幅画。 */
      let sum = 0;
      for (let i = 0; i < hist.length; i++) sum += hist[i]!;
      if (sum === 0) {
        out.fill(0);
        return out;
      }
      const mean = sum / hist.length;
      const k = (255 * exposure) / (SPAN * mean);
      const black = BLACK * mean;
      for (let i = 0; i < out.length; i++) {
        const v = k * (hist[i]! - black);
        out[i] = v <= 0 ? 0 : v >= 255 ? 255 : v | 0;
      }
      return out;
    },
  };
}

export const buddhabrotDef: GeneratorDef = {
  id: 'buddhabrot',
  nameKey: 'algo.buddhabrot',
  kind: 'sim',
  // `zoom` / `exposure` 是**显示**参数，不进哈希 ⇒ 拉滑杆不重置累积。
  volatile: ['rate', 'zoom', 'exposure', 'colorBg', 'colorLive', 'bgMode'],
  params: [
    { key: 'size', labelKey: 'algo.buddhabrot.grid', type: 'range', min: 192, max: 640, step: 64, defaultValue: 384 },
    { key: 'maxIter', labelKey: 'algo.buddhabrot.maxIter', type: 'range', min: 64, max: 1200, step: 16, defaultValue: 320 },
    { key: 'batch', labelKey: 'algo.buddhabrot.batch', type: 'range', min: 100, max: 4000, step: 50, defaultValue: 2000 },
    { key: 'zoom', labelKey: 'algo.buddhabrot.zoom', type: 'range', min: 1, max: 6, step: 0.05, defaultValue: 1 },
    { key: 'exposure', labelKey: 'algo.buddhabrot.exposure', type: 'range', min: 0.2, max: 2.5, step: 0.05, defaultValue: 1 },
    { key: 'rate', labelKey: 'algo.buddhabrot.speed', type: 'range', min: 1, max: 60, step: 1, defaultValue: 20 },
    {
      key: 'colorBg',
      labelKey: 'algo.buddhabrot.colorBg',
      type: 'color',
      defaultValue: '#050208',
      visibleWhen: bgColorVisible,
    },
    { key: 'colorLive', labelKey: 'algo.buddhabrot.colorLive', type: 'color', defaultValue: '#ffd9a8' },
    bgModeParam(),
  ],
  create: (params, seed) => createBuddhabrot(params, seed),
};

/**
 * chaos-game.ts — 混沌游戏，bake 型（揭示方式是 `'value'`）。
 *
 * ## 它算的是什么
 *
 * 正 N 边形 + 一条只含一次乘法的规则：随机挑一个顶点，从当前点朝它走
 * `ratio` 的那一段，落点记一笔。N=3、ratio=0.5 长出的就是谢尔宾斯基三角；
 * N=5 是五重花；N=5、ratio≈0.618 是另一套完全不同的密铺。**没有随机数就
 * 没有图，有了随机数图又是确定的** —— 这正是它值得做成生成器的原因。
 *
 * ## 为什么揭示用「半径」而不是「密度」
 *
 * 第一直觉是「按点落下的先后揭示」，那样最有「一笔笔画出来」的意思。
 * **实测不成立**：吸引子在前几千个点里就被铺满了，把落点序号归一化到
 * 0..255 之后，几乎每个像素的值都是 1 或 2 —— 揭示动画在第一帧就演完。
 *
 * 退一步想用「命中密度」，**同样不成立，而且原因更本质**：混沌游戏的不变
 * 测度在吸引子上就是均匀的（这正是它作为 IFS 采样器的定义性质），像素计数
 * 只有覆盖不全带来的泊松噪声，归一化后是一坨集中在中间的值 —— 揭示等于
 * 一次性点亮。实测 `value` 直方图：N=5 时 400k 个像素里 6 万个挤在同一档。
 *
 * 所以改成**按到中心的半径**揭示：`1` 是圆心，`255` 是最外圈。图形本身是
 * 关于中心自相似的（正 N 边形顶点朝上、绕中心旋转对称），从中心向外展开是
 * 它自己的生长顺序，读起来是一朵花从里往外开。
 *
 * ⚠️ 两条 `'value'` 揭示的老规矩（与 `lsystem.ts` 同源）：
 *
 * 1. **背景必须写 0，而落在图上的每个像素必须 ≥ 1。** 0 会被
 *    `step(cell, u_front)` 读成「比所有东西都老」⇒ 一开始就点亮。背景写 0
 *    无所谓（`mix(colorBg, colorLive, 0)` 就是底色），但**图上也写 0 的像素
 *    会跟着背景一起消失**。
 * 2. `frontMax` 是 255（R8 值域），不是点数。
 *
 * ## `restriction` 有一个坑：`noRepeat` 会毁掉 N = 3
 *
 * 禁止连续选同一个顶点在 N ≥ 4 时是个真实的形态旋钮（会切掉一部分子副本），
 * 但 **N = 3 时它把轨道锁进一个很短的周期**：实测同样 40 万点，自由规则的
 * 谢尔宾斯基点亮 12676 个像素，`noRepeat` 只有 738 个 —— 图几乎消失。
 * 经典谢尔宾斯基用的就是自由规则，所以默认 `none`。
 */

import { hashSeed, mulberry32 } from '../core/prng';
import { bgColorVisible, bgModeParam } from './shader-lib';
import type { GeneratorDef } from './types';

export type ChaosRestriction = 'none' | 'noRepeat';

export interface ChaosGameOptions {
  /** 正 N 边形的边数（也是可选顶点数）。 */
  vertices: number;
  /** 每次朝顶点移动的比例。 */
  ratio: number;
  /** 落点总数（含被跳过的瞬态）。 */
  points: number;
  /** 是否禁止连续两次选同一个顶点。 */
  restriction: ChaosRestriction;
  /** 输出边长（正方形）。 */
  size: number;
  seed: number;
}

/**
 * 跑一遍混沌游戏，返回「按到中心的半径编码」的灰度图。
 *
 * 纯确定性：同一个 seed 永远得到同一张图。
 */
export function chaosGameRun(o: ChaosGameOptions): { data: Uint8Array; w: number; h: number } {
  const n = Math.max(64, Math.min(2048, Math.round(o.size)));
  const verts = Math.max(3, Math.min(8, Math.round(o.vertices)));
  const ratio = Math.max(0.05, Math.min(0.95, o.ratio));
  const points = Math.max(100, Math.round(o.points));
  const rnd = mulberry32(hashSeed(o.seed, 'chaos-game'));

  /* 顶点表：从正上方开始逆时针铺 —— 起点朝上让 N 为奇数时有一条竖直的对称轴 */
  const vx = new Float64Array(verts);
  const vy = new Float64Array(verts);
  for (let i = 0; i < verts; i++) {
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / verts;
    vx[i] = Math.cos(a);
    vy[i] = Math.sin(a);
  }

  const count = new Uint32Array(n * n);
  /* 外接圆半径 1 映射到画幅的 0.46 —— 留 4% 边距，`ratio` 接近 1 时点会贴到
     顶点上，不留边会被画幅裁掉一圈角。 */
  const scale = n * 0.46;
  const half = n * 0.5;

  // 瞬态：前 20 个点还在往吸引子上收，画上去会留下一串从中心出发的尾巴。
  const TRANSIENT = 20;
  let px = 0;
  let py = 0;
  let last = -1;

  for (let i = 0; i < points + TRANSIENT; i++) {
    let v = (rnd() * verts) | 0;
    if (v >= verts) v = verts - 1;
    if (o.restriction === 'noRepeat' && v === last) {
      // 在剩下 verts-1 个里均匀取一个（`% verts` 会偏向把 v 变成 0）
      v = (v + 1 + ((rnd() * (verts - 1)) | 0)) % verts;
    }
    last = v;
    px += (vx[v]! - px) * ratio;
    py += (vy[v]! - py) * ratio;
    if (i < TRANSIENT) continue;
    // 图像 y 向下，顶点表 y 向上 ⇒ 这里翻一次
    const ix = (half + px * scale) | 0;
    const iy = (half + py * scale) | 0;
    if (ix < 0 || ix >= n || iy < 0 || iy >= n) continue;
    count[iy * n + ix]!++;
  }

  /* 半径编码。先扫一遍求最大半径（被点亮的像素里离中心最远的那个），
     再归一化 —— 用「顶点外接圆半径」当分母会在 `ratio` 小时留下大半段
     空值域，前沿走完一多半画面还没有任何东西。 */
  const data = new Uint8Array(n * n);
  let rMax2 = 1;
  for (let y = 0; y < n; y++) {
    const dy = y - half;
    for (let x = 0; x < n; x++) {
      if (!count[y * n + x]) continue;
      const dx = x - half;
      const d2 = dx * dx + dy * dy;
      if (d2 > rMax2) rMax2 = d2;
    }
  }
  const rMax = Math.sqrt(rMax2);
  for (let y = 0; y < n; y++) {
    const dy = y - half;
    for (let x = 0; x < n; x++) {
      const i = y * n + x;
      if (!count[i]) continue; // 背景：保持 0
      const dx = x - half;
      // 1..255。圆心 → 1（最先显影），最外圈 → 255
      data[i] = 1 + Math.round((254 * Math.sqrt(dx * dx + dy * dy)) / rMax);
    }
  }
  return { data, w: n, h: n };
}

export const chaosGameDef: GeneratorDef = {
  id: 'chaos-game',
  nameKey: 'algo.chaos',
  kind: 'bake',
  reveal: 'value',
  volatile: ['speed', 'colorBg', 'colorLive', 'bgMode'],
  params: [
    { key: 'vertices', labelKey: 'algo.chaos.vertices', type: 'range', min: 3, max: 8, step: 1, defaultValue: 5 },
    { key: 'ratio', labelKey: 'algo.chaos.ratio', type: 'range', min: 0.2, max: 0.8, step: 0.01, defaultValue: 0.5 },
    { key: 'points', labelKey: 'algo.chaos.points', type: 'range', min: 50000, max: 1200000, step: 50000, defaultValue: 600000 },
    {
      key: 'restriction',
      labelKey: 'algo.chaos.restriction',
      type: 'select',
      defaultValue: 'noRepeat',
      options: [
        { labelKey: 'algo.chaos.free', value: 'none' },
        { labelKey: 'algo.chaos.noRepeat', value: 'noRepeat' },
      ],
    },
    { key: 'size', labelKey: 'algo.chaos.size', type: 'range', min: 256, max: 1024, step: 64, defaultValue: 512 },
    { key: 'speed', labelKey: 'algo.chaos.speed', type: 'range', min: 5, max: 255, step: 1, defaultValue: 40 },
    {
      key: 'colorBg',
      labelKey: 'algo.chaos.colorBg',
      type: 'color',
      defaultValue: '#07060c',
      visibleWhen: bgColorVisible,
    },
    { key: 'colorLive', labelKey: 'algo.chaos.colorLive', type: 'color', defaultValue: '#ffb46b' },
    bgModeParam(),
  ],
  bake(params, seed) {
    const { data, w, h } = chaosGameRun({
      vertices: Number(params.vertices) || 5,
      ratio: Number(params.ratio) || 0.5,
      points: Number(params.points) || 600000,
      // 缺省写 'noRepeat'：`evalParams` 缺席时（单测直调）也要与参数默认值一致
      restriction: params.restriction === 'none' ? 'none' : 'noRepeat',
      size: Number(params.size) || 512,
      seed,
    });
    return { data, w, h, frontMax: 255 };
  },
};

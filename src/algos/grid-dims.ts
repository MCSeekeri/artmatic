/**
 * grid-dims.ts — 网格类模拟的尺寸口径（列 × 行）。
 *
 * ## 为什么要有这一层
 *
 * 网格模拟曾经只有一个 `size` 参数 = 「n × n」，于是 16:9 的工程里一张方形
 * 模拟图被 contain 适配成中间一块，两侧全是底色。**协议本来就不是方的**：
 * `SimHandle` 从一开始就有 `gridW` / `gridH` 两栏，`runtime` 按两栏建纹理并
 * 把 `gridW / gridH` 传给 tint 的 `u_srcAspect`，`stampCentered` 也早就收
 * 宽高两个数。方的只是每个生成器内部那段循环。
 *
 * 所以这里的约定是：**凡是以「格」为单位的模拟，参数一律是 `width` / `height`**。
 * 单位是格（不是像素），两轴的格是正方形 —— 画面上的格子之所以会变成长方形，
 * 只可能来自 contain 适配（输出画幅与网格比例不一致）。
 *
 * ## 老工程与 `size`
 *
 * v15 及更早的工程里这个参数叫 `size`（正方形）。`core/schema.ts` 的 v15 → v16
 * 迁移会把它拆成 `width` / `height` 两栏，所以正常路径不会走到下面的 `size` 兜底。
 * 兜底留给两类输入：手改过的工程文件、以及单测 / 插件里直接 `{ size: 48 }`
 * 这种老式调用 —— 它们必须仍然得到**正方形**，而不是退回默认值。
 *
 * ⚠️ 雪花（六角格）与佛像（复平面采样）**刻意保持 `size`**：方形是模型的一部分，
 * 不是没做。见各自的文件头。
 */

import type { ParamDef } from '../effects/types';

/** 生成器侧的尺寸约束（与对应 `range` 参数的 min / max / default 保持一致）。 */
export interface GridLimits {
  min: number;
  max: number;
  /** 两个轴都没给值时用它（= 出厂默认的边长）。 */
  fallback: number;
}

export interface GridSize {
  /** 列数（横向格数）。 */
  w: number;
  /** 行数（纵向格数）。 */
  h: number;
}

/** 把任意输入钳成 `[min, max]` 的整数；非有限值退回 `fallback`。 */
export function clampGridDim(value: unknown, lim: GridLimits): number {
  const v = Number(value);
  if (!Number.isFinite(v)) return Math.round(lim.fallback);
  return Math.max(Math.round(lim.min), Math.min(Math.round(lim.max), Math.round(v)));
}

/**
 * 从参数表读网格尺寸。
 *
 * 优先级：`width` / `height` → 单轴缺失时退回 `size` → 都没有时用 `fallback`。
 * 单轴缺失退回 `size`（而不是另一个轴）是刻意的：老工程只有 `size` 时，
 * 两个轴都该得到那个值。
 */
export function gridSizeOf(
  params: Record<string, number | string>,
  lim: GridLimits,
): GridSize {
  const w = clampGridDim(params.width ?? params.size, lim);
  const h = clampGridDim(params.height ?? params.size, lim);
  return { w, h };
}

/**
 * 由参数定义表反推网格尺寸（UI 的图案导入、Agent 的图案工具用）。
 *
 * 判据是**参数表里真的有 `width` 这个 range**，不是生成器白名单：
 * 白名单会漏，而漏掉的表现是「导入的图案按 32×32 采样、盖到 256×144 上只占
 * 中间一小块」，不报错。没有 `width` 参数的生成器返回 `null`（= 不适用）。
 */
export function gridSizeFromDefs(
  params: Record<string, number | string>,
  defs: readonly ParamDef[],
): GridSize | null {
  const wDef = defs.find((d) => d.key === 'width');
  if (!wDef || wDef.type !== 'range') return null;
  const hDef = defs.find((d) => d.key === 'height');
  const lim: GridLimits = { min: wDef.min, max: wDef.max, fallback: wDef.defaultValue };
  const hLim: GridLimits =
    hDef && hDef.type === 'range'
      ? { min: hDef.min, max: hDef.max, fallback: hDef.defaultValue }
      : lim;
  const w = clampGridDim(params.width ?? params.size, lim);
  const h = clampGridDim(params.height ?? params.size, hLim);
  return { w, h };
}

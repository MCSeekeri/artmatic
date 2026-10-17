/**
 * types.ts — SVG 素材生成器的公开契约。
 *
 * 一个生成器 = **纯函数** `build(params, seed) => { d, evenOdd, strokeOnly, commands }`：
 *
 *  - 坐标 authored 在 **0..100 × 0..100** 的方盒里，与 `shape:'svg'` 的
 *    `scaleFrom100` 通道对齐（见 `typography/shapes.ts`）。插入后就是一个普通
 *    `ShapeElement`，填充 / 描边 / 混合 / 动画 / 导出全部白拿。
 *  - 随机只能来自注入的 `seed`（`core/prng.ts` 的 mulberry32）。**不许碰
 *    `Math.random` / `Date.now` / DOM** —— 否则「同参数同种子复现同一张图」
 *    这条唯一的确定性承诺就没了，而预览与导出也就不是同一次随机。
 *  - 返回值只有**一条** `d`：多图形靠多条子路径（重新 `M` 起头），带洞靠
 *    `evenOdd`。Artmatic 的 `ShapeElement` 只有一份 fill + 一份 stroke，
 *    所以生成器内部不能做「逐图元不同颜色 / 线宽」（报告 §9.4 的降级）。
 *
 * 参数表复用 `effects/types.ts` 的 `ParamDef`：`range` / `select` / `checkbox` /
 * `color` 四种就够表达两个来源站的全部参数形态（见报告 §8）。
 */

import type { ParamDef } from '../../effects/types';
import type { MessageKey } from '../../i18n/locales';

/** authored 方盒边长。与 `shapes.ts` 的 0..100 坐标系同源。 */
export const GEN_BOX = 100;
/** 单素材路径命令数预算（报告 §9.7）。超过只告警，不静默改用户参数。 */
export const GEN_MAX_COMMANDS = 3000;

/** 生成器分组。顺序由 `registry.ts` 的 `GEN_GROUPS` 决定（选择器按它分区）。 */
export type SvgGenGroup = 'grid' | 'radial' | 'line' | 'outline' | 'iso' | 'code';

/** 参数值表。与 `effects/types.ts` 的取值口径一致（数字或字符串）。 */
export type SvgGenParams = Record<string, number | string>;

export interface SvgGenResult {
  /** 多子路径的 `d`，坐标 authored 在 0..100 × 0..100。 */
  d: string;
  /**
   * 带洞的图形（环 / 环带 / 嵌套框）必须为 true。
   * 渲染侧走 `fill-rule="evenodd"`，不置的话内圈会被填实。
   */
  evenOdd?: boolean;
  /**
   * 图形只有线宽没有面积（线族 / 10PRINT / 经纬球）。
   * 插入时据此给「无填充 + 描边」的默认外观。
   */
  strokeOnly?: boolean;
  /** 真实命令数（不是估算），供预算守卫与测试。 */
  commands: number;
}

export interface SvgGenSpec {
  id: string;
  /** 数据表只存键，由 UI 侧 `tr()` / `resolveLabel()` 解析（见 i18n/AGENTS.md）。 */
  labelKey: MessageKey;
  group: SvgGenGroup;
  params: ParamDef[];
  /** 不带种子时的默认值 —— 首屏不能是空图案。 */
  defaultSeed: number;
  /**
   * 期望的宽高比（`w / h`，缺省 1）。**只用于插入时定元素盒**：
   * 条码天然是 4:1，塞进方盒会被拉成 40 倍的胖块。
   */
  aspect?: number;
  build(p: SvgGenParams, seed: number): SvgGenResult;
}

/**
 * 元素上存着的生成器状态。
 *
 * `params` 存的是**合并默认值后的全量值**（不是覆盖项）：工程文件里形状不会
 * 因为将来改了默认值而静默变样，跨版本可复现。`build()` 仍对缺键回落默认值，
 * 兼容手改过的旧档。
 */
export interface ShapeGenState {
  id: string;
  /** 32 位无符号种子。 */
  seed: number;
  params: SvgGenParams;
}

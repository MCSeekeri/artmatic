/**
 * types.ts — 参数定义类型系统。
 *
 * 移植自 openmosh effects/types.ts（MIT，见 CREDITS.md），裁掉
 * mosh/volumeLink/fontPicker/text。特效与算法生成器共用这一套——
 * 「新增特效/生成器 = 定义 + 实现」的纪律靠统一的 ParamDef 撑住。
 *
 * ## 为什么字段叫 `labelKey` 而不是 `label`
 *
 * 这些定义表在**模块加载时求值一次**。里面如果直接写 `tr('…')`，取到的值会被
 * 冻结在导入那一刻的语言上，之后切语言永远不更新 —— 而且看不出来（只有
 * 那几项不动，别的都变了）。所以定义表只存 **key**，由 UI 侧 `tr()` 解析。
 *
 * 字段名带 `Key` 后缀是刻意的：它让「这里存的是键，用之前必须过 tr()」
 * 写在类型里。改名的另一个好处是所有使用点都会编译报错，漏不掉。
 */

import type { MessageKey } from '../i18n/locales';

interface ParamBase {
  key: string;
  labelKey: MessageKey;
  /**
   * 条件可见性：返回 false 时这一项在检查器里不出现（值仍保留在
   * `values` 里，不参与渲染的部分照样能写 uniforms）。
   *
   * 收到的是**当前求值后的**参数表（已含默认值），所以可以写
   * `(v) => v.outline === 1`。移植自 openmosh 的同名机制。
   */
  visibleWhen?: (values: Record<string, number | string>) => boolean;
}

export interface RangeParam extends ParamBase {
  type: 'range';
  min: number;
  max: number;
  step: number;
  defaultValue: number;
  /** 非线性滑杆指数（>1 时低段占更多行程，如 zoom）。 */
  curve?: number;
}

export interface SelectParam extends ParamBase {
  type: 'select';
  defaultValue: string;
  options: { labelKey: MessageKey; value: string }[];
}

export interface CheckboxParam extends ParamBase {
  type: 'checkbox';
  defaultValue: number;
}

export interface ColorParam extends ParamBase {
  type: 'color';
  defaultValue: string;
}

/**
 * 位分组：决定位表编辑器里这一组怎么画。
 *
 * - `'eca'`   每行画三格邻域图（■■■ → □），行序 bit 高位在前（bit7 → bit0）。
 *              一维元胞自动机的规则号就是这么读出来的。
 * - `'count'` 每行是一个计数 n（生命类 CA 的 B/S：邻居数 0..8）。
 */
export interface BitmaskGroup {
  labelKey: MessageKey;
  bits: number;
  style: 'eca' | 'count';
}

/**
 * 位掩码参数：一个 `0 .. 2^bits-1` 的整数，UI 是「可点击的位表 + 数值框」。
 *
 * 存在的理由是**同一个控件要服务两种八竿子打不着的规则**：一维 CA 的
 * 规则号（8 位、0..255）与生命类 CA 的 B/S 掩码（18 位 = 出生 9 + 存活 9）。
 * 做成 `range` 的话，B/S 会得到一条 `0..262143` 的线性滑杆 —— 毫无语义；
 * 而且 `runtime.evalParams` 对 `range` 有关键帧分支，混进来会让「这个参数
 * 能不能打关键帧」变得说不清。
 *
 * 位掩码是 **bake 入参**，因此天然不可打关键帧（`evalParams` 只对
 * `type === 'range'` 走曲线）。
 */
export interface BitmaskParam extends ParamBase {
  type: 'bitmask';
  bits: number;
  defaultValue: number;
  groups: BitmaskGroup[];
  /** 额外给一条 `0..2^bits-1` 的滑杆（一维 CA 要，B/S 不要）。 */
  slider?: boolean;
  /** 快捷预设（取代「规则号只能靠手输」）。 */
  presets?: { labelKey: MessageKey; value: number }[];
}

/**
 * 位图参数：值是一枚 `WxH:<base64>` 编码串（见 `algos/pattern-codec.ts`）。
 *
 * **空串 = 没有图案**（调用方回退到随机撒种）。图案**自带尺寸** —— 这是
 * 「改了模拟网格大小之后还能重新居中裁剪」的关键：图案不是网格的附属，
 * 它是一张独立的、可以在任何网格上盖印的图。
 *
 * 与 `bitmask` 同理，它是 bake/sim 入参、不可打关键帧。
 */
export interface PatternParam extends ParamBase {
  type: 'pattern';
  defaultValue: string;
  /** 打开编辑器时的初建边长（新建空白图案用）。 */
  editorSize?: number;
  /** `'2d'` 手绘图案（生命游戏）；`'1d'` 单行（一维 CA 的初始行）。 */
  mode?: '2d' | '1d';
}

export type ParamDef =
  | RangeParam
  | SelectParam
  | CheckboxParam
  | ColorParam
  | BitmaskParam
  | PatternParam;

export function defaultValues(params: ParamDef[]): Record<string, number | string> {
  const out: Record<string, number | string> = {};
  for (const p of params) out[p.key] = p.defaultValue;
  return out;
}

/** 按 `visibleWhen` 过一遍参数表。values 缺项时用 defaultValue 补。 */
export function visibleParams(
  params: ParamDef[],
  values: Record<string, number | string>,
): ParamDef[] {
  return params.filter((p) => {
    if (!p.visibleWhen) return true;
    const merged: Record<string, number | string> = {};
    for (const q of params) merged[q.key] = values[q.key] ?? q.defaultValue;
    return p.visibleWhen(merged);
  });
}

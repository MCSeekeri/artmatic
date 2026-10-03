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

export type ParamDef = RangeParam | SelectParam | CheckboxParam | ColorParam;

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

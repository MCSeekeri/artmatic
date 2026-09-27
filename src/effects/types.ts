/**
 * types.ts — 参数定义类型系统。
 *
 * 移植自 openmosh effects/types.ts（MIT，见 CREDITS.md），裁掉
 * mosh/volumeLink/fontPicker/text。特效与算法生成器共用这一套——
 * 「新增特效/生成器 = 定义 + 实现」的纪律靠统一的 ParamDef 撑住。
 */

export interface RangeParam {
  key: string;
  label: string;
  type: 'range';
  min: number;
  max: number;
  step: number;
  defaultValue: number;
  /** 非线性滑杆指数（>1 时低段占更多行程，如 zoom）。 */
  curve?: number;
}

export interface SelectParam {
  key: string;
  label: string;
  type: 'select';
  defaultValue: string;
  options: { label: string; value: string }[];
}

export interface CheckboxParam {
  key: string;
  label: string;
  type: 'checkbox';
  defaultValue: number;
}

export interface ColorParam {
  key: string;
  label: string;
  type: 'color';
  defaultValue: string;
}

export type ParamDef = RangeParam | SelectParam | CheckboxParam | ColorParam;

export function defaultValues(params: ParamDef[]): Record<string, number | string> {
  const out: Record<string, number | string> = {};
  for (const p of params) out[p.key] = p.defaultValue;
  return out;
}

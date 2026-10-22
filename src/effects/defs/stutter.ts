import type { ParamDef } from '../types';

export const id = 'stutter';
export const nameKey = 'fx.stutter';
export const params: ParamDef[] = [
  { key: 'rate', labelKey: 'fx.stutter.rate', type: 'range', min: 1, max: 30, step: 1, defaultValue: 12 },
  // 0 = 窗口内完全冻结（干净的顿帧）；1 = 整个窗口平均（拖影最长）
  { key: 'shutter', labelKey: 'fx.stutter.shutter', type: 'range', min: 0, max: 1, step: 0.01, defaultValue: 0.6 },
];

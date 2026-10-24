import type { ParamDef } from '../types';

export const id = 'fisheye';
export const nameKey = 'fx.fisheye';
export const params: ParamDef[] = [
  { key: 'strength', labelKey: 'fx.fisheye.strength', type: 'range', min: 0, max: 1, step: 0.01, defaultValue: 0.6 },
  // 采样半径的除数：> 1 = 放大（把四角黑边裁出画外），< 1 = 往外放（黑边更大）
  { key: 'crop', labelKey: 'fx.fisheye.crop', type: 'range', min: 0.4, max: 2, step: 0.01, defaultValue: 1 },
  { key: 'reverse', labelKey: 'fx.fisheye.reverse', type: 'checkbox', defaultValue: 0 },
];

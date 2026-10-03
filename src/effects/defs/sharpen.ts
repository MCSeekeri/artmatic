import type { ParamDef } from '../types';

export const id = 'sharpen';
export const nameKey = 'fx.sharpen';
export const params: ParamDef[] = [
  { key: 'amount', labelKey: 'fx.sharpen.amount', type: 'range', min: 0, max: 10, step: 0.01, defaultValue: 3 },
  { key: 'radius', labelKey: 'fx.sharpen.radius', type: 'range', min: 0.5, max: 25, step: 0.5, defaultValue: 5 },
  { key: 'threshold', labelKey: 'fx.sharpen.threshold', type: 'range', min: 0, max: 0.25, step: 0.005, defaultValue: 0 },
];

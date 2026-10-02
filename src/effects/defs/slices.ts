import type { ParamDef } from '../types';

export const id = 'slices';
export const nameKey = 'fx.slices';
export const params: ParamDef[] = [
  { key: 'count', labelKey: 'fx.slices.count', type: 'range', min: 4, max: 120, step: 1, defaultValue: 36 },
  { key: 'amount', labelKey: 'fx.slices.amount', type: 'range', min: 0, max: 0.3, step: 0.005, defaultValue: 0.08 },
  { key: 'coverage', labelKey: 'fx.slices.coverage', type: 'range', min: 0, max: 1, step: 0.01, defaultValue: 0.5 },
];

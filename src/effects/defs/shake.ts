import type { ParamDef } from '../types';

export const id = 'shake';
export const nameKey = 'fx.shake';
export const params: ParamDef[] = [
  { key: 'amount', labelKey: 'fx.shake.amount', type: 'range', min: 0, max: 50, step: 1, defaultValue: 10 },
  { key: 'speed', labelKey: 'fx.shake.speed', type: 'range', min: 1, max: 60, step: 1, defaultValue: 20, curve: 5 },
];

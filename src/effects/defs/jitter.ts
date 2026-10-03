import type { ParamDef } from '../types';

export const id = 'jitter';
export const nameKey = 'fx.jitter';
export const params: ParamDef[] = [
  { key: 'amount', labelKey: 'fx.jitter.amount', type: 'range', min: 0, max: 100, step: 1, defaultValue: 20 },
  { key: 'speed', labelKey: 'fx.jitter.speed', type: 'range', min: 0.1, max: 5, step: 0.1, defaultValue: 1 },
];

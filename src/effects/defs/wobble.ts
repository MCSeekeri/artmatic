import type { ParamDef } from '../types';

export const id = 'wobble';
export const nameKey = 'fx.wobble';
export const params: ParamDef[] = [
  { key: 'amount', labelKey: 'fx.wobble.amount', type: 'range', min: 0, max: 100, step: 1, defaultValue: 20 },
  { key: 'frequency', labelKey: 'fx.wobble.frequency', type: 'range', min: 1, max: 5, step: 0.1, defaultValue: 3 },
  { key: 'speed', labelKey: 'fx.wobble.speed', type: 'range', min: 0.1, max: 5, step: 0.1, defaultValue: 1 },
];

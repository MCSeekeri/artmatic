import type { ParamDef } from '../types';

export const id = 'ripple';
export const nameKey = 'fx.ripple';
export const params: ParamDef[] = [
  { key: 'amount', labelKey: 'fx.ripple.amount', type: 'range', min: 0, max: 100, step: 0.5, defaultValue: 10 },
  { key: 'frequency', labelKey: 'fx.ripple.frequency', type: 'range', min: 1, max: 30, step: 0.5, defaultValue: 8 },
  { key: 'speed', labelKey: 'fx.ripple.speed', type: 'range', min: 0.1, max: 5, step: 0.1, defaultValue: 1 },
];

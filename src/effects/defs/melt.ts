import type { ParamDef } from '../types';

export const id = 'melt';
export const nameKey = 'fx.melt';
export const params: ParamDef[] = [
  { key: 'amount', labelKey: 'fx.melt.amount', type: 'range', min: 0, max: 1, step: 0.01, defaultValue: 0.5 },
  { key: 'speed', labelKey: 'fx.melt.speed', type: 'range', min: 0.1, max: 5, step: 0.1, defaultValue: 1 },
];

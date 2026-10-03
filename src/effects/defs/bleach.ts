import type { ParamDef } from '../types';

export const id = 'bleach';
export const nameKey = 'fx.bleach';
export const params: ParamDef[] = [
  { key: 'amount', labelKey: 'fx.bleach.amount', type: 'range', min: 0, max: 1, step: 0.01, defaultValue: 0.5 },
];

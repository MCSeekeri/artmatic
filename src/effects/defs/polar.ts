import type { ParamDef } from '../types';

export const id = 'polar';
export const nameKey = 'fx.polar';
export const params: ParamDef[] = [
  { key: 'amount', labelKey: 'fx.polar.amount', type: 'range', min: 0, max: 1, step: 0.01, defaultValue: 1 },
  { key: 'angle', labelKey: 'fx.polar.angle', type: 'range', min: 0, max: 360, step: 1, defaultValue: 0 },
];

import type { ParamDef } from '../types';

export const id = 'bulge';
export const nameKey = 'fx.bulge';
export const params: ParamDef[] = [
  { key: 'amount', labelKey: 'fx.bulge.amount', type: 'range', min: -1, max: 1, step: 0.01, defaultValue: 0.5 },
  { key: 'radius', labelKey: 'fx.bulge.radius', type: 'range', min: 0.01, max: 1, step: 0.01, defaultValue: 0.5 },
];

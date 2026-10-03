import type { ParamDef } from '../types';

export const id = 'relief';
export const nameKey = 'fx.relief';
export const params: ParamDef[] = [
  { key: 'amount', labelKey: 'fx.relief.amount', type: 'range', min: 0, max: 0.8, step: 0.005, defaultValue: 0.35 },
  { key: 'angle', labelKey: 'fx.relief.angle', type: 'range', min: 0, max: 360, step: 1, defaultValue: 30 },
];

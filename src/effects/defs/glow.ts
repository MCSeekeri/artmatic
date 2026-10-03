import type { ParamDef } from '../types';

export const id = 'glow';
export const nameKey = 'fx.glow';
export const params: ParamDef[] = [
  { key: 'amount', labelKey: 'fx.glow.amount', type: 'range', min: 0, max: 50, step: 0.01, defaultValue: 4 },
  { key: 'cutoff', labelKey: 'fx.glow.cutoff', type: 'range', min: 0, max: 0.7, step: 0.01, defaultValue: 0.3 },
  { key: 'radius', labelKey: 'fx.glow.radius', type: 'range', min: 1, max: 10, step: 0.5, defaultValue: 8 },
];

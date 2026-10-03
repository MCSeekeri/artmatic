import type { ParamDef } from '../types';

export const id = 'smear';
export const nameKey = 'fx.smear';
export const params: ParamDef[] = [
  { key: 'amount', labelKey: 'fx.smear.amount', type: 'range', min: 0, max: 1, step: 0.01, defaultValue: 0.5 },
  { key: 'angle', labelKey: 'fx.smear.angle', type: 'range', min: 0, max: 360, step: 1, defaultValue: 0 },
  { key: 'trail', labelKey: 'fx.smear.trail', type: 'range', min: 0, max: 1, step: 0.01, defaultValue: 0.45 },
];

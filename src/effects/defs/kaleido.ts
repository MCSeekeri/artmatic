import type { ParamDef } from '../types';

export const id = 'kaleido';
export const nameKey = 'fx.kaleido';
export const params: ParamDef[] = [
  { key: 'amount', labelKey: 'fx.kaleido.amount', type: 'range', min: 0, max: 1, step: 0.01, defaultValue: 1 },
  { key: 'sides', labelKey: 'fx.kaleido.sides', type: 'range', min: 2, max: 12, step: 1, defaultValue: 6 },
  { key: 'angle', labelKey: 'fx.kaleido.angle', type: 'range', min: 0, max: 360, step: 1, defaultValue: 0 },
];

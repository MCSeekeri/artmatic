import type { ParamDef } from '../types';

export const id = 'zoom';
export const nameKey = 'fx.zoom';
export const params: ParamDef[] = [
  { key: 'amount', labelKey: 'fx.zoom.amount', type: 'range', min: -1, max: 1, step: 0.01, defaultValue: 0 },
];

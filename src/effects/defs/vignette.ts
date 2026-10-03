import type { ParamDef } from '../types';

export const id = 'vignette';
export const nameKey = 'fx.vignette';
export const params: ParamDef[] = [
  { key: 'size', labelKey: 'fx.vignette.size', type: 'range', min: 0, max: 1, step: 0.01, defaultValue: 0.5 },
  { key: 'amount', labelKey: 'fx.vignette.amount', type: 'range', min: 0, max: 1, step: 0.01, defaultValue: 0.5 },
  { key: 'transparent', labelKey: 'fx.vignette.transparent', type: 'checkbox', defaultValue: 0 },
];

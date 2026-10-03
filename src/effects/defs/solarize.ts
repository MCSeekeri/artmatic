import type { ParamDef } from '../types';

export const id = 'solarize';
export const nameKey = 'fx.solarize';
export const params: ParamDef[] = [
  { key: 'pivot', labelKey: 'fx.solarize.pivot', type: 'range', min: 0.1, max: 0.9, step: 0.01, defaultValue: 0.5 },
  { key: 'curve', labelKey: 'fx.solarize.curve', type: 'range', min: 0.5, max: 4, step: 0.05, defaultValue: 2 },
  { key: 'colorize', labelKey: 'fx.solarize.colorize', type: 'range', min: 0, max: 1, step: 0.01, defaultValue: 0.1 },
];

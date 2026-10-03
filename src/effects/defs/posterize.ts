import type { ParamDef } from '../types';

export const id = 'posterize';
export const nameKey = 'fx.posterize';
export const params: ParamDef[] = [
  { key: 'levels', labelKey: 'fx.posterize.levels', type: 'range', min: 2, max: 20, step: 1, defaultValue: 8 },
];

import type { ParamDef } from '../types';

export const id = 'blur';
export const nameKey = 'fx.blur';
export const params: ParamDef[] = [
  { key: 'radius', labelKey: 'fx.blur.radius', type: 'range', min: 0, max: 20, step: 0.5, defaultValue: 5 },
];

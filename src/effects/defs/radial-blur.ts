import type { ParamDef } from '../types';

export const id = 'radial-blur';
export const nameKey = 'fx.radialBlur';
export const params: ParamDef[] = [
  { key: 'strength', labelKey: 'fx.radialBlur.strength', type: 'range', min: 0, max: 1, step: 0.01, defaultValue: 0.4 },
];

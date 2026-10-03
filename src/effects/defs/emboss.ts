import type { ParamDef } from '../types';

export const id = 'emboss';
export const nameKey = 'fx.emboss';
export const params: ParamDef[] = [
  { key: 'strength', labelKey: 'fx.emboss.strength', type: 'range', min: 0, max: 5, step: 0.01, defaultValue: 1 },
  { key: 'angle', labelKey: 'fx.emboss.angle', type: 'range', min: 0, max: 360, step: 1, defaultValue: 135 },
  { key: 'mix', labelKey: 'fx.emboss.mix', type: 'range', min: 0, max: 1, step: 0.01, defaultValue: 0.5 },
];

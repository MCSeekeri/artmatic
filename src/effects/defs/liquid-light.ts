import type { ParamDef } from '../types';

export const id = 'liquid-light';
export const nameKey = 'fx.liquidLight';
export const params: ParamDef[] = [
  { key: 'scale', labelKey: 'fx.liquidLight.scale', type: 'range', min: 0, max: 1, step: 0.01, defaultValue: 0.55 },
  { key: 'flow', labelKey: 'fx.liquidLight.flow', type: 'range', min: 0, max: 1, step: 0.01, defaultValue: 0.4 },
  { key: 'refraction', labelKey: 'fx.liquidLight.refraction', type: 'range', min: 0, max: 1, step: 0.01, defaultValue: 0.5 },
  { key: 'dispersion', labelKey: 'fx.liquidLight.dispersion', type: 'range', min: 0, max: 1, step: 0.01, defaultValue: 0.45 },
];

import type { ParamDef } from '../types';

export const id = 'fiber-displace';
export const nameKey = 'fx.fiberDisplace';
export const params: ParamDef[] = [
  { key: 'strength', labelKey: 'fx.fiberDisplace.strength', type: 'range', min: 0, max: 1, step: 0.01, defaultValue: 0.4 },
  { key: 'density', labelKey: 'fx.fiberDisplace.density', type: 'range', min: 2, max: 80, step: 1, defaultValue: 30 },
  { key: 'comb', labelKey: 'fx.fiberDisplace.comb', type: 'range', min: 0, max: 1, step: 0.01, defaultValue: 0.55 },
  { key: 'angle', labelKey: 'fx.fiberDisplace.angle', type: 'range', min: 0, max: 360, step: 1, defaultValue: 0 },
  { key: 'chrome', labelKey: 'fx.fiberDisplace.chrome', type: 'range', min: 0, max: 1, step: 0.01, defaultValue: 0.4 },
  { key: 'smoothness', labelKey: 'fx.fiberDisplace.smoothness', type: 'range', min: 0, max: 1, step: 0.01, defaultValue: 0.3 },
];

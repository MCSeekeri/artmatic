import { clockParams } from '../shader-def';
import type { ParamDef } from '../types';

export const id = 'shockwave';
export const nameKey = 'fx.shockwave';
export const params: ParamDef[] = [
  ...clockParams({ labelKey: 'fx.shockwave.rate', min: 0.1, max: 4, step: 0.05, defaultValue: 0.5 }),
  { key: 'magnitude', labelKey: 'fx.shockwave.magnitude', type: 'range', min: 0, max: 0.2, step: 0.005, defaultValue: 0.08 },
  { key: 'distortion', labelKey: 'fx.shockwave.distortion', type: 'range', min: 0, max: 20, step: 0.1, defaultValue: 10 },
  { key: 'centerX', labelKey: 'fx.shockwave.centerX', type: 'range', min: 0, max: 1, step: 0.01, defaultValue: 0.5 },
  { key: 'centerY', labelKey: 'fx.shockwave.centerY', type: 'range', min: 0, max: 1, step: 0.01, defaultValue: 0.5 },
];

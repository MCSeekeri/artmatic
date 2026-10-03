import type { ParamDef } from '../types';

export const id = 'swirl';
export const nameKey = 'fx.swirl';
export const params: ParamDef[] = [
  { key: 'angle', labelKey: 'fx.swirl.angle', type: 'range', min: 0, max: 720, step: 1, defaultValue: 180 },
  { key: 'radius', labelKey: 'fx.swirl.radius', type: 'range', min: 0.1, max: 1.5, step: 0.01, defaultValue: 0.75 },
  { key: 'speed', labelKey: 'fx.swirl.speed', type: 'range', min: 0, max: 5, step: 0.1, defaultValue: 0.5 },
];

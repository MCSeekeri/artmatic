import type { ParamDef } from '../types';

export const id = 'scanlines';
export const nameKey = 'fx.scanlines';
export const params: ParamDef[] = [
  { key: 'intensity', labelKey: 'fx.scanlines.strength', type: 'range', min: 0, max: 1, step: 0.01, defaultValue: 0.25 },
  { key: 'spacing', labelKey: 'fx.scanlines.gap', type: 'range', min: 1, max: 8, step: 1, defaultValue: 3 },
];

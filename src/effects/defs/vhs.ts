import type { ParamDef } from '../types';

export const id = 'vhs';
export const nameKey = 'fx.vhs';
export const params: ParamDef[] = [
  { key: 'static', labelKey: 'fx.vhs.static', type: 'range', min: 0, max: 1, step: 0.01, defaultValue: 0.5 },
  { key: 'speed', labelKey: 'fx.vhs.speed', type: 'range', min: 0.1, max: 5, step: 0.1, defaultValue: 1 },
  { key: 'tracking', labelKey: 'fx.vhs.tracking', type: 'range', min: 0, max: 1, step: 0.01, defaultValue: 0.5 },
];

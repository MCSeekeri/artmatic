import type { ParamDef } from '../types';

export const id = 'soft-glitch';
export const nameKey = 'fx.softGlitch';
export const params: ParamDef[] = [
  { key: 'amount', labelKey: 'fx.softGlitch.amount', type: 'range', min: 0, max: 50, step: 1, defaultValue: 15 },
  { key: 'speed', labelKey: 'fx.softGlitch.speed', type: 'range', min: 0.1, max: 5, step: 0.1, defaultValue: 2 },
];

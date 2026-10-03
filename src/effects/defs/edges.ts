import type { ParamDef } from '../types';

export const id = 'edges';
export const nameKey = 'fx.edges';
export const params: ParamDef[] = [
  { key: 'strength', labelKey: 'fx.edges.strength', type: 'range', min: 0, max: 1, step: 0.01, defaultValue: 0.5 },
  { key: 'mix', labelKey: 'fx.edges.mix', type: 'range', min: 0, max: 1, step: 0.01, defaultValue: 1 },
];

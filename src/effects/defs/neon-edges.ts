import type { ParamDef } from '../types';

export const id = 'neon-edges';
export const nameKey = 'fx.neonEdges';
export const params: ParamDef[] = [
  { key: 'strength', labelKey: 'fx.neonEdges.strength', type: 'range', min: 0.1, max: 5, step: 0.1, defaultValue: 1.5 },
  { key: 'glow', labelKey: 'fx.neonEdges.glow', type: 'range', min: 0, max: 3, step: 0.05, defaultValue: 1 },
  { key: 'bg', labelKey: 'fx.neonEdges.bg', type: 'range', min: 0, max: 1, step: 0.01, defaultValue: 0.05 },
];

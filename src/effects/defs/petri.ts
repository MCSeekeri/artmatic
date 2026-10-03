import type { ParamDef } from '../types';

export const id = 'petri';
export const nameKey = 'fx.petri';
export const params: ParamDef[] = [
  { key: 'reaction', labelKey: 'fx.petri.reaction', type: 'range', min: 0, max: 1, step: 0.01, defaultValue: 0.5 },
  { key: 'drift', labelKey: 'fx.petri.drift', type: 'range', min: 0, max: 1, step: 0.01, defaultValue: 0.72 },
  { key: 'scale', labelKey: 'fx.petri.scale', type: 'range', min: 0, max: 1, step: 0.01, defaultValue: 0.3 },
  { key: 'takeover', labelKey: 'fx.petri.takeover', type: 'range', min: 0, max: 1, step: 0.01, defaultValue: 0.45 },
];

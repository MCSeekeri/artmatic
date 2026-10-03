import type { ParamDef } from '../types';

export const id = 'ghosting';
export const nameKey = 'fx.ghosting';
export const params: ParamDef[] = [
  { key: 'bias', labelKey: 'fx.ghosting.bias', type: 'range', min: -1, max: 0, step: 0.01, defaultValue: -0.5 },
  { key: 'scale', labelKey: 'fx.ghosting.scale', type: 'range', min: 0, max: 2, step: 0.01, defaultValue: 0.5 },
  { key: 'ghosts', labelKey: 'fx.ghosting.ghosts', type: 'range', min: 1, max: 5, step: 1, defaultValue: 5 },
  { key: 'dispersal', labelKey: 'fx.ghosting.dispersal', type: 'range', min: 0, max: 0.5, step: 0.0025, defaultValue: 0.0125 },
  { key: 'dirX', labelKey: 'fx.ghosting.dirX', type: 'range', min: 0, max: 1, step: 0.01, defaultValue: 0.5 },
  { key: 'dirY', labelKey: 'fx.ghosting.dirY', type: 'range', min: 0, max: 1, step: 0.01, defaultValue: 0.5 },
  { key: 'lensColor', labelKey: 'fx.ghosting.lensColor', type: 'color', defaultValue: '#e6ccb3' },
  { key: 'additive', labelKey: 'fx.ghosting.additive', type: 'checkbox', defaultValue: 1 },
];

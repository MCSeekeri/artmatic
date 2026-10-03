import type { ParamDef } from '../types';

export const id = 'flash-glitch';
export const nameKey = 'fx.flashGlitch';
export const params: ParamDef[] = [
  { key: 'strength', labelKey: 'fx.flashGlitch.strength', type: 'range', min: 0, max: 1, step: 0.01, defaultValue: 0.6 },
  { key: 'rate', labelKey: 'fx.flashGlitch.rate', type: 'range', min: 0, max: 20, step: 0.1, defaultValue: 4 },
  { key: 'release', labelKey: 'fx.flashGlitch.release', type: 'range', min: 0.05, max: 2, step: 0.01, defaultValue: 0.5 },
  { key: 'hue', labelKey: 'fx.flashGlitch.hue', type: 'range', min: 0, max: 1, step: 0.01, defaultValue: 0 },
];

import type { ParamDef } from '../types';

export const id = 'godray';
export const nameKey = 'fx.godray';
export const params: ParamDef[] = [
  { key: 'angle', labelKey: 'fx.godray.angle', type: 'range', min: 0, max: 360, step: 1, defaultValue: 30 },
  { key: 'gain', labelKey: 'fx.godray.gain', type: 'range', min: 0.3, max: 1, step: 0.01, defaultValue: 0.6 },
  { key: 'lacunarity', labelKey: 'fx.godray.lacunarity', type: 'range', min: 1, max: 4, step: 0.01, defaultValue: 2 },
  { key: 'alpha', labelKey: 'fx.godray.alpha', type: 'range', min: 0, max: 1, step: 0.01, defaultValue: 0.4 },
  { key: 'speed', labelKey: 'fx.godray.speed', type: 'range', min: 0, max: 3, step: 0.05, defaultValue: 1 },
  { key: 'fade', labelKey: 'fx.godray.fade', type: 'range', min: 0, max: 1, step: 0.01, defaultValue: 1 },
];

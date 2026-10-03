import type { ParamDef } from '../types';

export const id = 'reflection';
export const nameKey = 'fx.reflection';
export const params: ParamDef[] = [
  { key: 'boundary', labelKey: 'fx.reflection.boundary', type: 'range', min: 0, max: 1, step: 0.01, defaultValue: 0.6 },
  { key: 'mirror', labelKey: 'fx.reflection.mirror', type: 'checkbox', defaultValue: 1 },
  { key: 'ampMin', labelKey: 'fx.reflection.ampMin', type: 'range', min: 0, max: 20, step: 0.1, defaultValue: 2 },
  { key: 'ampMax', labelKey: 'fx.reflection.ampMax', type: 'range', min: 0, max: 20, step: 0.1, defaultValue: 8 },
  { key: 'waveMin', labelKey: 'fx.reflection.waveMin', type: 'range', min: 5, max: 200, step: 1, defaultValue: 30 },
  { key: 'waveMax', labelKey: 'fx.reflection.waveMax', type: 'range', min: 5, max: 200, step: 1, defaultValue: 100 },
  { key: 'alphaMin', labelKey: 'fx.reflection.alphaMin', type: 'range', min: 0, max: 1, step: 0.01, defaultValue: 0.9 },
  { key: 'alphaMax', labelKey: 'fx.reflection.alphaMax', type: 'range', min: 0, max: 1, step: 0.01, defaultValue: 0.5 },
  { key: 'speed', labelKey: 'fx.reflection.speed', type: 'range', min: 0, max: 5, step: 0.05, defaultValue: 1 },
];

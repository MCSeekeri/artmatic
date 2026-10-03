import type { ParamDef } from '../types';

export const id = 'color-correction';
export const nameKey = 'fx.colorCorrection';
export const params: ParamDef[] = [
  { key: 'brightness', labelKey: 'fx.colorCorrection.brightness', type: 'range', min: -1, max: 1, step: 0.01, defaultValue: 0 },
  { key: 'contrast', labelKey: 'fx.colorCorrection.contrast', type: 'range', min: -1, max: 1, step: 0.01, defaultValue: 0 },
  { key: 'hue', labelKey: 'fx.colorCorrection.hue', type: 'range', min: -180, max: 180, step: 1, defaultValue: 0 },
  { key: 'saturation', labelKey: 'fx.colorCorrection.saturation', type: 'range', min: -1, max: 1, step: 0.01, defaultValue: 0 },
];

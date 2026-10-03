import type { ParamDef } from '../types';

export const id = 'sobel-neon';
export const nameKey = 'fx.sobelNeon';
export const params: ParamDef[] = [
  { key: 'width', labelKey: 'fx.sobelNeon.width', type: 'range', min: 0.05, max: 5, step: 0.05, defaultValue: 1 },
  { key: 'neon', labelKey: 'fx.sobelNeon.neon', type: 'range', min: 0, max: 1, step: 0.01, defaultValue: 1 },
  { key: 'brightness', labelKey: 'fx.sobelNeon.brightness', type: 'range', min: 0.2, max: 2, step: 0.01, defaultValue: 1 },
  { key: 'bgFade', labelKey: 'fx.sobelNeon.bgFade', type: 'range', min: 0, max: 1, step: 0.01, defaultValue: 0 },
  { key: 'bgColor', labelKey: 'fx.sobelNeon.bgColor', type: 'color', defaultValue: '#000000' },
];

import type { ParamDef } from '../types';

export const id = 'pixelate';
export const nameKey = 'fx.pixelate';
export const params: ParamDef[] = [
  { key: 'size', labelKey: 'fx.pixelate.size', type: 'range', min: 1, max: 64, step: 1, defaultValue: 8 },
];

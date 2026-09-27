import type { ParamDef } from '../types';

export const id = 'pixelate';
export const name = '像素化';
export const params: ParamDef[] = [
  { key: 'size', label: '像素块(px)', type: 'range', min: 1, max: 64, step: 1, defaultValue: 8 },
];

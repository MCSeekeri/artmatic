import type { ParamDef } from '../types';

export const id = 'tile';
export const nameKey = 'fx.tile';
export const params: ParamDef[] = [
  { key: 'size', labelKey: 'fx.tile.size', type: 'range', min: 1, max: 10, step: 0.1, defaultValue: 2 },
  { key: 'offset', labelKey: 'fx.tile.offset', type: 'range', min: 0, max: 1, step: 0.01, defaultValue: 0 },
  { key: 'angle', labelKey: 'fx.tile.angle', type: 'range', min: 0, max: 360, step: 1, defaultValue: 0 },
  { key: 'speed', labelKey: 'fx.tile.speed', type: 'range', min: 0, max: 50, step: 0.1, defaultValue: 0 },
];

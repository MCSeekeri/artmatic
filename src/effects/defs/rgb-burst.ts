import { clockParams } from '../shader-def';
import type { ParamDef } from '../types';

export const id = 'rgb-burst';
export const nameKey = 'fx.rgbBurst';
export const params: ParamDef[] = [
  { key: 'amplitude', labelKey: 'fx.rgbBurst.amplitude', type: 'range', min: 0, max: 5, step: 0.05, defaultValue: 3 },
  ...clockParams({ labelKey: 'fx.rgbBurst.speed', min: 0, max: 10, step: 0.1, defaultValue: 1 }),
];

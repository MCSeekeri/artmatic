import { clockParams } from '../shader-def';
import type { ParamDef } from '../types';

export const id = 'rgb-strobe';
export const nameKey = 'fx.rgbStrobe';
export const params: ParamDef[] = [
  ...clockParams({ labelKey: 'fx.rgbStrobe.rate', min: 0.2, max: 20, step: 0.1, defaultValue: 4 }),
  { key: 'stagger', labelKey: 'fx.rgbStrobe.stagger', type: 'range', min: 0, max: 1, step: 0.01, defaultValue: 0.33 },
  { key: 'duty', labelKey: 'fx.rgbStrobe.duty', type: 'range', min: 0.05, max: 0.95, step: 0.01, defaultValue: 0.5 },
  { key: 'red', labelKey: 'fx.rgbStrobe.red', type: 'checkbox', defaultValue: 1 },
  { key: 'green', labelKey: 'fx.rgbStrobe.green', type: 'checkbox', defaultValue: 1 },
  { key: 'blue', labelKey: 'fx.rgbStrobe.blue', type: 'checkbox', defaultValue: 1 },
];

import type { ParamDef } from '../types';

export const id = 'flow-contours';
export const nameKey = 'fx.flowContours';
export const params: ParamDef[] = [
  { key: 'bands', labelKey: 'fx.flowContours.bands', type: 'range', min: 2, max: 24, step: 1, defaultValue: 8 },
  { key: 'flow', labelKey: 'fx.flowContours.flow', type: 'range', min: 0, max: 1, step: 0.01, defaultValue: 0.45 },
  { key: 'cycle', labelKey: 'fx.flowContours.cycle', type: 'range', min: 0, max: 1, step: 0.01, defaultValue: 0.5 },
  { key: 'sheen', labelKey: 'fx.flowContours.sheen', type: 'range', min: 0, max: 1, step: 0.01, defaultValue: 0.4 },
];

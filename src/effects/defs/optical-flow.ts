import type { ParamDef } from '../types';

export const id = 'optical-flow';
export const nameKey = 'fx.opticalFlow';
export const params: ParamDef[] = [
  { key: 'amount', labelKey: 'fx.opticalFlow.amount', type: 'range', min: 0, max: 1, step: 0.01, defaultValue: 0.65 },
  { key: 'speed', labelKey: 'fx.opticalFlow.speed', type: 'range', min: 0.1, max: 10, step: 0.1, defaultValue: 0.5 },
];

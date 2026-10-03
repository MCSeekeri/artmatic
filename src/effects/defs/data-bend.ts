import type { ParamDef } from '../types';

export const id = 'data-bend';
export const nameKey = 'fx.dataBend';
export const params: ParamDef[] = [
  { key: 'intensity', labelKey: 'fx.dataBend.intensity', type: 'range', min: 0, max: 100, step: 1, defaultValue: 30 },
  { key: 'corruption', labelKey: 'fx.dataBend.corruption', type: 'range', min: 0, max: 1, step: 0.01, defaultValue: 0.3 },
  { key: 'channelShift', labelKey: 'fx.dataBend.channelShift', type: 'range', min: 0, max: 1, step: 0.01, defaultValue: 0.2 },
  { key: 'speed', labelKey: 'fx.dataBend.speed', type: 'range', min: 0.5, max: 20, step: 0.5, defaultValue: 4 },
];

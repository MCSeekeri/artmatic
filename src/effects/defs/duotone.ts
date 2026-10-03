import type { ParamDef } from '../types';

export const id = 'duotone';
export const nameKey = 'fx.duotone';
export const params: ParamDef[] = [
  { key: 'shadowColor', labelKey: 'fx.duotone.shadowColor', type: 'color', defaultValue: '#00194d' },
  { key: 'highlightColor', labelKey: 'fx.duotone.highlightColor', type: 'color', defaultValue: '#ffaa00' },
  { key: 'intensity', labelKey: 'fx.duotone.intensity', type: 'range', min: 0, max: 1, step: 0.01, defaultValue: 1 },
];

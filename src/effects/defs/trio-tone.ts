import type { ParamDef } from '../types';

export const id = 'trio-tone';
export const nameKey = 'fx.trioTone';
export const params: ParamDef[] = [
  { key: 'darkColor', labelKey: 'fx.trioTone.darkColor', type: 'color', defaultValue: '#002aff' },
  { key: 'midColor', labelKey: 'fx.trioTone.midColor', type: 'color', defaultValue: '#00ff00' },
  { key: 'brightColor', labelKey: 'fx.trioTone.brightColor', type: 'color', defaultValue: '#ff0000' },
  { key: 'intensity', labelKey: 'fx.trioTone.intensity', type: 'range', min: 0, max: 1, step: 0.01, defaultValue: 1 },
];

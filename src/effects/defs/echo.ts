import type { ParamDef } from '../types';

export const id = 'echo';
export const nameKey = 'fx.echo';
export const params: ParamDef[] = [
  { key: 'decay', labelKey: 'fx.echo.decay', type: 'range', min: 0, max: 0.98, step: 0.01, defaultValue: 0.82 },
  { key: 'floor', labelKey: 'fx.echo.floor', type: 'range', min: 0, max: 0.2, step: 0.005, defaultValue: 0.04 },
  { key: 'weight', labelKey: 'fx.echo.weight', type: 'range', min: 0, max: 1, step: 0.01, defaultValue: 0.9 },
  { key: 'zoom', labelKey: 'fx.echo.zoom', type: 'range', min: -0.05, max: 0.05, step: 0.001, defaultValue: 0.01 },
  { key: 'spin', labelKey: 'fx.echo.spin', type: 'range', min: -0.05, max: 0.05, step: 0.001, defaultValue: 0 },
];

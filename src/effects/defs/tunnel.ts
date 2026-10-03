import type { ParamDef } from '../types';

export const id = 'tunnel';
export const nameKey = 'fx.tunnel';
export const params: ParamDef[] = [
  { key: 'zoom', labelKey: 'fx.tunnel.zoom', type: 'range', min: 0, max: 1, step: 0.01, defaultValue: 0.3 },
  { key: 'spin', labelKey: 'fx.tunnel.spin', type: 'range', min: -180, max: 180, step: 1, defaultValue: 0 },
  { key: 'decay', labelKey: 'fx.tunnel.decay', type: 'range', min: 0, max: 1, step: 0.01, defaultValue: 0.2 },
];

import type { ParamDef } from '../types';

export const id = 'circle-warp';
export const nameKey = 'fx.circleWarp';
export const params: ParamDef[] = [
  { key: 'radius', labelKey: 'fx.circleWarp.radius', type: 'range', min: 0.05, max: 0.5, step: 0.005, defaultValue: 0.5 },
  { key: 'width', labelKey: 'fx.circleWarp.width', type: 'range', min: 0.1, max: 2, step: 0.01, defaultValue: 1 },
  { key: 'rotation', labelKey: 'fx.circleWarp.rotation', type: 'range', min: 0, max: 1, step: 0.005, defaultValue: 0 },
];

import type { ParamDef } from '../types';

export const id = 'motion-mask';
export const nameKey = 'fx.motionMask';
export const params: ParamDef[] = [
  { key: 'threshold', labelKey: 'fx.motionMask.threshold', type: 'range', min: 0, max: 1, step: 0.01, defaultValue: 0.25 },
  { key: 'persistence', labelKey: 'fx.motionMask.persistence', type: 'range', min: 0.9, max: 1, step: 0.001, defaultValue: 0.95 },
  { key: 'erode', labelKey: 'fx.motionMask.erode', type: 'range', min: 0, max: 6, step: 1, defaultValue: 0 },
  { key: 'blur', labelKey: 'fx.motionMask.blur', type: 'range', min: 0, max: 6, step: 1, defaultValue: 0 },
  { key: 'still', labelKey: 'fx.motionMask.still', type: 'range', min: 0, max: 1, step: 0.01, defaultValue: 0 },
  { key: 'showMask', labelKey: 'fx.motionMask.showMask', type: 'checkbox', defaultValue: 0 },
  { key: 'hardCutoff', labelKey: 'fx.motionMask.hardCutoff', type: 'checkbox', defaultValue: 1 },
];

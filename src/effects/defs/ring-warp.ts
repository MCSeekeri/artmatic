import { clockParams } from '../shader-def';
import type { ParamDef } from '../types';

export const id = 'ring-warp';
export const nameKey = 'fx.ringWarp';
export const params: ParamDef[] = [
  { key: 'rings', labelKey: 'fx.ringWarp.rings', type: 'range', min: 0.1, max: 32, step: 0.1, defaultValue: 4, curve: 2 },
  { key: 'offset', labelKey: 'fx.ringWarp.offset', type: 'range', min: 0, max: 1, step: 0.01, defaultValue: 0 },
  ...clockParams({ labelKey: 'fx.ringWarp.speed', min: 0, max: 3, step: 0.05, defaultValue: 0.3 }),
  {
    key: 'mode',
    labelKey: 'fx.ringWarp.mode',
    type: 'select',
    defaultValue: 'single',
    options: [
      { labelKey: 'fx.ringWarp.modeSingle', value: 'single' },
      { labelKey: 'fx.ringWarp.modeDouble', value: 'double' },
    ],
  },
  { key: 'xSmear', labelKey: 'fx.ringWarp.xSmear', type: 'range', min: 0, max: 1, step: 0.01, defaultValue: 0 },
  { key: 'ySmear', labelKey: 'fx.ringWarp.ySmear', type: 'range', min: 0, max: 1, step: 0.01, defaultValue: 0 },
  { key: 'centerX', labelKey: 'fx.ringWarp.centerX', type: 'range', min: 0, max: 1, step: 0.01, defaultValue: 0.5 },
  { key: 'centerY', labelKey: 'fx.ringWarp.centerY', type: 'range', min: 0, max: 1, step: 0.01, defaultValue: 0.5 },
];

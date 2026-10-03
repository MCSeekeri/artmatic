import { clockParams } from '../shader-def';
import type { ParamDef } from '../types';

export const id = 'screen-jump';
export const nameKey = 'fx.screenJump';
export const params: ParamDef[] = [
  {
    key: 'direction',
    labelKey: 'fx.screenJump.direction',
    type: 'select',
    defaultValue: 'vertical',
    options: [
      { labelKey: 'fx.screenJump.dirVertical', value: 'vertical' },
      { labelKey: 'fx.screenJump.dirHorizontal', value: 'horizontal' },
    ],
  },
  { key: 'intensity', labelKey: 'fx.screenJump.intensity', type: 'range', min: 0, max: 1, step: 0.01, defaultValue: 0.5 },
  ...clockParams({ labelKey: 'fx.screenJump.speed', min: 0, max: 5, step: 0.05, defaultValue: 1 }),
];

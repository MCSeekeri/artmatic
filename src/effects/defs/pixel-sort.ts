import type { ParamDef } from '../types';

export const id = 'pixel-sort';
export const nameKey = 'fx.pixelSort';
export const params: ParamDef[] = [
  { key: 'threshold', labelKey: 'fx.pixelSort.threshold', type: 'range', min: 0, max: 1, step: 0.01, defaultValue: 0.5 },
  { key: 'ceiling', labelKey: 'fx.pixelSort.ceiling', type: 'range', min: 0, max: 1, step: 0.01, defaultValue: 1 },
  { key: 'range', labelKey: 'fx.pixelSort.range', type: 'range', min: 0, max: 200, step: 1, defaultValue: 80 },
  {
    key: 'direction',
    labelKey: 'fx.pixelSort.direction',
    type: 'select',
    defaultValue: 'horizontal',
    options: [
      { labelKey: 'fx.pixelSort.dirHorizontal', value: 'horizontal' },
      { labelKey: 'fx.pixelSort.dirVertical', value: 'vertical' },
    ],
  },
  { key: 'reverse', labelKey: 'fx.pixelSort.reverse', type: 'checkbox', defaultValue: 0 },
];

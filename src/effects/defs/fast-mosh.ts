import type { ParamDef } from '../types';

export const id = 'fast-mosh';
export const nameKey = 'fx.fastMosh';
export const params: ParamDef[] = [
  { key: 'hold', labelKey: 'fx.fastMosh.hold', type: 'checkbox', defaultValue: 0 },
  { key: 'rate', labelKey: 'fx.fastMosh.rate', type: 'range', min: 0.01, max: 1, step: 0.01, defaultValue: 0.95 },
  { key: 'block', labelKey: 'fx.fastMosh.block', type: 'range', min: 2, max: 64, step: 1, defaultValue: 16 },
  { key: 'sharpen', labelKey: 'fx.fastMosh.sharpen', type: 'range', min: 0, max: 10, step: 0.1, defaultValue: 1 },
  { key: 'blur', labelKey: 'fx.fastMosh.blur', type: 'range', min: 0, max: 2, step: 0.01, defaultValue: 0.25 },
  { key: 'posterize', labelKey: 'fx.fastMosh.posterize', type: 'range', min: 0, max: 1, step: 0.01, defaultValue: 0.25 },
  {
    key: 'mode',
    labelKey: 'fx.fastMosh.mode',
    type: 'select',
    defaultValue: 'relative',
    options: [
      { labelKey: 'fx.fastMosh.modeRelative', value: 'relative' },
      { labelKey: 'fx.fastMosh.modeAbsolute', value: 'absolute' },
      { labelKey: 'fx.fastMosh.modeDifference', value: 'difference' },
    ],
  },
];

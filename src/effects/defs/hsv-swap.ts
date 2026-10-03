import type { ParamDef } from '../types';

export const id = 'hsv-swap';
export const nameKey = 'fx.hsvSwap';
export const params: ParamDef[] = [
  {
    key: 'mode',
    labelKey: 'fx.hsvSwap.mode',
    type: 'select',
    defaultValue: 'rgb-as-hsv',
    options: [
      { labelKey: 'fx.hsvSwap.modeRgbAsHsv', value: 'rgb-as-hsv' },
      { labelKey: 'fx.hsvSwap.modeHsvAsRgb', value: 'hsv-as-rgb' },
    ],
  },
  { key: 'amount', labelKey: 'fx.hsvSwap.amount', type: 'range', min: 0, max: 1, step: 0.01, defaultValue: 1 },
];

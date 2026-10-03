import type { ParamDef } from '../types';

export const id = 'grain';
export const nameKey = 'fx.grain';
export const params: ParamDef[] = [
  { key: 'amount', labelKey: 'fx.grain.amount', type: 'range', min: 0, max: 1, step: 0.01, defaultValue: 0.3 },
  { key: 'rgb', labelKey: 'fx.grain.rgb', type: 'checkbox', defaultValue: 1 },
  {
    key: 'blendMode',
    labelKey: 'fx.grain.blendMode',
    type: 'select',
    defaultValue: 'additive',
    options: [
      { labelKey: 'fx.grain.modeAdditive', value: 'additive' },
      { labelKey: 'fx.grain.modeSoftlight', value: 'softlight' },
      { labelKey: 'fx.grain.modeMultiply', value: 'multiply' },
    ],
  },
];

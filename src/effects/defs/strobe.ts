import { clockParams } from '../shader-def';
import type { ParamDef } from '../types';

export const id = 'strobe';
export const nameKey = 'fx.strobe';
export const params: ParamDef[] = [
  ...clockParams({ labelKey: 'fx.strobe.rate', min: 0.2, max: 20, step: 0.1, defaultValue: 5 }),
  { key: 'duty', labelKey: 'fx.strobe.duty', type: 'range', min: 0.05, max: 0.95, step: 0.01, defaultValue: 0.5 },
  { key: 'amount', labelKey: 'fx.strobe.amount', type: 'range', min: 0, max: 1, step: 0.01, defaultValue: 1 },
  {
    key: 'mode',
    labelKey: 'fx.strobe.mode',
    type: 'select',
    defaultValue: 'black',
    options: [
      { labelKey: 'fx.strobe.modeBlack', value: 'black' },
      { labelKey: 'fx.strobe.modeWhite', value: 'white' },
      { labelKey: 'fx.strobe.modeInvert', value: 'invert' },
      { labelKey: 'fx.strobe.modeMono', value: 'mono' },
    ],
  },
];

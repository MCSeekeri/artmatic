import type { ParamDef } from '../types';

export const id = 'color-halves';
export const nameKey = 'fx.colorHalves';
export const params: ParamDef[] = [
  { key: 'position', labelKey: 'fx.colorHalves.position', type: 'range', min: 0, max: 1, step: 0.01, defaultValue: 0.5 },
  { key: 'angle', labelKey: 'fx.colorHalves.angle', type: 'range', min: 0, max: 360, step: 1, defaultValue: 0 },
  {
    key: 'mode',
    labelKey: 'fx.colorHalves.mode',
    type: 'select',
    defaultValue: 'invert',
    options: [
      { labelKey: 'fx.colorHalves.modeInvert', value: 'invert' },
      { labelKey: 'fx.colorHalves.modeHue', value: 'hue-shift' },
      { labelKey: 'fx.colorHalves.modeDesat', value: 'desaturate' },
      { labelKey: 'fx.colorHalves.modeContrast', value: 'high-contrast' },
    ],
  },
  { key: 'amount', labelKey: 'fx.colorHalves.amount', type: 'range', min: 0, max: 1, step: 0.01, defaultValue: 1 },
];

import type { ParamDef } from '../types';

export const id = 'halftone';
export const nameKey = 'fx.halftone';
export const params: ParamDef[] = [
  { key: 'scale', labelKey: 'fx.halftone.scale', type: 'range', min: 2, max: 40, step: 0.5, defaultValue: 8 },
  { key: 'angle', labelKey: 'fx.halftone.angle', type: 'range', min: 0, max: 90, step: 1, defaultValue: 15 },
  { key: 'contrast', labelKey: 'fx.halftone.contrast', type: 'range', min: 0.5, max: 2, step: 0.05, defaultValue: 1 },
  {
    key: 'mode',
    labelKey: 'fx.halftone.mode',
    type: 'select',
    defaultValue: 'dots',
    options: [
      { labelKey: 'fx.halftone.modeDots', value: 'dots' },
      { labelKey: 'fx.halftone.modeLines', value: 'lines' },
    ],
  },
  { key: 'invert', labelKey: 'fx.halftone.invert', type: 'checkbox', defaultValue: 0 },
];

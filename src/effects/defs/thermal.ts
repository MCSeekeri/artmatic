import type { ParamDef } from '../types';

export const id = 'thermal';
export const nameKey = 'fx.thermal';
export const params: ParamDef[] = [
  { key: 'intensity', labelKey: 'fx.thermal.intensity', type: 'range', min: 0, max: 1, step: 0.01, defaultValue: 1 },
  {
    key: 'palette',
    labelKey: 'fx.thermal.palette',
    type: 'select',
    defaultValue: 'thermal',
    options: [
      { labelKey: 'fx.thermal.paletteThermal', value: 'thermal' },
      { labelKey: 'fx.thermal.paletteInfrared', value: 'infrared' },
      { labelKey: 'fx.thermal.paletteNight', value: 'night-vision' },
    ],
  },
];

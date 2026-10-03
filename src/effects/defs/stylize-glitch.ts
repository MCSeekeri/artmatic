import { clockParams } from '../shader-def';
import type { ParamDef } from '../types';

export const id = 'stylize-glitch';
export const nameKey = 'fx.stylizeGlitch';
export const params: ParamDef[] = [
  { key: 'level', labelKey: 'fx.stylizeGlitch.level', type: 'range', min: 0, max: 1, step: 0.01, defaultValue: 0.5 },
  ...clockParams({ labelKey: 'fx.stylizeGlitch.rate', min: 1, max: 120, step: 1, defaultValue: 30 }),
  { key: 'count', labelKey: 'fx.stylizeGlitch.count', type: 'range', min: 1, max: 10, step: 1, defaultValue: 4 },
  {
    key: 'mode',
    labelKey: 'fx.stylizeGlitch.mode',
    type: 'select',
    defaultValue: 'random',
    options: [
      { labelKey: 'fx.stylizeGlitch.modeRandom', value: 'random' },
      { labelKey: 'fx.stylizeGlitch.modeInvert', value: 'invert' },
      { labelKey: 'fx.stylizeGlitch.modeDither', value: 'dither' },
      { labelKey: 'fx.stylizeGlitch.modeHue', value: 'hue' },
    ],
  },
];

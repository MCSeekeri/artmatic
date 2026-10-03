import type { ParamDef } from '../types';

export const id = 'stereoscopic';
export const nameKey = 'fx.stereoscopic';
export const params: ParamDef[] = [
  { key: 'depth', labelKey: 'fx.stereoscopic.depth', type: 'range', min: 0, max: 50, step: 1, defaultValue: 10 },
  { key: 'angle', labelKey: 'fx.stereoscopic.angle', type: 'range', min: 0, max: 360, step: 1, defaultValue: 0 },
  {
    key: 'mode',
    labelKey: 'fx.stereoscopic.mode',
    type: 'select',
    defaultValue: 'anaglyph',
    options: [
      { labelKey: 'fx.stereoscopic.modeAnaglyph', value: 'anaglyph' },
      { labelKey: 'fx.stereoscopic.modeSplit', value: 'color-split' },
    ],
  },
  {
    key: 'depthSource',
    labelKey: 'fx.stereoscopic.depthSource',
    type: 'select',
    defaultValue: 'luminance',
    options: [
      { labelKey: 'fx.stereoscopic.sourceLuma', value: 'luminance' },
      { labelKey: 'fx.stereoscopic.sourceEdges', value: 'edges' },
      { labelKey: 'fx.stereoscopic.sourceFlat', value: 'flat' },
    ],
  },
  { key: 'focus', labelKey: 'fx.stereoscopic.focus', type: 'range', min: 0, max: 1, step: 0.01, defaultValue: 0.5 },
];

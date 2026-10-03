import type { ParamDef } from '../types';

export const id = 'audio-bars';
export const nameKey = 'fx.audioBars';
export const params: ParamDef[] = [
  { key: 'bars', labelKey: 'fx.audioBars.bars', type: 'range', min: 8, max: 128, step: 1, defaultValue: 48 },
  { key: 'height', labelKey: 'fx.audioBars.height', type: 'range', min: 0, max: 1, step: 0.01, defaultValue: 0.4 },
  // 1.0 就够了：bin 到手时已经归一化过，再往上只是把峰值平削在条顶。
  { key: 'gain', labelKey: 'fx.audioBars.gain', type: 'range', min: 0.1, max: 3, step: 0.05, defaultValue: 1 },
  { key: 'smoothing', labelKey: 'fx.audioBars.smoothing', type: 'range', min: 0, max: 1, step: 0.01, defaultValue: 0.45 },
  { key: 'punch', labelKey: 'fx.audioBars.punch', type: 'range', min: 0, max: 1, step: 0.01, defaultValue: 0.4 },
  { key: 'opacity', labelKey: 'fx.audioBars.opacity', type: 'range', min: 0, max: 1, step: 0.01, defaultValue: 0.9 },
  {
    key: 'anchor',
    labelKey: 'fx.audioBars.anchor',
    type: 'select',
    defaultValue: 'bottom',
    options: [
      { labelKey: 'fx.audioBars.anchorBottom', value: 'bottom' },
      { labelKey: 'fx.audioBars.anchorTop', value: 'top' },
      { labelKey: 'fx.audioBars.anchorCenter', value: 'center' },
    ],
  },
  {
    key: 'style',
    labelKey: 'fx.audioBars.style',
    type: 'select',
    defaultValue: 'solid',
    options: [
      { labelKey: 'fx.audioBars.styleSolid', value: 'solid' },
      { labelKey: 'fx.audioBars.styleSegmented', value: 'segmented' },
    ],
  },
  { key: 'color', labelKey: 'fx.audioBars.color', type: 'color', defaultValue: '#4dffb8' },
];

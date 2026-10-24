import type { ParamDef } from '../types';

export const id = 'nested-shrink';
export const nameKey = 'fx.nestedShrink';
export const params: ParamDef[] = [
  {
    key: 'mode',
    labelKey: 'fx.nestedShrink.mode',
    type: 'select',
    defaultValue: 'ratio',
    options: [
      { labelKey: 'fx.nestedShrink.modeRatio', value: 'ratio' },
      { labelKey: 'fx.nestedShrink.modeInset', value: 'inset' },
    ],
  },
  // 两种步进的「一步有多长」量纲不同：等比是倍率，等距是帧高的比例。
  // 一个滑杆兼两种语义只会让默认值在某一种模式下是错的，所以各给一条。
  {
    key: 'scale',
    labelKey: 'fx.nestedShrink.scale',
    type: 'range',
    min: 0.1,
    max: 0.95,
    step: 0.01,
    defaultValue: 0.8,
    visibleWhen: (v) => v.mode !== 'inset',
  },
  {
    key: 'inset',
    labelKey: 'fx.nestedShrink.inset',
    type: 'range',
    min: 0.01,
    max: 0.3,
    step: 0.005,
    defaultValue: 0.06,
    visibleWhen: (v) => v.mode === 'inset',
  },
  { key: 'count', labelKey: 'fx.nestedShrink.count', type: 'range', min: 0, max: 12, step: 1, defaultValue: 1 },
  { key: 'decay', labelKey: 'fx.nestedShrink.decay', type: 'range', min: 0, max: 0.5, step: 0.01, defaultValue: 0 },
  { key: 'offsetX', labelKey: 'fx.nestedShrink.offsetX', type: 'range', min: -0.5, max: 0.5, step: 0.005, defaultValue: 0 },
  { key: 'offsetY', labelKey: 'fx.nestedShrink.offsetY', type: 'range', min: -0.5, max: 0.5, step: 0.005, defaultValue: 0 },
];

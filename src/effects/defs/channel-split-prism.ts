import type { ParamDef } from '../types';

export const id = 'channel-split-prism';
export const nameKey = 'fx.channelSplitPrism';
export const params: ParamDef[] = [
  {
    key: 'mode',
    labelKey: 'fx.channelSplitPrism.mode',
    type: 'select',
    // 这只是 openmosh 的**径向 + 棱镜**两个模式。`linear` 刻意不列 ——
    // 现有 `channel-split` 就是线性版，列出来会多一条神似条目。
    // 着色器里 linear 的分支仍然保留，作为未知 mode 的降级落点。
    defaultValue: 'radial',
    options: [
      { labelKey: 'fx.channelSplitPrism.modeRadial', value: 'radial' },
      { labelKey: 'fx.channelSplitPrism.modePrismatic', value: 'prismatic' },
    ],
  },
  { key: 'amount', labelKey: 'fx.channelSplitPrism.amount', type: 'range', min: 0, max: 50, step: 0.1, defaultValue: 10 },
  {
    key: 'angle',
    labelKey: 'fx.channelSplitPrism.angle',
    type: 'range',
    min: 0,
    max: 360,
    step: 1,
    defaultValue: 0,
    visibleWhen: (v) => v.mode === 'linear' || v.mode === 'prismatic',
  },
  {
    key: 'falloff',
    labelKey: 'fx.channelSplitPrism.falloff',
    type: 'range',
    min: 0,
    max: 1,
    step: 0.01,
    defaultValue: 0.5,
    visibleWhen: (v) => v.mode === 'radial',
  },
  {
    key: 'speed',
    labelKey: 'fx.channelSplitPrism.speed',
    type: 'range',
    min: 0,
    max: 5,
    step: 0.1,
    defaultValue: 1,
    visibleWhen: (v) => v.mode === 'prismatic',
  },
  {
    key: 'saturation',
    labelKey: 'fx.channelSplitPrism.hueShift',
    type: 'range',
    min: 0,
    max: 1,
    step: 0.01,
    defaultValue: 0.5,
    visibleWhen: (v) => v.mode === 'prismatic',
  },
];

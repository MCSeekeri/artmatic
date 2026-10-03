import type { ParamDef } from '../types';

export const id = 'feedback';
export const nameKey = 'fx.feedbackLoop';
export const params: ParamDef[] = [
  // 下限不是 0：没有衰减时循环永远不释放帧，画面会焊死在曾经最亮的那一帧上。
  { key: 'decay', labelKey: 'fx.feedbackLoop.decay', type: 'range', min: 0.02, max: 1, step: 0.01, defaultValue: 0.45 },
  { key: 'scale', labelKey: 'fx.feedbackLoop.scale', type: 'range', min: -1, max: 1, step: 0.01, defaultValue: 0.12 },
  { key: 'rotate', labelKey: 'fx.feedbackLoop.rotate', type: 'range', min: -90, max: 90, step: 1, defaultValue: 0 },
  { key: 'warp', labelKey: 'fx.feedbackLoop.warp', type: 'range', min: 0, max: 1, step: 0.01, defaultValue: 0 },
  { key: 'hue', labelKey: 'fx.feedbackLoop.hue', type: 'range', min: -180, max: 180, step: 1, defaultValue: 0 },
  {
    key: 'blend',
    labelKey: 'fx.feedbackLoop.blend',
    type: 'select',
    defaultValue: 'max',
    options: [
      { labelKey: 'fx.feedbackLoop.blendMax', value: 'max' },
      { labelKey: 'fx.feedbackLoop.blendScreen', value: 'screen' },
      { labelKey: 'fx.feedbackLoop.blendAdd', value: 'add' },
    ],
  },
];

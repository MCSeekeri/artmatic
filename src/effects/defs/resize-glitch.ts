import { clockParams } from '../shader-def';
import type { ParamDef } from '../types';

export const id = 'resize-glitch';
export const nameKey = 'fx.resizeGlitch';
export const params: ParamDef[] = [
  { key: 'chance', labelKey: 'fx.resizeGlitch.chance', type: 'range', min: 0, max: 1, step: 0.01, defaultValue: 0.3 },
  ...clockParams({ labelKey: 'fx.resizeGlitch.rate', min: 1, max: 60, step: 1, defaultValue: 20 }),
  { key: 'levelX', labelKey: 'fx.resizeGlitch.levelX', type: 'range', min: 0.01, max: 10, step: 0.01, defaultValue: 2 },
  { key: 'levelY', labelKey: 'fx.resizeGlitch.levelY', type: 'range', min: 0.01, max: 10, step: 0.01, defaultValue: 2 },
  { key: 'randomWidth', labelKey: 'fx.resizeGlitch.randomWidth', type: 'checkbox', defaultValue: 1 },
  { key: 'randomHeight', labelKey: 'fx.resizeGlitch.randomHeight', type: 'checkbox', defaultValue: 1 },
  { key: 'randomCenter', labelKey: 'fx.resizeGlitch.randomCenter', type: 'checkbox', defaultValue: 1 },
  {
    key: 'centerX',
    labelKey: 'fx.resizeGlitch.centerX',
    type: 'range',
    min: 0,
    max: 1,
    step: 0.01,
    defaultValue: 0.5,
    // 中心已经随机了，手动中心就没有意义。
    visibleWhen: (v) => !Number(v.randomCenter),
  },
  {
    key: 'centerY',
    labelKey: 'fx.resizeGlitch.centerY',
    type: 'range',
    min: 0,
    max: 1,
    step: 0.01,
    defaultValue: 0.5,
    visibleWhen: (v) => !Number(v.randomCenter),
  },
];

import type { ParamDef } from '../types';

export const id = 'lens-flare';
export const nameKey = 'fx.lensFlare';

/**
 * 九种样式。它们的区别只是**各分量的权重向量**（见 `glsl/lens-flare.ts` 的
 * `styleWeights`），不是九套独立的着色器 —— 组件共享，观感才不会各写一遍
 * 之后互相漂。顺序即 `u_style` 的序号。
 */

/**
 * 手动模式最多三个光源。
 *
 * 三个是**滑杆组**能承受的上限（每个光源两个 range），也够表达「主光 + 两个
 * 补光」。再往上就不该是一个特效片段的事。
 *
 * `x*` / `y*` 的 Y 轴是**从上往下**（0 = 顶端）：这三个参数唯一的用途是让人
 * 把光斑挪到画面里的某个位置，屏幕坐标读起来才顺。它与 `vUv.y` 差一个
 * `1.0 - `，在着色器里翻转，别在参数表里翻。
 */
export const params: ParamDef[] = [
  {
    key: 'mode',
    labelKey: 'fx.lensFlare.mode',
    type: 'select',
    defaultValue: 'auto',
    options: [
      { labelKey: 'fx.lensFlare.modeAuto', value: 'auto' },
      { labelKey: 'fx.lensFlare.modeManual', value: 'manual' },
    ],
  },
  {
    key: 'style',
    labelKey: 'fx.lensFlare.style',
    type: 'select',
    defaultValue: 'ghost',
    options: [
      { labelKey: 'fx.lensFlare.styleSoft', value: 'soft' },
      { labelKey: 'fx.lensFlare.styleStreak', value: 'streak' },
      { labelKey: 'fx.lensFlare.styleStar', value: 'star' },
      { labelKey: 'fx.lensFlare.styleRing', value: 'ring' },
      { labelKey: 'fx.lensFlare.styleGhost', value: 'ghost' },
      { labelKey: 'fx.lensFlare.styleHex', value: 'hex' },
      { labelKey: 'fx.lensFlare.styleSpectral', value: 'spectral' },
      { labelKey: 'fx.lensFlare.styleVeil', value: 'veil' },
      { labelKey: 'fx.lensFlare.styleBokeh', value: 'bokeh' },
    ],
  },
  { key: 'intensity', labelKey: 'fx.lensFlare.intensity', type: 'range', min: 0, max: 3, step: 0.01, defaultValue: 1 },
  { key: 'size', labelKey: 'fx.lensFlare.size', type: 'range', min: 0.1, max: 2, step: 0.01, defaultValue: 0.75 },
  {
    key: 'threshold',
    labelKey: 'fx.lensFlare.threshold',
    type: 'range',
    min: 0,
    max: 1,
    step: 0.01,
    defaultValue: 0.5,
    // 手动模式不检测亮部，这个滑杆没有作用对象。
    visibleWhen: (v) => v.mode !== 'manual',
  },
  { key: 'ghosts', labelKey: 'fx.lensFlare.ghosts', type: 'range', min: 0, max: 8, step: 1, defaultValue: 5 },
  { key: 'spread', labelKey: 'fx.lensFlare.spread', type: 'range', min: 0.2, max: 2, step: 0.01, defaultValue: 1 },
  { key: 'rainbow', labelKey: 'fx.lensFlare.rainbow', type: 'range', min: 0, max: 1, step: 0.01, defaultValue: 0.35 },
  { key: 'spin', labelKey: 'fx.lensFlare.spin', type: 'range', min: -2, max: 2, step: 0.01, defaultValue: 0 },
  { key: 'tint', labelKey: 'fx.lensFlare.tint', type: 'color', defaultValue: '#fff1d6' },
  {
    key: 'points',
    labelKey: 'fx.lensFlare.points',
    type: 'range',
    min: 1,
    max: 3,
    step: 1,
    defaultValue: 2,
    visibleWhen: (v) => v.mode === 'manual',
  },
  { key: 'x1', labelKey: 'fx.lensFlare.x1', type: 'range', min: 0, max: 1, step: 0.005, defaultValue: 0.28, visibleWhen: (v) => v.mode === 'manual' },
  { key: 'y1', labelKey: 'fx.lensFlare.y1', type: 'range', min: 0, max: 1, step: 0.005, defaultValue: 0.3, visibleWhen: (v) => v.mode === 'manual' },
  {
    key: 'x2',
    labelKey: 'fx.lensFlare.x2',
    type: 'range',
    min: 0,
    max: 1,
    step: 0.005,
    defaultValue: 0.74,
    visibleWhen: (v) => v.mode === 'manual' && Number(v.points) >= 2,
  },
  {
    key: 'y2',
    labelKey: 'fx.lensFlare.y2',
    type: 'range',
    min: 0,
    max: 1,
    step: 0.005,
    defaultValue: 0.66,
    visibleWhen: (v) => v.mode === 'manual' && Number(v.points) >= 2,
  },
  {
    key: 'x3',
    labelKey: 'fx.lensFlare.x3',
    type: 'range',
    min: 0,
    max: 1,
    step: 0.005,
    defaultValue: 0.5,
    visibleWhen: (v) => v.mode === 'manual' && Number(v.points) >= 3,
  },
  {
    key: 'y3',
    labelKey: 'fx.lensFlare.y3',
    type: 'range',
    min: 0,
    max: 1,
    step: 0.005,
    defaultValue: 0.46,
    visibleWhen: (v) => v.mode === 'manual' && Number(v.points) >= 3,
  },
];

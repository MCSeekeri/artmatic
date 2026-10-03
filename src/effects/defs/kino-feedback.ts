import type { ParamDef } from '../types';

export const id = 'kino-feedback';
export const nameKey = 'fx.kinoFeedback';
export const params: ParamDef[] = [
  { key: 'rotation', labelKey: 'fx.kinoFeedback.rotation', type: 'range', min: -180, max: 180, step: 1, defaultValue: 15 },
  { key: 'scale', labelKey: 'fx.kinoFeedback.scale', type: 'range', min: 0.9, max: 1.1, step: 0.001, defaultValue: 1.01 },
  // ISF 的 point2D 在 Artmatic 里没有对应类型 → 拆成两个 range（与 ring-warp 的中心点同一做法）。
  { key: 'offsetX', labelKey: 'fx.kinoFeedback.offsetX', type: 'range', min: -0.1, max: 0.1, step: 0.001, defaultValue: 0 },
  { key: 'offsetY', labelKey: 'fx.kinoFeedback.offsetY', type: 'range', min: -0.1, max: 0.1, step: 0.001, defaultValue: 0 },
  { key: 'hue', labelKey: 'fx.kinoFeedback.hue', type: 'range', min: 0, max: 1, step: 0.001, defaultValue: 0.02 },
  { key: 'tint', labelKey: 'fx.kinoFeedback.tint', type: 'color', defaultValue: '#ffffff' },
  { key: 'amount', labelKey: 'fx.kinoFeedback.amount', type: 'range', min: 0, max: 0.95, step: 0.01, defaultValue: 0.35 },
];

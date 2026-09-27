import type { ParamDef } from '../types';

export const id = 'echo';
export const name = '回声拖尾';
export const params: ParamDef[] = [
  { key: 'decay', label: '衰减', type: 'range', min: 0, max: 0.98, step: 0.01, defaultValue: 0.82 },
  { key: 'floor', label: '基底扣除', type: 'range', min: 0, max: 0.2, step: 0.005, defaultValue: 0.04 },
  { key: 'weight', label: '拖尾权重', type: 'range', min: 0, max: 1, step: 0.01, defaultValue: 0.9 },
  { key: 'zoom', label: '每帧缩放', type: 'range', min: -0.05, max: 0.05, step: 0.001, defaultValue: 0.01 },
  { key: 'spin', label: '每帧旋转', type: 'range', min: -0.05, max: 0.05, step: 0.001, defaultValue: 0 },
];

import type { ParamDef } from '../types';

export const id = 'slices';
export const name = '切片错位';
export const params: ParamDef[] = [
  { key: 'count', label: '切片数', type: 'range', min: 4, max: 120, step: 1, defaultValue: 36 },
  { key: 'amount', label: '幅度', type: 'range', min: 0, max: 0.3, step: 0.005, defaultValue: 0.08 },
  { key: 'coverage', label: '覆盖率', type: 'range', min: 0, max: 1, step: 0.01, defaultValue: 0.5 },
];

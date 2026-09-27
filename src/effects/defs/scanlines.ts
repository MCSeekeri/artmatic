import type { ParamDef } from '../types';

export const id = 'scanlines';
export const name = '扫描线';
export const params: ParamDef[] = [
  { key: 'intensity', label: '强度', type: 'range', min: 0, max: 1, step: 0.01, defaultValue: 0.25 },
  { key: 'spacing', label: '间距(px)', type: 'range', min: 1, max: 8, step: 1, defaultValue: 3 },
];

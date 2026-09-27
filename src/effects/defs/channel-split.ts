import type { ParamDef } from '../types';

export const id = 'channel-split';
export const name = '通道错位';
export const params: ParamDef[] = [
  { key: 'amount', label: '错位量(px)', type: 'range', min: 0, max: 40, step: 0.5, defaultValue: 6 },
  { key: 'angle', label: '角度', type: 'range', min: 0, max: 6.2832, step: 0.01, defaultValue: 0 },
];

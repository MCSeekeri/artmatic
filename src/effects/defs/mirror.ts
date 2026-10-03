import type { ParamDef } from '../types';

export const id = 'mirror';
export const nameKey = 'fx.mirror';
export const params: ParamDef[] = [
  { key: 'amount', labelKey: 'fx.mirror.amount', type: 'range', min: 0, max: 1, step: 0.01, defaultValue: 1 },
  { key: 'side', labelKey: 'fx.mirror.side', type: 'range', min: 0, max: 3, step: 1, defaultValue: 0 },
  { key: 'position', labelKey: 'fx.mirror.position', type: 'range', min: 0, max: 1, step: 0.01, defaultValue: 0.5 },
];

import type { ParamDef } from '../types';

export const id = 'channel-split';
export const nameKey = 'fx.channelSplit';
export const params: ParamDef[] = [
  { key: 'amount', labelKey: 'fx.channelSplit.amount', type: 'range', min: 0, max: 40, step: 0.5, defaultValue: 6 },
  { key: 'angle', labelKey: 'fx.channelSplit.angle', type: 'range', min: 0, max: 6.2832, step: 0.01, defaultValue: 0 },
];

import type { ParamDef } from '../types';

export const id = 'pixel-shifter';
export const nameKey = 'fx.pixelShifter';
export const params: ParamDef[] = [
  { key: 'hFrequency', labelKey: 'fx.pixelShifter.hFrequency', type: 'range', min: -16, max: 16, step: 0.1, defaultValue: 1 },
  { key: 'hPhase', labelKey: 'fx.pixelShifter.hPhase', type: 'range', min: 0, max: 1, step: 0.01, defaultValue: 0 },
  { key: 'hRandom', labelKey: 'fx.pixelShifter.hRandom', type: 'range', min: 0, max: 1, step: 0.01, defaultValue: 0 },
  { key: 'vFrequency', labelKey: 'fx.pixelShifter.vFrequency', type: 'range', min: -16, max: 16, step: 0.1, defaultValue: 0 },
  { key: 'vPhase', labelKey: 'fx.pixelShifter.vPhase', type: 'range', min: 0, max: 1, step: 0.01, defaultValue: 0 },
  { key: 'vRandom', labelKey: 'fx.pixelShifter.vRandom', type: 'range', min: 0, max: 1, step: 0.01, defaultValue: 0 },
  { key: 'sinusoidal', labelKey: 'fx.pixelShifter.sinusoidal', type: 'checkbox', defaultValue: 1 },
  { key: 'mirror', labelKey: 'fx.pixelShifter.mirror', type: 'checkbox', defaultValue: 1 },
];

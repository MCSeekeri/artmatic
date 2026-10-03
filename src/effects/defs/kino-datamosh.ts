import type { ParamDef } from '../types';

export const id = 'kino-datamosh';
export const nameKey = 'fx.kinoDatamosh';
export const params: ParamDef[] = [
  { key: 'blockSize', labelKey: 'fx.kinoDatamosh.blockSize', type: 'range', min: 0.5, max: 16, step: 0.5, defaultValue: 4 },
  { key: 'quality', labelKey: 'fx.kinoDatamosh.quality', type: 'range', min: 0, max: 1, step: 0.01, defaultValue: 0.5 },
  { key: 'contrast', labelKey: 'fx.kinoDatamosh.contrast', type: 'range', min: 0.1, max: 4, step: 0.05, defaultValue: 1 },
  { key: 'velocity', labelKey: 'fx.kinoDatamosh.velocity', type: 'range', min: 0, max: 4, step: 0.05, defaultValue: 1 },
  { key: 'diffusion', labelKey: 'fx.kinoDatamosh.diffusion', type: 'range', min: 0, max: 8, step: 0.1, defaultValue: 1 },
];

import type { ParamDef } from '../types';

export const id = 'composite';
export const nameKey = 'fx.composite';
export const params: ParamDef[] = [
  { key: 'bleed', labelKey: 'fx.composite.bleed', type: 'range', min: 0, max: 32, step: 0.5, defaultValue: 11 },
  { key: 'crawl', labelKey: 'fx.composite.crawl', type: 'range', min: 0, max: 1, step: 0.01, defaultValue: 0.45 },
  { key: 'crush', labelKey: 'fx.composite.crush', type: 'range', min: 0, max: 0.6, step: 0.01, defaultValue: 0.2 },
  { key: 'mix', labelKey: 'fx.composite.mix', type: 'range', min: 0, max: 1, step: 0.01, defaultValue: 1 },
];

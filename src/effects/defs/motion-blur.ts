import type { ParamDef } from '../types';

export const id = 'motion-blur';
export const nameKey = 'fx.motionBlur';
export const params: ParamDef[] = [
  // 单位是帧：0 等于不糊（原样通过），32 差不多是 1 秒的拖影
  { key: 'length', labelKey: 'fx.motionBlur.length', type: 'range', min: 0, max: 32, step: 1, defaultValue: 8 },
];

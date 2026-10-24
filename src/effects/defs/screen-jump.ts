import { clockParams } from '../shader-def';
import type { ParamDef } from '../types';

export const id = 'screen-jump';
export const nameKey = 'fx.screenJump';
export const params: ParamDef[] = [
  {
    key: 'direction',
    labelKey: 'fx.screenJump.direction',
    type: 'select',
    defaultValue: 'vertical',
    options: [
      { labelKey: 'fx.screenJump.dirVertical', value: 'vertical' },
      { labelKey: 'fx.screenJump.dirHorizontal', value: 'horizontal' },
    ],
  },
  { key: 'intensity', labelKey: 'fx.screenJump.intensity', type: 'range', min: 0, max: 1, step: 0.01, defaultValue: 0.5 },
  /*
   * 抽动（默认 0 = 关，老工程的观感一个字都不变）。
   *
   * 上限 0.5 就够：位移是在 `fract` 里回绕的，±半幅已经覆盖画面的所有位置，
   * 再往上只是同一个位移换个说法。`curve` 让 0..0.1 那段（「卡一格」的手感）
   * 占掉更多滑杆行程。
   */
  {
    key: 'jerk',
    labelKey: 'fx.screenJump.jerk',
    type: 'range',
    min: 0,
    max: 0.5,
    step: 0.005,
    defaultValue: 0,
    curve: 2,
  },
  {
    key: 'jerkRate',
    labelKey: 'fx.screenJump.jerkRate',
    type: 'range',
    min: 0.5,
    max: 30,
    step: 0.1,
    defaultValue: 6,
    visibleWhen: (v) => Number(v.jerk) > 0,
  },
  ...clockParams({ labelKey: 'fx.screenJump.speed', min: 0, max: 5, step: 0.05, defaultValue: 1 }),
];

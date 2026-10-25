/**
 * animation-presets/index.ts — 三组预设的汇总（**顺序即图库顺序**）。
 *
 * 图的顺序 = 进入 → 强调 → 退出：与 PPT 一致，也是 `ANIM_PRESET_IDS`
 * （id 联合类型的唯一真源）与 Ribbon 那条常驻条的排列顺序。
 */

import { ENTER_PRESETS } from './enter';
import { EMPHASIS_PRESETS } from './emphasis';
import { EXIT_PRESETS } from './exit';
import type { PresetModule } from './types';

/** 三个模块，顺序即渲染顺序。加第四组时同时补 `ANIM_GROUPS`（ui/typography）。 */
export const PRESET_MODULES: readonly PresetModule[] = [ENTER_PRESETS, EMPHASIS_PRESETS, EXIT_PRESETS];

export type { KeyframeBuilder, PresetDef, PresetModule } from './types';

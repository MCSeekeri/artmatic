import { describe, it } from 'vitest';
import { ANIM_PRESET_IDS } from '../../src/typography/animation';
import { animGroupOf } from '../../src/ui/typography/anim-catalog';
import { checkPresets } from './_anim-preset-check';

/**
 * **退出**组预设的守卫（id 从分组表推，不另抄一份）。
 * `pnpm vitest run tests/unit/anim-presets-exit.test.ts`
 */
const IDS = ANIM_PRESET_IDS.filter((id) => animGroupOf(id) === 'exit');

describe('退出动画：每条都能展开成轨道、都有图标与文案', () => {
  it('全部通过', () => {
    checkPresets(IDS, 'exit');
  });
});

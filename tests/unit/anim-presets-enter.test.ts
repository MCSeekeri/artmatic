import { describe, it } from 'vitest';
import { ANIM_PRESET_IDS } from '../../src/typography/animation';
import { animGroupOf } from '../../src/ui/typography/anim-catalog';
import { checkPresets } from './_anim-preset-check';

/**
 * **进入**组预设的守卫（id 从分组表推，不另抄一份）。
 *
 * 单独一个文件是为了加预设时能只跑自己那一组：
 * `pnpm exec vitest run tests/unit/anim-presets-enter.test.ts`。
 */
const IDS = ANIM_PRESET_IDS.filter((id) => animGroupOf(id) === 'enter');

describe('进入动画：每条都能展开成轨道、都有图标与文案', () => {
  it('全部通过', () => {
    checkPresets(IDS, 'enter');
  });
});

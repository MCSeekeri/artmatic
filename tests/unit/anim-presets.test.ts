import { describe, expect, it } from 'vitest';
import { ANIM_PRESET_IDS, ANIM_PRESETS } from '../../src/typography/animation';
import { ANIM_PRESET_GROUP, animGroupOf } from '../../src/ui/typography/anim-catalog';

/**
 * 动画预设**目录层**的守卫：id 清单、定义表、分组表三者必须一一对应。
 *
 * 三张表分散在三个地方（`animation.ts` 的 id 清单、`animation-presets/*` 的定义、
 * `ui/typography/anim-catalog.ts` 的分组），而它们之间的错位**全部是静默的**：
 *  - id 清单里有、定义表里没有 → 常驻条里根本没有这张卡（用户找不到功能）；
 *  - 定义表里有、id 清单里没有 → 这个预设永远进不了图库（但 agent 能力表里有）；
 *  - 分组表漏一条 → `animGroupOf` 回落到「进入」，图库把它排在错误的组。
 *
 * 每组的具体质量（能否展开成轨道、图标几何）由三份分组测试守住。
 */

describe('动画预设：三张表一一对应', () => {
  it('id 清单与定义表完全一致，且顺序相同（顺序 = 图库顺序）', () => {
    const fromIds = [...ANIM_PRESET_IDS];
    const fromDefs = ANIM_PRESETS.map((p) => p.id);
    expect(fromDefs).toEqual(fromIds);
  });

  it('id 没有重复', () => {
    expect(new Set(ANIM_PRESET_IDS).size).toBe(ANIM_PRESET_IDS.length);
  });

  it('每个 id 都有分组，且分组表里没有孤儿', () => {
    const known = new Set<string>(ANIM_PRESET_IDS);
    expect(ANIM_PRESET_IDS.filter((id) => !ANIM_PRESET_GROUP[id])).toEqual([]);
    expect(Object.keys(ANIM_PRESET_GROUP).filter((id) => !known.has(id))).toEqual([]);
  });

  /*
   * 数量下限：分批扩充之后的总量必须**只增不减**（用户要求「入场/出场/强调
   * 各加至少 12/12/18 条」）。上限不设 —— 再加预设不该改这条测试。
   */
  it('三组都达到了约定规模', () => {
    const byGroup = (g: string): number => ANIM_PRESET_IDS.filter((id) => animGroupOf(id) === g).length;
    expect(byGroup('enter'), '进入动画').toBeGreaterThanOrEqual(21);
    expect(byGroup('emphasis'), '强调动画').toBeGreaterThanOrEqual(22);
    expect(byGroup('exit'), '退出动画').toBeGreaterThanOrEqual(13);
  });

  it('常驻条的顺序是「进入 → 强调 → 退出」连续分块（不能交叉）', () => {
    // 条是按 ANIM_PRESETS 顺序平铺的：分组一旦交叉，条里就会出现「进入、强调、进入」。
    const seq = ANIM_PRESET_IDS.map((id) => animGroupOf(id));
    const collapsed = seq.filter((g, i) => i === 0 || g !== seq[i - 1]);
    expect(collapsed).toEqual(['enter', 'emphasis', 'exit']);
  });
});

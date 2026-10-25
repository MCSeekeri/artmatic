import { describe, expect, it } from 'vitest';
import { ANIM_PRESETS } from '../../src/typography/animation';
import {
  ANIM_GROUPS,
  ANIM_PRESET_GROUP,
  ANIM_PRESET_ICONS,
  animGroupOf,
  animIconOf,
  type AnimIconPrim,
} from '../../src/ui/typography/anim-catalog';
import { LOCALES } from '../../src/i18n/locales';

/**
 * 动画预设**展示信息**（分组 + 图标）的守卫。
 *
 * 目录表与模型表是两张表：新增预设只改 `typography/animation.ts` 也能编译通过，
 * 但它会在图库里变成一张没有图的空卡片（没有任何报错）。这条测试把它变成
 * 一声明确的失败。
 */

const PRESETS = ANIM_PRESETS.map((p) => p.id);

/** 图元的包围盒（只用于「不许画到框外」）。 */
function bbox(p: AnimIconPrim): { x0: number; y0: number; x1: number; y1: number } {
  if (p.k === 'sq') return { x0: p.x, y0: p.y, x1: p.x + p.w, y1: p.y + p.h };
  // path 的 `d` 里只有数字与命令字母；取所有数字两两配对估个包围盒足够。
  const nums = p.d.match(/-?\d+(\.\d+)?/g)?.map(Number) ?? [];
  const xs: number[] = [];
  const ys: number[] = [];
  nums.forEach((v, i) => (i % 2 === 0 ? xs : ys).push(v));
  return {
    x0: Math.min(...xs),
    y0: Math.min(...ys),
    x1: Math.max(...xs),
    y1: Math.max(...ys),
  } as { x0: number; y0: number; x1: number; y1: number };
}

describe('动画预设目录：覆盖完整', () => {
  it('每个预设都有图标与分组', () => {
    const missing = PRESETS.filter((id) => animIconOf(id).length === 0);
    expect(missing, '这些预设在图库里没有图标 → 卡片只剩一行字').toEqual([]);
    const noGroup = PRESETS.filter((id) => !ANIM_PRESET_GROUP[id]);
    expect(noGroup, '这些预设没有归组 → 图库里不会出现它们').toEqual([]);
  });

  it('目录里没有孤儿（每条都对应真实预设）', () => {
    const known = new Set<string>(PRESETS);
    expect(Object.keys(ANIM_PRESET_ICONS).filter((id) => !known.has(id))).toEqual([]);
    expect(Object.keys(ANIM_PRESET_GROUP).filter((id) => !known.has(id))).toEqual([]);
  });

  it('分组 id 合法，且每组都有内容', () => {
    const ids = new Set(ANIM_GROUPS.map((g) => g.id));
    for (const [preset, g] of Object.entries(ANIM_PRESET_GROUP)) {
      expect(ids, `${preset} 的分组非法`).toContain(g);
    }
    const used = new Set(Object.values(ANIM_PRESET_GROUP));
    for (const g of ids) expect(used, `分组 ${g} 是空的（图库会留一个空标题）`).toContain(g);
  });

  it('分组标题有文案', () => {
    const locale = LOCALES['zh-CN'] as Record<string, string>;
    for (const g of ANIM_GROUPS) {
      expect(locale[g.labelKey], `缺文案 ${g.labelKey}`).toBeTruthy();
    }
  });

  it('未知 id 有确定的回落（不抛错、不空白）', () => {
    expect(animIconOf('not-a-preset')).toEqual([]);
    expect(animGroupOf('not-a-preset')).toBe('enter');
  });
});

describe('动画预设图标：几何自洽', () => {
  it('所有图元都落在 32×32 的框内（画出去会被裁掉）', () => {
    const bad: string[] = [];
    for (const [id, prims] of Object.entries(ANIM_PRESET_ICONS)) {
      for (const p of prims) {
        const b = bbox(p);
        if (b.x0 < -0.5 || b.y0 < -0.5 || b.x1 > 32.5 || b.y1 > 32.5) {
          bad.push(`${id}: ${b.x0},${b.y0} → ${b.x1},${b.y1}`);
        }
      }
    }
    expect(bad).toEqual([]);
  });

  it('每个图标都有可见图元，且不透明度在 0..1', () => {
    for (const [id, prims] of Object.entries(ANIM_PRESET_ICONS)) {
      expect(prims.length, `${id} 没有图元`).toBeGreaterThan(0);
      for (const p of prims) {
        expect(p.o ?? 1, `${id} 的图元不透明度越界`).toBeGreaterThan(0);
        expect(p.o ?? 1, `${id} 的图元不透明度越界`).toBeLessThanOrEqual(1);
      }
    }
  });

  it('每个图标都有一个看得见的实心示意图形（圆角方形，而不是五角星）', () => {
    for (const [id, prims] of Object.entries(ANIM_PRESET_ICONS)) {
      // 门槛 0.3：淡出那一张的「起始态」刻意是半透明的，但必须还看得见。
      const solid = prims.filter((p) => p.k === 'sq' && !p.dashed && (p.o ?? 1) >= 0.3);
      expect(solid.length, `${id} 缺少实心示意图形`).toBeGreaterThan(0);
    }
  });
});

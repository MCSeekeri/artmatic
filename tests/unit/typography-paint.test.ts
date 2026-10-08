import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PAINT_A,
  DEFAULT_PAINT_B,
  applyPaintPatch,
  type Paint,
} from '../../src/typography/document';
import { sortedStops } from '../../src/typography/render-dom';
import { fillAttr, paintDefId, paintNeedsDefs } from '../../src/typography/css';

describe('applyPaintPatch', () => {
  const solid: Paint = { kind: 'solid', color: '#123456' };

  it('换类型时把已有颜色带过去（不要变回默认紫）', () => {
    const next = applyPaintPatch(solid, { kind: 'linear' });
    expect(next).toEqual({
      kind: 'linear',
      angle: 0,
      stops: [
        { offset: 0, color: '#123456' },
        { offset: 1, color: DEFAULT_PAINT_B },
      ],
    });
  });

  it('只改一个字段时其余字段原样保留', () => {
    const base = applyPaintPatch(solid, { kind: 'linear', angle: 45 });
    const next = applyPaintPatch(base, { color2: '#abcdef' });
    // 角度**不能**因为「改了个颜色」就被重置 —— 这正是 patch 式 API 的意义。
    expect(next.kind === 'linear' && next.angle).toBe(45);
    expect(next.kind === 'linear' && next.stops[1]!.color).toBe('#abcdef');
  });

  it('纹理的默认参数与已有值都自洽', () => {
    const t = applyPaintPatch(solid, { kind: 'texture' });
    expect(t.kind).toBe('texture');
    if (t.kind !== 'texture') throw new Error('unreachable');
    expect(t.pattern).toBe('dots');
    expect(t.scale).toBeGreaterThan(0);
    expect(t.thickness).toBeGreaterThan(0);
    // 改周期不能把图案名冲掉
    const t2 = applyPaintPatch(t, { scale: 60 });
    expect(t2.kind === 'texture' && t2.pattern).toBe('dots');
    expect(t2.kind === 'texture' && t2.scale).toBe(60);
  });

  it('切到 none 丢掉一切，切回来不用记住旧值（模型允许）', () => {
    expect(applyPaintPatch({ kind: 'linear', angle: 30, stops: [] }, { kind: 'none' })).toEqual({
      kind: 'none',
    });
  });

  it('纯色往返不会丢颜色', () => {
    const g = applyPaintPatch(solid, { kind: 'radial' });
    const back = applyPaintPatch(g, { kind: 'solid' });
    expect(back).toEqual({ kind: 'solid', color: '#123456' });
  });

  it('没有可用颜色时落到默认值而不是空串', () => {
    const back = applyPaintPatch({ kind: 'none' }, { kind: 'solid' });
    expect(back).toEqual({ kind: 'solid', color: DEFAULT_PAINT_A });
  });
});

describe('sortedStops', () => {
  it('按 offset 排序', () => {
    expect(sortedStops([{ offset: 1, color: 'b' }, { offset: 0, color: 'a' }])).toEqual([
      { offset: 0, color: 'a' },
      { offset: 1, color: 'b' },
    ]);
  });

  it('越界的 offset 被钳到 0..1', () => {
    const out = sortedStops([{ offset: -3, color: 'a' }, { offset: 9, color: 'b' }]);
    expect(out.map((s) => s.offset)).toEqual([0, 1]);
  });

  it('只有一个色标时补成两段（单色标的渐变是无效的）', () => {
    const out = sortedStops([{ offset: 0.5, color: '#fff' }]);
    expect(out.length).toBe(2);
    expect(out.every((s) => s.color === '#fff')).toBe(true);
  });

  it('空数组给出可用的黑白色带', () => {
    expect(sortedStops([]).length).toBe(2);
  });
});

describe('paint → SVG', () => {
  it('纯色 / 无填充不需要 defs，渐变与纹理需要', () => {
    expect(paintNeedsDefs({ kind: 'solid', color: '#000' })).toBe(false);
    expect(paintNeedsDefs({ kind: 'none' })).toBe(false);
    expect(paintNeedsDefs({ kind: 'linear', angle: 0, stops: [] })).toBe(true);
    expect(paintNeedsDefs({ kind: 'radial', stops: [] })).toBe(true);
    expect(
      paintNeedsDefs({ kind: 'texture', pattern: 'dots', color: '#fff', bg: '#000', scale: 10, thickness: 2 }),
    ).toBe(true);
  });

  it('defs id 由元素 id 派生 —— 同一元素每帧都得到同一个 id', () => {
    expect(paintDefId('abc')).toBe(paintDefId('abc'));
    expect(paintDefId('abc')).not.toBe(paintDefId('abd'));
  });

  it('fill 属性：纯色直接用颜色，渐变/纹理走 url(#…)', () => {
    expect(fillAttr({ kind: 'solid', color: '#abcdef' }, 'e1')).toBe('#abcdef');
    expect(fillAttr({ kind: 'linear', angle: 0, stops: [] }, 'e1')).toBe(`url(#${paintDefId('e1')})`);
    expect(fillAttr({ kind: 'none' }, 'e1')).toBe('transparent');
  });
});

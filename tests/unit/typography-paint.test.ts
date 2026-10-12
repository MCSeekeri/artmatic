import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PAINT_A,
  DEFAULT_PAINT_B,
  applyPaintPatch,
  normalizeStops,
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

  it('不透明度：补丁给了就设上，钳在 0..1', () => {
    expect(applyPaintPatch(solid, { opacity: 0.5 })).toEqual({ kind: 'solid', color: '#123456', opacity: 0.5 });
    expect(applyPaintPatch(solid, { opacity: 2 })).toEqual({ kind: 'solid', color: '#123456', opacity: 1 });
    expect(applyPaintPatch(solid, { opacity: -1 })).toEqual({ kind: 'solid', color: '#123456', opacity: 0 });
  });

  it('不透明度：换类型也带过去（与颜色同理），改别的不动它', () => {
    const faded = applyPaintPatch(solid, { opacity: 0.3 });
    const lin = applyPaintPatch(faded, { kind: 'linear' });
    expect(lin.kind === 'linear' && lin.opacity).toBe(0.3);
    // 只改一个无关字段（角度），不透明度原样保留
    const turned = applyPaintPatch(lin, { angle: 90 });
    expect(turned.kind === 'linear' && turned.opacity).toBe(0.3);
    expect(turned.kind === 'linear' && turned.angle).toBe(90);
  });

  it('不透明度：没设过就不写这个键（缺省即 1，不污染序列化）', () => {
    expect(applyPaintPatch(solid, { color: '#000000' })).toEqual({ kind: 'solid', color: '#000000' });
  });

  it('不透明度：切到 none 直接丢掉该项', () => {
    const faded = applyPaintPatch(solid, { opacity: 0.4 });
    expect(applyPaintPatch(faded, { kind: 'none' })).toEqual({ kind: 'none' });
  });
});

describe('多色标与停靠位置', () => {
  const grad: Paint = {
    kind: 'linear',
    angle: 45,
    stops: [
      { offset: 0, color: '#111111' },
      { offset: 0.5, color: '#222222' },
      { offset: 1, color: '#333333' },
    ],
  };

  it('补丁没带 stops 时保留整份色标 —— 多色标与位置不被两个颜色控件抹掉', () => {
    const next = applyPaintPatch(grad, { color: '#aaaaaa' });
    if (next.kind !== 'linear') throw new Error('unreachable');
    expect(next.stops).toHaveLength(3);
    expect(next.stops[0]!.color).toBe('#aaaaaa');
    expect(next.stops[1]).toEqual({ offset: 0.5, color: '#222222' });
    expect(next.stops[2]!.color).toBe('#333333');
  });

  it('color2 改的是**末位**色标（按 offset 定位，不是数组下标）', () => {
    const shuffled: Paint = {
      kind: 'linear',
      angle: 0,
      stops: [
        { offset: 0.5, color: '#222222' },
        { offset: 0, color: '#111111' },
        { offset: 1, color: '#333333' },
      ],
    };
    const next = applyPaintPatch(shuffled, { color2: '#bbbbbb' });
    if (next.kind !== 'linear') throw new Error('unreachable');
    // 数组第 3 项就是 offset=1 的那个（它才是「结束色」）
    expect(next.stops[2]!.color).toBe('#bbbbbb');
    expect(next.stops[0]!.color).toBe('#222222');
  });

  it('patch.stops 整份替换：只钳制 offset，**不重排**（列表顺序 = 用户编辑顺序）', () => {
    const next = applyPaintPatch(grad, {
      stops: [
        { offset: 2, color: '#ff0000' },
        { offset: -1, color: '#00ff00' },
      ],
    });
    if (next.kind !== 'linear') throw new Error('unreachable');
    expect(next.stops).toEqual([
      { offset: 1, color: '#ff0000' },
      { offset: 0, color: '#00ff00' },
    ]);
    // 改色标不该顺手把角度重置
    expect(next.angle).toBe(45);
  });

  it('linear → radial 也保住多色标', () => {
    const next = applyPaintPatch(grad, { kind: 'radial' });
    if (next.kind !== 'radial') throw new Error('unreachable');
    expect(next.stops.map((s) => s.color)).toEqual(['#111111', '#222222', '#333333']);
  });

  it('从非渐变切到渐变仍造两色标（首次进入渐变的默认路径没变）', () => {
    const next = applyPaintPatch({ kind: 'solid', color: '#123456' }, { kind: 'linear' });
    if (next.kind !== 'linear') throw new Error('unreachable');
    expect(next.stops).toEqual([
      { offset: 0, color: '#123456' },
      { offset: 1, color: DEFAULT_PAINT_B },
    ]);
  });

  it('normalizeStops：钳制 0..1 并按 offset 排序（渲染顺序）', () => {
    expect(
      normalizeStops([
        { offset: 0.8, color: 'b' },
        { offset: -0.2, color: 'a' },
      ]),
    ).toEqual([
      { offset: 0, color: 'a' },
      { offset: 0.8, color: 'b' },
    ]);
    // NaN / 缺值不产生 NaN
    expect(normalizeStops([{ offset: Number.NaN, color: 'x' }])[0]!.offset).toBe(0);
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

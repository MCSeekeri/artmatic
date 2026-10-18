import { describe, expect, it } from 'vitest';
import { getCapabilities, getTypographyCapabilities, serializeParam } from '../../src/agent/capabilities';
import type { ParamDef } from '../../src/effects/types';

describe('参数表序列化', () => {
  it('剥离 visibleWhen（函数过不了 JSON）', () => {
    const param: ParamDef = {
      key: 'speed',
      labelKey: { text: 'Speed' },
      type: 'range',
      min: 0,
      max: 4,
      step: 0.01,
      defaultValue: 1,
      visibleWhen: (v) => v.sync !== 'beat',
    };
    const out = serializeParam(param);
    expect(out).toMatchObject({ key: 'speed', type: 'range', min: 0, max: 4, step: 0.01, defaultValue: 1 });
    expect('visibleWhen' in out).toBe(false);
    expect(out.curvable).toBe(true);
    // 必须能过 JSON 往返（这就是「能不能给模型」的判据）。
    expect(JSON.parse(JSON.stringify(out))).toEqual(out);
  });

  it('select 的选项带解析后的标签，且非 range 不可打关键帧', () => {
    const param: ParamDef = {
      key: 'sync',
      labelKey: 'fx.clock.sync',
      type: 'select',
      defaultValue: 'free',
      options: [
        { value: 'free', labelKey: 'fx.clock.syncFree' },
        { value: 'beat', labelKey: 'fx.clock.syncBeat' },
      ],
    };
    const out = serializeParam(param);
    expect(out.curvable).toBe(false);
    expect(out.options?.map((o) => o.value)).toEqual(['free', 'beat']);
    expect(out.options?.[0]?.label).not.toBe('fx.clock.syncFree');
  });

  it('bitmask / pattern / text 的形状被保留', () => {
    const bitmask: ParamDef = {
      key: 'rule',
      labelKey: { text: 'Rule' },
      type: 'bitmask',
      bits: 18,
      defaultValue: 6152,
      groups: [
        { labelKey: { text: 'Birth' }, bits: 9, style: 'count' },
        { labelKey: { text: 'Survive' }, bits: 9, style: 'count' },
      ],
    };
    const out = serializeParam(bitmask);
    expect(out.bits).toBe(18);
    expect(out.groups?.map((g) => g.bits)).toEqual([9, 9]);

    const pattern: ParamDef = {
      key: 'seedPattern',
      labelKey: { text: 'Seed' },
      type: 'pattern',
      defaultValue: '',
      mode: '1d',
      editorSize: 32,
    };
    expect(serializeParam(pattern)).toMatchObject({ mode: '1d', editorSize: 32 });

    const text: ParamDef = {
      key: 'words',
      labelKey: { text: 'Words' },
      type: 'text',
      defaultValue: 'A,B',
      multiline: true,
    };
    expect(serializeParam(text)).toMatchObject({ multiline: true });
  });
});

describe('getCapabilities', () => {
  it('ids 档只给 id（省上下文）', () => {
    const caps = getCapabilities();
    expect(caps.effects.length).toBeGreaterThan(50);
    expect(caps.effects.every((e) => !('params' in e))).toBe(true);
    expect(caps.generators.every((g) => typeof g.kind === 'string')).toBe(true);
  });

  it('params 档按 id 过滤并带参数表', () => {
    const caps = getCapabilities({ detail: 'params', ids: ['blur', 'scene-ripple'] });
    expect(caps.effects.map((e) => e.id)).toEqual(['blur']);
    expect(caps.generators.map((g) => g.id)).toEqual(['scene-ripple']);
    const blur = caps.effects[0]!;
    expect(blur.name).toBeTruthy();
    expect(blur.params?.length).toBeGreaterThan(0);
    expect(blur.flags?.prePasses).toBeGreaterThan(0);
    // 参数键必须是 JSON 安全的纯数据
    expect(JSON.parse(JSON.stringify(blur.params))).toEqual(blur.params);
  });

  it('未知 id 被忽略而不是报错', () => {
    const caps = getCapabilities({ detail: 'params', ids: ['definitely-not-a-def'] });
    expect(caps.effects).toEqual([]);
    expect(caps.generators).toEqual([]);
    expect(caps.transitions).toEqual([]);
  });

  it('缓存会随 detail 切换（不会把 ids 档的结果当成 params 档）', () => {
    const a = getCapabilities();
    const b = getCapabilities({ detail: 'params' });
    expect(a.effects[0]).not.toBe(b.effects[0]);
  });
});

describe('getTypographyCapabilities', () => {
  it('给出图形种类、生成器与主题', () => {
    const caps = getTypographyCapabilities(null);
    expect(caps.shapeKinds).toContain('rect');
    expect(caps.shapeKinds).toContain('svg');
    expect(caps.generators.length).toBeGreaterThan(10);
    expect(caps.generators.every((g) => g.params.length >= 0 && g.id.length > 0)).toBe(true);
    expect(caps.themes.length).toBeGreaterThan(0);
    expect(caps.layoutOps).toEqual(['align', 'distribute', 'grid', 'row', 'column']);
    expect(JSON.parse(JSON.stringify(caps))).toEqual(caps);
  });
});

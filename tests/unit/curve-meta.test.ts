import { describe, expect, it } from 'vitest';
import { animatableParams, curveParamOf } from '../../src/ui/curve-editor/curve-meta';
import type { AnyClip, AudioClip, EffectClip, SourceClip } from '../../src/core/schema';
import type { Curve } from '../../src/core/curve';

const base = {
  id: 'c',
  start: 2,
  end: 10,
  label: 'c',
  fadeSec: 0,
  curves: {} as Record<string, Curve>,
};

function source(source: SourceClip['source'], extra: Partial<SourceClip> = {}): SourceClip {
  return {
    ...base,
    kind: 'source',
    source,
    blend: 'normal',
    opacity: 0.8,
    transform: { x: 0.25, y: 0.75, sx: 2, sy: 2, rot: 0.5 },
    fit: 'contain',
    ...extra,
  };
}

function effect(extra: Partial<EffectClip> = {}): EffectClip {
  return {
    ...base,
    kind: 'effect',
    chain: [{ instanceId: 'i1', defId: 'pixelate', enabled: true, values: {} }],
    ...extra,
  };
}

function audio(extra: Partial<AudioClip> = {}): AudioClip {
  return { ...base, kind: 'audio', assetId: 'a', srcIn: 0, ...extra };
}

describe('animatableParams', () => {
  it('片段参数带上 Inspector 同一份量纲与当前基值', () => {
    const p = animatableParams(source({ type: 'solid', color: '#000' }));
    const opacity = p.find((x) => x.key === 'opacity')!;
    expect(opacity.base).toBe(0.8);
    expect(opacity).toMatchObject({ min: 0, max: 1, animatable: true });
    expect(p.find((x) => x.key === 'transform.x')!.base).toBe(0.25);
    expect(p.find((x) => x.key === 'transform.sx')).toMatchObject({ min: 0.05, max: 4 });
    expect(p.find((x) => x.key === 'transform.rot')!.base).toBe(0.5);
  });

  it('realtime 生成器的全部 range 参数都能打关键帧', () => {
    const p = animatableParams(source({ type: 'algo', generator: 'mandelbrot', params: { zoom: 1.5 } }));
    const zoom = p.find((x) => x.key === 'zoom')!;
    expect(zoom).toMatchObject({ min: 0, max: 8, animatable: true, base: 1.5 });
    // bitmask / color 之类的非 range 参数不进列表
    expect(p.some((x) => x.key === 'palette')).toBe(false);
  });

  it('bake 只有 speed 能打关键帧；sim 的入参全部不可打（每条都进哈希）', () => {
    const bake = animatableParams(source({ type: 'algo', generator: 'rule110', params: {} }));
    const speed = bake.find((x) => x.key === 'speed')!;
    expect(speed.animatable).toBe(true);

    const sim = animatableParams(source({ type: 'algo', generator: 'game-of-life', params: {} }));
    // 网格是两栏（v16 起）。**两个轴都不可打关键帧**：改尺寸 = 重建模拟。
    for (const key of ['width', 'height']) {
      const dim = sim.find((x) => x.key === key)!;
      expect(dim, `${key} 应当出现在 sim 的参数量纲里`).toBeTruthy();
      expect(dim.animatable).toBe(false);
    }
  });

  it('特效参数按键 `instanceId.param` 展开，缺省值来自定义表', () => {
    const p = animatableParams(effect());
    const size = p.find((x) => x.key === 'i1.size')!;
    expect(size).toMatchObject({ min: 1, max: 64, step: 1, base: 8, animatable: true });
    expect(size.group.length).toBeGreaterThan(0);
  });

  it('音频只给 gain', () => {
    const p = animatableParams(audio());
    expect(p).toHaveLength(1);
    expect(p[0]).toMatchObject({ key: 'gain', min: 0, max: 2, base: 1, animatable: true });
  });

  it('已有但已不可编辑的曲线仍然列出来（否则界面上删不掉）', () => {
    const clip = source({ type: 'solid', color: '#000' }, {
      curves: {
        'gone.param': { keys: [{ t: 0, v: 0.3, interp: 'linear' }, { t: 1, v: 0.9, interp: 'linear' }] },
      },
    });
    const p = animatableParams(clip).find((x) => x.key === 'gone.param')!;
    expect(p.animatable).toBe(false);
    expect(p.base).toBe(0.3);
    expect(p.max).toBeGreaterThanOrEqual(0.9);
  });
});

describe('curveParamOf', () => {
  it('未知键返回 null，已知键带当前基值（新建关键帧的起点）', () => {
    const clip = source({ type: 'solid', color: '#000' }) as unknown as AnyClip;
    expect(curveParamOf(clip, 'nope')).toBeNull();
    expect(curveParamOf(clip, 'opacity')?.base).toBe(0.8);
  });
});

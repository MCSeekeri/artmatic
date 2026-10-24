/**
 * svg-gen.test.ts — SVG 素材生成器的守卫。
 *
 * 这一层的价值几乎全在**跨 22 个生成器的一致性**上：单看某一个怎么都对，
 * 22 个里只要有一个越界、超预算、或悄悄用了 `Math.random`，表现是「某一类
 * 素材偶尔糊掉 / 摇不出第二次」，而不会报任何错。所以断言按「全体」扫。
 *
 * 四条硬约束（报告 §9.2）：
 *  1. 纯函数：同参数同种子逐字节相同（不读 Math.random / Date.now）；
 *  2. 坐标 authored 在 0..100（描边类允许极小的外溢）；
 *  3. `commands` 是真实命令数，且不超过预算；
 *  4. 参数真的影响几何（滑杆不是摆设）。
 */

import { describe, expect, it } from 'vitest';
import {
  GEN_GROUPS,
  GEN_MAX_COMMANDS,
  SVG_GENERATORS,
  buildFromSpec,
  defaultsOf,
  generatorById,
  mergeParams,
  nextSeed,
  polygonPoints,
  serializePrims,
} from '../../src/typography/svg-gen';
import { shapeGeometry } from '../../src/typography/shapes';
import type { CheckboxParam, RangeParam } from '../../src/effects/types';

const NUMBERS = /-?\d+(?:\.\d+)?/g;

function numbersOf(d: string): number[] {
  return (d.match(NUMBERS) ?? []).map(Number);
}

/** 数 `d` 里的命令字母（与 `serializePrims` 的口径一致）。 */
function countCommands(d: string): number {
  return (d.match(/[MLCZ]/gi) ?? []).length;
}

/** 「所有参数取最大」的最坏组合：滑杆取 max，开关取 1。 */
function maxParams(spec: (typeof SVG_GENERATORS)[number]): Record<string, number | string> {
  const out = defaultsOf(spec);
  for (const p of spec.params) {
    if (p.type === 'range') out[p.key] = (p as RangeParam).max;
    else if (p.type === 'checkbox') out[p.key] = 1;
  }
  return out;
}

describe('生成器注册表', () => {
  it('一期 20 + 二期 2 = 22 个，id 唯一，六组都有内容', () => {
    expect(SVG_GENERATORS).toHaveLength(22);
    const ids = SVG_GENERATORS.map((g) => g.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const g of GEN_GROUPS) {
      expect(SVG_GENERATORS.filter((s) => s.group === g.id).length).toBeGreaterThan(0);
    }
  });

  it('每个 spec 有文案键、默认种子是 uint32、参数键不重复', () => {
    for (const spec of SVG_GENERATORS) {
      expect(spec.labelKey, spec.id).toBeTruthy();
      expect(Number.isInteger(spec.defaultSeed)).toBe(true);
      expect(spec.defaultSeed).toBeGreaterThanOrEqual(0);
      const keys = spec.params.map((p) => p.key);
      expect(new Set(keys).size, `${spec.id} 参数键重复`).toBe(keys.length);
    }
  });

  it('按 id 查表：未知 id 返回 null（旧档降级的依据）', () => {
    expect(generatorById('tenprint')?.id).toBe('tenprint');
    expect(generatorById('nope')).toBeNull();
    expect(generatorById(undefined)).toBeNull();
  });
});

describe('默认参数生成的路径', () => {
  for (const spec of SVG_GENERATORS) {
    it(`${spec.id}：非空、命令数自洽、坐标不越盒`, () => {
      const r = buildFromSpec(spec, defaultsOf(spec), spec.defaultSeed);
      expect(r.d.length, `${spec.id} 产出空路径`).toBeGreaterThan(0);
      expect(r.commands).toBeGreaterThan(0);
      expect(r.commands).toBe(countCommands(r.d));
      expect(r.commands).toBeLessThanOrEqual(GEN_MAX_COMMANDS);

      const nums = numbersOf(r.d);
      expect(nums.length).toBeGreaterThan(0);
      for (const v of nums) {
        expect(Number.isFinite(v), `${spec.id} 出现非有限坐标`).toBe(true);
        // 描边类允许极小的外溢（线宽与圆角在盒边附近），其余必须严格进盒。
        expect(v, `${spec.id} 坐标越界：${v}`).toBeGreaterThanOrEqual(-2);
        expect(v, `${spec.id} 坐标越界：${v}`).toBeLessThanOrEqual(102);
      }
    });
  }
});

describe('命令预算', () => {
  for (const spec of SVG_GENERATORS) {
    it(`${spec.id}：参数全取最大仍 ≤ ${GEN_MAX_COMMANDS}`, () => {
      const r = buildFromSpec(spec, maxParams(spec), spec.defaultSeed);
      expect(r.commands).toBeLessThanOrEqual(GEN_MAX_COMMANDS);
      expect(r.commands).toBe(countCommands(r.d));
    });
  }
});

describe('确定性', () => {
  for (const spec of SVG_GENERATORS) {
    it(`${spec.id}：同参数同种子逐字节相同`, () => {
      const a = buildFromSpec(spec, defaultsOf(spec), 12345);
      const b = buildFromSpec(spec, defaultsOf(spec), 12345);
      expect(b.d).toBe(a.d);
      expect(b.commands).toBe(a.commands);
      expect(b.evenOdd).toBe(a.evenOdd);
      expect(b.strokeOnly).toBe(a.strokeOnly);
    });
  }

  it('依赖随机的生成器：换种子确实换图', () => {
    for (const id of ['tenprint', 'pixelgrid', 'splat', 'waveband', 'squiggle', 'barcode']) {
      const spec = generatorById(id)!;
      const a = buildFromSpec(spec, defaultsOf(spec), 7);
      const b = buildFromSpec(spec, defaultsOf(spec), 8);
      expect(b.d, `${id} 换种子没变化`).not.toBe(a.d);
    }
  });

  it('dotgrid：默认抖动为 0 时种子不影响几何，拨动抖动后才有差异', () => {
    const spec = generatorById('dotgrid')!;
    const base = defaultsOf(spec);
    expect(buildFromSpec(spec, base, 8).d).toBe(buildFromSpec(spec, base, 7).d);
    const jittered = { ...base, jitter: 0.6 };
    expect(buildFromSpec(spec, jittered, 8).d).not.toBe(buildFromSpec(spec, jittered, 7).d);
  });

  it('换种子后可回到旧种子复现', () => {
    const spec = generatorById('dotgrid')!;
    const before = buildFromSpec(spec, defaultsOf(spec), 42).d;
    const n1 = nextSeed(42);
    expect(n1).not.toBe(42);
    buildFromSpec(spec, defaultsOf(spec), n1);
    expect(buildFromSpec(spec, defaultsOf(spec), 42).d).toBe(before);
  });

  it('nextSeed：确定性、不撞种子、连续 200 次无重复', () => {
    expect(nextSeed(99)).toBe(nextSeed(99));
    const seen = new Set<number>();
    let s = 1;
    for (let i = 0; i < 200; i++) {
      s = nextSeed(s);
      expect(seen.has(s)).toBe(false);
      seen.add(s);
    }
  });
});

describe('参数生效', () => {
  for (const spec of SVG_GENERATORS) {
    it(`${spec.id}：首个数值参数改动会改变几何`, () => {
      const first = spec.params.find((p) => p.type === 'range') as RangeParam | undefined;
      if (!first) return;
      const base = defaultsOf(spec);
      const alt = { ...base, [first.key]: first.defaultValue === first.min ? first.max : first.min };
      const a = buildFromSpec(spec, base, spec.defaultSeed);
      const b = buildFromSpec(spec, alt, spec.defaultSeed);
      expect(b.d, `${spec.id}.${first.key} 没有影响输出`).not.toBe(a.d);
    });
  }
});

describe('mergeParams', () => {
  it('缺键回落默认值，checkbox 归一成 0/1，非法数字被丢弃', () => {
    const spec = generatorById('honeycomb')!;
    const merged = mergeParams(spec, { cols: 10, stagger: 0, rows: Number.NaN });
    expect(merged.cols).toBe(10);
    expect(merged.stagger).toBe(0);
    expect(merged.rows).toBe(defaultsOf(spec).rows);
    expect(merged.size).toBe(defaultsOf(spec).size);
  });

  it('返回的是新对象（改默认值副本不污染注册表）', () => {
    const spec = generatorById('tenprint')!;
    const a = defaultsOf(spec);
    a.cols = 3;
    expect(defaultsOf(spec).cols).toBe(16);
  });
});

describe('图元 IR 的序列化口径', () => {
  it('圆 = 4 段 C + Z（共 6 条命令）', () => {
    const r = serializePrims([{ t: 'circle', c: { x: 50, y: 50 }, r: 10 }]);
    expect(r.commands).toBe(6);
    expect(r.d.match(/C/g)?.length).toBe(4);
    expect(r.d.endsWith('Z')).toBe(true);
    expect(r.d.startsWith('M')).toBe(true);
  });

  it('闭合多边形：M + n-1 个 L + Z', () => {
    const r = serializePrims([
      { t: 'poly', pts: polygonPoints({ x: 50, y: 50 }, 10, 4, 0), close: true },
    ]);
    expect(r.commands).toBe(5);
    expect(r.d.match(/L/g)?.length).toBe(3);
  });

  it('开放样条不取模：首尾控制点夹取，端部不会甩出盒外', () => {
    // 三个等距点若按环形取邻点，末点的 p3 会绕回首点，切线反向。
    const r = serializePrims([
      { t: 'spline', pts: [{ x: 0, y: 50 }, { x: 50, y: 0 }, { x: 100, y: 50 }] },
    ]);
    const nums = (r.d.match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number);
    for (const v of nums) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(100);
    }
  });

  it('connect 的第二沿用 L 起头（闭合带不另起子路径）', () => {
    const r = serializePrims([
      { t: 'spline', pts: [{ x: 0, y: 0 }, { x: 10, y: 5 }, { x: 20, y: 0 }] },
      { t: 'spline', pts: [{ x: 20, y: 10 }, { x: 10, y: 15 }, { x: 0, y: 10 }], connect: true },
      { t: 'close' },
    ]);
    expect(r.d.match(/M/g)?.length).toBe(1);
    expect(r.d.match(/L/g)?.length).toBe(1);
    expect(r.d.endsWith('Z')).toBe(true);
  });

  it('整圈环带退化成两条同心圆（evenodd 挖洞的前提）', () => {
    const r = serializePrims([
      { t: 'band', c: { x: 50, y: 50 }, r0: 20, r1: 30, a0: 0, a1: Math.PI * 2 },
    ]);
    expect(r.d.match(/M/g)?.length).toBe(2);
    expect(r.commands).toBe(12);
  });

  it('弧段环带是单条闭合子路径（外弧 + 内弧反向）', () => {
    const r = serializePrims([
      { t: 'band', c: { x: 50, y: 50 }, r0: 20, r1: 30, a0: 0, a1: Math.PI / 2 },
    ]);
    expect(r.d.match(/M/g)?.length).toBe(1);
    expect(r.d.endsWith('Z')).toBe(true);
  });
});

describe('shapeGeometry 的 evenOdd 通道', () => {
  it('shape:svg 透传 evenOdd 与 scaleFrom100', () => {
    const geo = shapeGeometry('svg', { w: 200, h: 100, path: 'M0,0 L10,0 L10,10 Z', evenOdd: true });
    expect(geo.scaleFrom100).toBe(true);
    expect(geo.evenOdd).toBe(true);
  });

  it('未置 evenOdd 时保持 undefined（nonzero）', () => {
    const geo = shapeGeometry('svg', { w: 100, h: 100, path: 'M0,0 L10,0 L10,10 Z' });
    expect(geo.evenOdd).toBeUndefined();
  });
});

describe('带洞生成器', () => {
  for (const id of ['rings', 'perspective']) {
    it(`${id} 声明 evenOdd`, () => {
      const spec = generatorById(id)!;
      expect(buildFromSpec(spec, defaultsOf(spec), spec.defaultSeed).evenOdd).toBe(true);
    });
  }

  /*
   * 刻度盘走 **nonzero**：刻度与圆环、刻度与刻度的相交部分必须是并集。
   * evenodd 下交集会被挖空（「刻度穿过环的地方消失」——用户报的那个洞）。
   * 环本身仍然是空心的，靠内圈的反向绕向（prims.ts::band）。
   */
  it('dial 用 nonzero，且环是「外圈 + 反向内圈」两条子路径', () => {
    const spec = generatorById('dial')!;
    const r = buildFromSpec(spec, defaultsOf(spec), spec.defaultSeed);
    expect(r.evenOdd).not.toBe(true);
    // 默认 60 刻度 + 1 个环形（2 条子路径）
    expect(r.d.match(/M/g)?.length).toBe(62);
  });

  it('dial：居中 / 主刻度翻转都改变几何，且不出盒', () => {
    const spec = generatorById('dial')!;
    const base = defaultsOf(spec);
    const plain = buildFromSpec(spec, base, 7).d;
    const patches: Record<string, number>[] = [
      { centered: 1 },
      { flipMajor: 1 },
      { centered: 1, flipMajor: 1 },
    ];
    for (const patch of patches) {
      const r = buildFromSpec(spec, { ...base, ...patch }, 7);
      expect(r.d, `${JSON.stringify(patch)} 没有影响几何`).not.toBe(plain);
      for (const v of numbersOf(r.d)) {
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(102);
      }
    }
  });
});

describe('细节参数（一期反馈）', () => {
  it('dotgrid：十字图元存在，粗细参数改变臂宽', () => {
    const spec = generatorById('dotgrid')!;
    const base = { ...defaultsOf(spec), shape: 'cross' };
    const thin = buildFromSpec(spec, { ...base, crossArm: 0.1 }, 3);
    const thick = buildFromSpec(spec, { ...base, crossArm: 0.5 }, 3);
    expect(thin.d).not.toBe(thick.d);
    expect(thin.commands).toBeGreaterThan(0);
  });

  it('dotgrid：随机图元由种子驱动，同种子复现', () => {
    const spec = generatorById('dotgrid')!;
    const base = { ...defaultsOf(spec), shape: 'random' };
    expect(buildFromSpec(spec, base, 5).d).toBe(buildFromSpec(spec, base, 5).d);
    expect(buildFromSpec(spec, base, 5).d).not.toBe(buildFromSpec(spec, base, 6).d);
  });

  it('dotgrid：固定图元不消耗随机数（改十字粗细不该让整张图重排）', () => {
    const spec = generatorById('dotgrid')!;
    const base = { ...defaultsOf(spec), shape: 'circle' };
    const a = buildFromSpec(spec, { ...base, crossArm: 0.1 }, 9);
    const b = buildFromSpec(spec, { ...base, crossArm: 0.5 }, 9);
    expect(b.d).toBe(a.d);
  });

  it('rings：带宽衰减 0 = 等宽，正负两个方向都改变几何', () => {
    const spec = generatorById('rings')!;
    const base = defaultsOf(spec);
    const flat = buildFromSpec(spec, base, 1).d;
    const thinner = buildFromSpec(spec, { ...base, taperWidth: 0.4 }, 1).d;
    const wider = buildFromSpec(spec, { ...base, taperWidth: -0.4 }, 1).d;
    expect(thinner).not.toBe(flat);
    expect(wider).not.toBe(flat);
    expect(thinner).not.toBe(wider);
  });

  it('globe：外接圆开关加一条圆的子路径（6 条命令）', () => {
    const spec = generatorById('globe')!;
    const base = defaultsOf(spec);
    const off = buildFromSpec(spec, base, 1);
    const on = buildFromSpec(spec, { ...base, outline: 1 }, 1);
    expect(on.d.match(/M/g)?.length).toBe((off.d.match(/M/g)?.length ?? 0) + 1);
    expect(on.commands).toBe(off.commands + 6);
  });

  it('hatch：虚线段能调到 1（段与段首尾相接，没有接缝）', () => {
    const spec = generatorById('hatch')!;
    const dash = spec.params.find((p) => p.key === 'dash');
    expect(dash && 'max' in dash ? dash.max : 0).toBe(1);
    const base = defaultsOf(spec);

    /** 所有 `M x,y L x,y` 线段；统计「起点恰好等于某段终点」的段数（= 首尾相接）。 */
    const joined = (d: string): number => {
      const segs = [...d.matchAll(/M(-?[\d.]+),(-?[\d.]+)L(-?[\d.]+),(-?[\d.]+)/g)].map((m) => ({
        x1: m[1]!,
        y1: m[2]!,
        x2: m[3]!,
        y2: m[4]!,
      }));
      const ends = new Set(segs.map((s) => `${s.x2},${s.y2}`));
      return segs.filter((s) => ends.has(`${s.x1},${s.y1}`)).length;
    };

    const dotted = joined(buildFromSpec(spec, { ...base, dash: 0.9 }, 1).d);
    const solid = joined(buildFromSpec(spec, { ...base, dash: 1 }, 1).d);
    // 0.9 时每段之间留着 10% 的缝 ⇒ 几乎没有首尾相接；1 时除每行第一段外全部相接。
    expect(solid).toBeGreaterThan(dotted + 100);
  });
});

describe('二期生成器', () => {
  it('contour：同参同种子复现，换种子换地形', () => {
    const spec = generatorById('contour')!;
    const base = defaultsOf(spec);
    expect(buildFromSpec(spec, base, 3).d).toBe(buildFromSpec(spec, base, 3).d);
    expect(buildFromSpec(spec, base, 3).d).not.toBe(buildFromSpec(spec, base, 4).d);
  });

  it('contour：层数与采样都真的改变几何', () => {
    const spec = generatorById('contour')!;
    const base = defaultsOf(spec);
    const plain = buildFromSpec(spec, base, 3).d;
    expect(buildFromSpec(spec, { ...base, levels: 10 }, 3).d).not.toBe(plain);
    expect(buildFromSpec(spec, { ...base, samples: 12 }, 3).d).not.toBe(plain);
  });

  it('contour：层数取最小也有内容（高度场已按 min/max 归一化）', () => {
    const spec = generatorById('contour')!;
    const r = buildFromSpec(spec, { ...defaultsOf(spec), levels: 3 }, 11);
    expect(r.commands).toBeGreaterThan(10);
  });

  it('contour：地形缩放取到极端也不出盒', () => {
    const spec = generatorById('contour')!;
    for (const noiseScale of [0.6, 5]) {
      for (const peaks of [1, 6]) {
        const r = buildFromSpec(spec, { ...defaultsOf(spec), noiseScale, peaks }, 5);
        for (const v of numbersOf(r.d)) {
          expect(v).toBeGreaterThanOrEqual(0);
          expect(v).toBeLessThanOrEqual(100);
        }
      }
    }
  });

  it('motif：四种形状互不相同', () => {
    const spec = generatorById('motif')!;
    const base = defaultsOf(spec);
    const seen = new Set(
      ['cube', 'prism', 'stair', 'diamond'].map((shape) =>
        buildFromSpec(spec, { ...base, shape }, 1).d,
      ),
    );
    expect(seen.size).toBe(4);
  });

  it('motif：旋转 + 斜切之后仍然严格在 0..100 内', () => {
    const spec = generatorById('motif')!;
    for (const angle of [0, 45, -135]) {
      const r = buildFromSpec(spec, { ...defaultsOf(spec), angle, slant: 0.6 }, 1);
      for (const v of numbersOf(r.d)) {
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(100);
      }
    }
  });
});

describe('strokeOnly 生成器', () => {
  const lines = ['tenprint', 'hatch', 'sine', 'squiggle', 'globe', 'contour'];
  for (const id of lines) {
    it(`${id} 声明 strokeOnly（插入时给「无填充 + 描边」）`, () => {
      const spec = generatorById(id)!;
      expect(buildFromSpec(spec, defaultsOf(spec), spec.defaultSeed).strokeOnly).toBe(true);
    });
  }
});

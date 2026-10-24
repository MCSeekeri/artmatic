import { describe, expect, it } from 'vitest';
import {
  clampGridDim,
  gridSizeFromDefs,
  gridSizeOf,
  type GridLimits,
} from '../../src/algos/grid-dims';
import { createLife, lifeStepRule, type LifeRule } from '../../src/algos/game-of-life';
import { createBriansBrain, briansStep } from '../../src/algos/brians-brain';
import { createCyclicCa, cyclicStep } from '../../src/algos/cyclic-ca';
import { createReactionDiffusion } from '../../src/algos/reaction-diffusion';
import { createLenia } from '../../src/algos/lenia';
import { createSandpile } from '../../src/algos/sandpile';
import { TorusField, annulusKernel } from '../../src/algos/sim-util';
import { getGenerator } from '../../src/algos/registry';

const LIM: GridLimits = { min: 32, max: 256, fallback: 112 };

const defaults = (id: string): Record<string, number | string> => {
  const p: Record<string, number | string> = {};
  for (const d of getGenerator(id)!.params) p[d.key] = d.defaultValue;
  return p;
};

describe('gridSizeOf', () => {
  it('读 width / height', () => {
    expect(gridSizeOf({ width: 256, height: 144 }, LIM)).toEqual({ w: 256, h: 144 });
  });

  it('只有 width 时高度退回默认值（不是退回 width）', () => {
    expect(gridSizeOf({ width: 200 }, LIM)).toEqual({ w: 200, h: 112 });
  });

  it('老工程的 size 仍然得到正方形 —— 迁移漏网 / 手改文件都不该变形', () => {
    expect(gridSizeOf({ size: 96 }, LIM)).toEqual({ w: 96, h: 96 });
  });

  it('width/height 优先于 size', () => {
    expect(gridSizeOf({ width: 64, height: 48, size: 200 }, LIM)).toEqual({ w: 64, h: 48 });
  });

  it('越界与非法值被钳制', () => {
    expect(gridSizeOf({ width: 8, height: 9999 }, LIM)).toEqual({ w: 32, h: 256 });
    expect(gridSizeOf({ width: 'abc', height: Number.NaN }, LIM)).toEqual({ w: 112, h: 112 });
    expect(clampGridDim(undefined, LIM)).toBe(112);
  });
});

describe('gridSizeFromDefs', () => {
  it('有 width 参数的生成器给出真实网格（Agent / 图案导入要用它）', () => {
    expect(gridSizeFromDefs(defaults('game-of-life'), getGenerator('game-of-life')!.params)).toEqual({
      w: 112,
      h: 112,
    });
    expect(
      gridSizeFromDefs(
        { width: 256, height: 144 },
        getGenerator('game-of-life')!.params,
      ),
    ).toEqual({ w: 256, h: 144 });
  });

  it('没有网格参数的生成器返回 null（雪花 / 佛像的 size 不是列数）', () => {
    expect(gridSizeFromDefs(defaults('snowflake'), getGenerator('snowflake')!.params)).toBeNull();
    expect(gridSizeFromDefs(defaults('buddhabrot'), getGenerator('buddhabrot')!.params)).toBeNull();
  });
});

describe('矩形网格：元胞自动机', () => {
  const conway: LifeRule = { birth: 1 << 3, survive: (1 << 2) | (1 << 3), vonNeumann: false, wrap: true };

  it('生命游戏：环面回绕按两轴分别取（横 2 格与纵 2 格的邻居不是同一个）', () => {
    // 6 宽 3 高。四个角各放一个活格：环面下 (0,0) 的 8 邻居里包含
    // (5,0) 与 (0,2) —— 若按正方形算（用 w 当高），y 回绕会绕到不存在的行。
    const w = 6;
    const h = 3;
    const g = new Uint8Array(w * h);
    g[0] = 1; // (0,0)
    g[w - 1] = 1; // (5,0)
    g[(h - 1) * w] = 1; // (0,2)
    g[(h - 1) * w + w - 1] = 1; // (5,2)
    const next = lifeStepRule(g, w, h, conway);
    expect(next).toHaveLength(w * h);
    // 四个角互为邻居（环面 + 3 宽的纵向回绕），于是它们各自有 3 个活邻居 → 存活。
    // 任何把 h 当成 w 的实现都会越界/读到错的格，这里会拿到不同的结果。
    for (const i of [0, w - 1, (h - 1) * w, w * h - 1]) expect(next[i]).toBe(1);
  });

  it('生命游戏句柄报告 width × height', () => {
    const sim = createLife({ ...defaults('game-of-life'), width: 96, height: 64 }, 1);
    expect([sim.gridW, sim.gridH]).toEqual([96, 64]);
    expect(sim.current()).toHaveLength(96 * 64);
  });

  it("Brian's Brain：矩形网格的一步不越界（每格都被写）", () => {
    const w = 5;
    const h = 9;
    const g = new Uint8Array(w * h);
    for (let i = 0; i < g.length; i++) g[i] = i % 3;
    const next = briansStep(g, w, h);
    expect(next).toHaveLength(w * h);
    for (const v of next) expect([0, 1, 2]).toContain(v);
  });

  it('循环 CA：矩形网格上 seek ≡ 顺序推进', () => {
    const p = { ...defaults('cyclic-ca'), width: 96, height: 48 };
    const a = createCyclicCa(p, 3);
    const b = createCyclicCa(p, 3);
    a.seek(240);
    b.seek(500);
    b.seek(240);
    expect(b.current()).toEqual(a.current());
    expect([a.gridW, a.gridH]).toEqual([96, 48]);
  });

  it('循环 CA 的同步更新在矩形上仍与遍历顺序无关', () => {
    const w = 7;
    const h = 4;
    const build = (): Uint8Array => {
      const g = new Uint8Array(w * h);
      for (let i = 0; i < g.length; i++) g[i] = (i * 3) % 5;
      return g;
    };
    const rule = { k: 5, theta: 1, vonNeumann: false, wrap: true };
    const a = new Uint8Array(w * h);
    const b = new Uint8Array(w * h);
    cyclicStep(build(), a, w, h, rule);
    cyclicStep(build(), b, w, h, rule);
    expect(b).toEqual(a);
  });

  it('反应扩散 / Lenia / 沙堆都按两轴建场', () => {
    const rd = createReactionDiffusion(
      { ...defaults('reaction-diffusion'), width: 48, height: 32 },
      1,
    );
    expect([rd.gridW, rd.gridH]).toEqual([48, 32]);
    expect(rd.current()).toHaveLength(48 * 32 * 2);

    const lenia = createLenia({ ...defaults('lenia'), width: 64, height: 48 }, 1);
    expect([lenia.gridW, lenia.gridH]).toEqual([64, 48]);
    expect(lenia.current()).toHaveLength(64 * 48);

    const sand = createSandpile({ ...defaults('sandpile'), width: 64, height: 96 }, 1);
    expect([sand.gridW, sand.gridH]).toEqual([64, 96]);
    expect(sand.current()).toHaveLength(64 * 96);
  });
});

/** 朴素参照：逐抽头做两轴环面回绕。 */
function naiveConvolveRect(
  src: Float32Array,
  w: number,
  h: number,
  k: { dx: Int32Array; dy: Int32Array; w: Float32Array },
): Float32Array {
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let acc = 0;
      for (let t = 0; t < k.w.length; t++) {
        const yy = (((y + k.dy[t]!) % h) + h) % h;
        const xx = (((x + k.dx[t]!) % w) + w) % w;
        acc += k.w[t]! * src[yy * w + xx]!;
      }
      out[y * w + x] = acc;
    }
  }
  return out;
}

describe('TorusField：矩形 halo', () => {
  it('与朴素两轴环面卷积逐位相同（含 R 接近短边的情形）', () => {
    for (const [w, h, R] of [
      [40, 24, 8],
      [18, 10, 5],
      [12, 12, 5],
    ] as const) {
      const k = annulusKernel(R);
      const src = new Float32Array(w * h);
      for (let i = 0; i < src.length; i++) src[i] = Math.sin(i * 0.37) * 0.5 + 0.5;
      const field = new TorusField(w, h, k);
      field.convolve(src);
      expect(Array.from(field.conv), `${w}×${h} R=${R}`).toEqual(
        Array.from(naiveConvolveRect(src, w, h, k)),
      );
    }
  });
});

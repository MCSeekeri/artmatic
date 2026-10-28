import { describe, expect, it } from 'vitest';
import { getGenerator } from '../../src/algos/registry';
import { defaultValues, visibleParams } from '../../src/effects/types';

/**
 * 流线的**默认点位**守卫。
 *
 * 这条守卫来自一个真实踩过的坑（不是假想）：四个发射点 / 四个接受点的默认
 * 位置必须两两错开。第一版把发射点 2 摆在 (0.86, 0.5)、接受点 1 也是
 * (0.86, 0.5) —— 于是「把发射点数量拖到 2」立刻得到一条**零长度**的线：
 * 起点与终点重合，贝塞尔退化成一点，整束画面只剩发射点上的一个小团。
 * 全程不报错，缩略图也照样是「有东西」的。
 *
 * 只测纯数据（参数表），不碰 GL。
 */

const DEF = getGenerator('streamlines')!;
const VALUES = defaultValues(DEF.params);

function point3(prefix: string, i: number): [number, number, number] {
  const k = (axis: string): number => {
    const p = DEF.params.find((q) => q.key === `${prefix}${i}${axis}`);
    expect(p, `缺少参数 ${prefix}${i}${axis}`).toBeTruthy();
    return Number(p!.defaultValue);
  };
  return [k('x'), k('y'), k('w')];
}

const EMITTERS = [0, 1, 2, 3].map((i) => point3('e', i));
const RECEIVERS = [0, 1, 2, 3].map((i) => point3('r', i));

/** 两个点在画面里的距离（UV；方形近似够用，判据只是「别重合」）。 */
function gap(a: number[], b: number[]): number {
  return Math.hypot(a[0]! - b[0]!, a[1]! - b[1]!);
}

describe('流线：默认点位', () => {
  it('发射点与接受点的默认位置两两不重合', () => {
    for (let e = 0; e < EMITTERS.length; e++) {
      for (let r = 0; r < RECEIVERS.length; r++) {
        expect(
          gap(EMITTERS[e]!, RECEIVERS[r]!),
          `发射点 ${e + 1} 与接受点 ${r + 1} 的默认位置重合 → 这两点都打开时线长为 0`,
        ).toBeGreaterThan(0.1);
      }
    }
  });

  it('四个发射点互不重合（否则「权重」变成了同一束线的重复计数）', () => {
    for (let a = 0; a < EMITTERS.length; a++) {
      for (let b = a + 1; b < EMITTERS.length; b++) {
        expect(gap(EMITTERS[a]!, EMITTERS[b]!), `发射点 ${a + 1} 与 ${b + 1} 重合`).toBeGreaterThan(0.05);
      }
    }
  });

  it('每个点都在画面里（0..1），权重非零', () => {
    for (const [name, list] of [
      ['发射点', EMITTERS],
      ['接受点', RECEIVERS],
    ] as const) {
      for (const [x, y, w] of list) {
        expect(x).toBeGreaterThanOrEqual(0);
        expect(x).toBeLessThanOrEqual(1);
        expect(y).toBeGreaterThanOrEqual(0);
        expect(y).toBeLessThanOrEqual(1);
        // 权重 0 = 那个点不会分到任何一条线（可用，但不该是出厂状态）
        expect(w, `${name}的默认权重为 0 → 打开它什么也不会发生`).toBeGreaterThan(0);
      }
    }
  });

  it('出厂的可见参数里包含两端的核心项（数量 / 密度 / 线宽 / 背景）', () => {
    const keys = visibleParams(DEF.params, VALUES).map((p) => p.key);
    for (const k of ['emitCount', 'e0x', 'e0y', 'e0w', 'density', 'color', 'widthHead', 'bgMode', 'bg']) {
      expect(keys, `默认状态下 ${k} 不可见`).toContain(k);
    }
    // 接受点默认是开的（这是这条生成器的招牌形态：收束到另一点）
    expect(keys).toContain('recvCount');
    expect(keys).toContain('r0x');
  });

  it('虚线长度与扭曲参数只在需要时出现（不留「拖了没反应」的控件）', () => {
    const keys = visibleParams(DEF.params, VALUES).map((p) => p.key);
    expect(keys).not.toContain('dashLen');
    const dashed = visibleParams(DEF.params, { ...VALUES, dash: 1 }).map((p) => p.key);
    expect(dashed).toContain('dashLen');
  });

  it('线段长度为 0（无限）时，长度随机偏移是隐藏的', () => {
    // 「无限」没有长度可偏移：留着那个滑杆就是「拖了没反应」。
    const off = visibleParams(DEF.params, VALUES).map((p) => p.key);
    expect(off).not.toContain('segJitter');
    const on = visibleParams(DEF.params, { ...VALUES, segLen: 0.5 }).map((p) => p.key);
    expect(on).toContain('segJitter');
  });

  it('线段长度与等待间隔的出厂值是 0（= 老行为：一条线画满整个生存时间）', () => {
    const seg = (k: string) => Number(VALUES[k]);
    expect(seg('segLen')).toBe(0);
    expect(seg('segWait')).toBe(0);
    // 0 = 不限制；非 0 才把周期拆成「生长 + 等待」
    expect(seg('life')).toBeGreaterThan(0);
  });
});

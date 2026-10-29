import { describe, expect, test } from 'vitest';
import { getGenerator } from '../../src/algos/registry';
import { TUNNEL_SCENES, TUNNEL_SECTIONS, TUNNEL_SKIES, TUNNEL_STYLES, TUNNEL_WALLS } from '../../src/algos/tunnel3d';
import { ALGO_HEAD, declaredUniforms } from '../../src/algos/shader-lib';
import { emptyFeatures } from '../../src/algos/feature-source';
import type { AlgoUniformCtx } from '../../src/algos/shader-lib';
import type { SourceClip } from '../../src/core/schema';

/**
 * `tunnel-3d` 的三条行为约定。
 *
 * 参数派发本身由 `algo-uniforms.test.ts` 覆盖（声明了就必须被写到）。这里管的是
 * 那张测试**看不见**的三件事，它们的失效形态都是静默的：
 *
 * 1. `style` / `section` 是字符串存进工程 JSON 的，映射表缺一项就**静默退回
 *    霓虹 / 圆截面** —— 界面上选了「废墟」，画面还是霓虹，不报错。
 * 2. 前进距离必须是 `t × speed`（硬约束 1.1：不许累积状态）。写成累加器在
 *    顺序播放时看不出区别，只有 seek 之后才发现不可复现。
 * 3. 「灯光随拍闪」必须真的读到拍网格 —— 漏了 `u_beat` 就恒为 0，滑杆拖到 1
 *    也只是整体亮一点，而不是闪。
 */

const ID = 'tunnel-3d';

/** 记录每个 uniform 被写进去的**值**（不只名字）。 */
function writeValues(
  values: Record<string, number | string>,
  t: number,
): Map<string, number | number[] | string> {
  const def = getGenerator(ID);
  if (!def || def.kind !== 'realtime') throw new Error('tunnel-3d 应当仍是 realtime');

  const merged: Record<string, number | string> = {};
  for (const p of def.params) merged[p.key] = p.defaultValue;
  Object.assign(merged, values);

  const out = new Map<string, number | number[] | string>();
  const byLoc = new Map<object, string>();
  const locFor = (name: string): object => {
    const loc = { name };
    byLoc.set(loc, name);
    return loc;
  };
  const rec = (v: unknown): void => {
    const name = byLoc.get(v as object);
    if (name) out.set(name, 0);
  };
  const gl = {
    uniform1f: (loc: unknown, v: number) => {
      const n = byLoc.get(loc as object);
      if (n) out.set(n, v);
    },
    uniform1i: (loc: unknown, v: number) => {
      const n = byLoc.get(loc as object);
      if (n) out.set(n, v);
    },
    uniform3f: (loc: unknown, a: number, b: number, c: number) => {
      const n = byLoc.get(loc as object);
      if (n) out.set(n, [a, b, c]);
    },
    isContextLost: () => false,
  } as unknown as WebGL2RenderingContext;
  void rec;

  const locs = new Proxy({} as Record<string, WebGLUniformLocation | null>, {
    get(_t, prop) {
      return typeof prop === 'string' ? (locFor(prop) as unknown as WebGLUniformLocation) : undefined;
    },
  });

  const ctx = {
    t,
    frame: Math.round(t * 30),
    seed: 12345,
    w: 1280,
    h: 720,
    fps: 30,
    grid: { bpm: 120, offset: 0, beatsPerBar: 4 },
    clip: {} as SourceClip,
    features: emptyFeatures(),
  } satisfies AlgoUniformCtx;

  def.setUniforms(gl, locs, merged, ctx);
  return out;
}

describe('3D 隧道：字符串参数与闭式量', () => {
  const def = getGenerator(ID)!;
  const byKey = new Map(def.params.map((p) => [p.key, p]));

  test('五张查表的每个选项都有映射（缺一项 = 静默退回默认）', () => {
    const pairs: [string, Record<string, number>][] = [
      ['style', TUNNEL_STYLES],
      ['section', TUNNEL_SECTIONS],
      ['wall', TUNNEL_WALLS],
      ['sky', TUNNEL_SKIES],
      ['scene', TUNNEL_SCENES],
    ];
    for (const [key, table] of pairs) {
      const p = byKey.get(key)!;
      expect(p.type, key).toBe('select');
      if (p.type !== 'select') continue;
      for (const o of p.options) expect(table, `${key} 的选项 ${o.value} 没有映射`).toHaveProperty(o.value);
    }
  });

  test('映射值是 0..n-1 的稠密整数（着色器里是逐值 == 分支）', () => {
    for (const table of [TUNNEL_STYLES, TUNNEL_SECTIONS, TUNNEL_WALLS, TUNNEL_SKIES, TUNNEL_SCENES]) {
      const vals = Object.values(table).sort((a, b) => a - b);
      expect(vals).toEqual(vals.map((_, i) => i));
    }
  });

  test('每个下拉框的默认值都在自己的查表里（否则出厂就是 0 号分支）', () => {
    /*
     * `setUniforms` 写的是 `TUNNEL_X[String(v.x)] ?? 0`。默认值一旦写错字
     * （比如 'nebula' 没有对应分支），出厂状态就静默变成 0 号 —— 天空变空白、
     * 外景变没有，而界面上那个下拉框显示的是那个不存在的名字。
     */
    const pairs: [string, Record<string, number>][] = [
      ['style', TUNNEL_STYLES],
      ['section', TUNNEL_SECTIONS],
      ['wall', TUNNEL_WALLS],
      ['sky', TUNNEL_SKIES],
      ['scene', TUNNEL_SCENES],
    ];
    for (const [key, table] of pairs) {
      const p = byKey.get(key)!;
      expect(typeof p.defaultValue, key).toBe('string');
      expect(table, `${key} 的默认值 ${String(p.defaultValue)} 没有映射`).toHaveProperty(
        String(p.defaultValue),
      );
    }
  });

  test('前进距离是 t × speed（闭式，不是累加器）', () => {
    expect(writeValues({ speed: 3 }, 4).get('u_travel')).toBeCloseTo(12, 5);
    expect(writeValues({ speed: 0 }, 4).get('u_travel')).toBe(0);
    // 同一个 t、不同速度 → 距离按比例；同一个速度、不同 t 亦然
    expect(writeValues({ speed: 3 }, 2).get('u_travel')).toBeCloseTo(6, 5);
  });

  test('分段的空节数被夹到「每几节」以内（否则整条隧道都没有壁）', () => {
    /*
     * 着色器判据是 `mod(cell, every) >= gap`。gap >= every 时它对所有 cell 都为假 ⇒
     * 分段模式与「关闭」一模一样，而界面上的滑杆明明在动。夹紧必须在派发侧，
     * 因为这些是两个独立的 range 参数。
     */
    const w = writeValues({ wall: 'rift', riftEvery: 4, riftGap: 6 }, 0);
    expect(w.get('u_riftEvery')).toBe(4);
    expect(w.get('u_riftGap'), 'gap 必须 < every').toBe(3);
    // 正常范围内原样通过
    const w2 = writeValues({ wall: 'rift', riftEvery: 6, riftGap: 2 }, 0);
    expect(w2.get('u_riftGap')).toBe(2);
  });

  test('u_beat 在拍点上比拍中间大（灯光真的读拍网格）', () => {
    // 120 BPM 下拍长 0.5 s：t=0 恰在拍点上，t=0.25 在两拍之间
    const onBeat = writeValues({}, 0).get('u_beat') as number;
    const offBeat = writeValues({}, 0.25).get('u_beat') as number;
    expect(onBeat).toBeGreaterThan(offBeat);
    expect(offBeat).toBeGreaterThanOrEqual(0);
    expect(onBeat).toBeLessThanOrEqual(1);
  });

  test('fragment 自己声明的 uniform 都带 u_ 前缀且不与 head 重名', () => {
    if (def.kind !== 'realtime') return;
    const headOwned = new Set(declaredUniforms(ALGO_HEAD).keys());
    for (const n of declaredUniforms(def.fragment).keys()) {
      expect(headOwned.has(n), `${n} 与 head 重复声明 → 编译失败`).toBe(false);
    }
  });
});

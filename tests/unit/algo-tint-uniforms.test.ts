import { describe, expect, test } from 'vitest';
import { getGenerator, listGenerators } from '../../src/algos/registry';
import { TINT_HEAD, algoTintProgramName } from '../../src/algos/shader-lib';
import { emptyFeatures } from '../../src/algos/feature-source';
import { makeStubGl, parseUniforms, typeMismatches } from './_uniform-probe';
import type { AlgoUniformCtx } from '../../src/algos/shader-lib';
import type { SourceClip } from '../../src/core/schema';

/**
 * **sim 自定义着色**（`def.tintFragment`）的接线自检。
 *
 * 为什么必须单独一条：`algo-uniforms.test.ts` 的 `probeGenerator` 遇到
 * `kind !== 'realtime'` 直接返回 `null` —— 也就是说**它对 sim 的 tint 一无所知**。
 * 而 tint 走的是和 realtime 完全同一套手工派发（`setTintUniforms` 写
 * `prog.uniforms`），所以同一类静默失效在这里原样存在：
 *
 * - 声明了 `uniform int u_palette;` 却忘了派发 → 恒为 0，调色板永远换不动；
 * - 对 `uniform vec3 u_tintA` 调 `uniform1f` → GL `INVALID_OPERATION` 且**不写**；
 * - 名字拼错 → `Program.u()` 静默跳过（未声明的 location 是 null）。
 *
 * `compileAll` 只证明 shader 编得过，这三类一条都看不见。
 *
 * 这个缺口是加 `tintFragment` 那次埋下的（加了但没有任何生成器用它，
 * 于是守卫也没跟着加）。第一个使用者是反应扩散 —— 它有 4 个调色板
 * 加对比度/显示开关好几个 uniform，正是最容易漏派发的那种。
 */

/**
 * `TINT_HEAD` 自己提供、由 `AlgoRuntime` 的 sim 分支负责写的 uniform。
 *
 * ⚠️ 用 aux 纹理的 def 还要把它的 sampler 名并进来 —— sim 目前没有 aux 使用者，
 * 真加了的话这条守卫会报「声明了却没写」（那些 sampler 由运行时绑）。
 */
const HEAD_OWNED = new Set([
  'u_tex',
  'u_colorBg',
  'u_colorLive',
  'u_srcAspect',
  'u_outAspect',
]);

interface Probe {
  /** tintFragment **自己**声明的 uniform（不含 TINT_HEAD）。 */
  own: Map<string, string>;
  /** 自己声明了、但 TINT_HEAD 里已经有了 → 重复声明，直接编译失败。 */
  headClashes: string[];
  written: Map<string, string>;
  undeclared: Set<string>;
  /** 完全没写任何自定义 uniform（说明这个 def 只有默认着色）。 */
  skipped: boolean;
}

function probeTint(id: string): Probe | null {
  const def = getGenerator(id);
  if (!def || def.kind !== 'sim') return null;

  const empty: Probe = {
    own: new Map(),
    headClashes: [],
    written: new Map(),
    undeclared: new Set(),
    skipped: true,
  };
  // 没有自定义着色 / 没有派发函数 → 走共享 TINT_FRAG，这里没什么可查的。
  if (def.tintFragment === undefined || def.setTintUniforms === undefined) return empty;

  const own = parseUniforms(def.tintFragment);
  const declared = new Map<string, string>([...parseUniforms(TINT_HEAD), ...own]);
  const { gl, locs, written, undeclared } = makeStubGl(declared, HEAD_OWNED);

  const values: Record<string, number | string> = {};
  for (const p of def.params) values[p.key] = p.defaultValue;

  const ctx = {
    t: 1,
    frame: 30,
    seed: 12345,
    w: 160,
    h: 160,
    fps: 30,
    grid: { bpm: 120, offset: 0, beatsPerBar: 4 },
    clip: {} as SourceClip,
    features: emptyFeatures(),
  } satisfies AlgoUniformCtx;

  def.setTintUniforms(gl, locs, values, ctx);

  return {
    own,
    headClashes: [...own.keys()].filter((n) => HEAD_OWNED.has(n)),
    written,
    undeclared,
    skipped: false,
  };
}

const ALL = listGenerators().map((g) => g.id);
const SIM = ALL.filter((id) => getGenerator(id)?.kind === 'sim');
/** 声明了自定义着色的 sim —— 真需要被查的那批。 */
const CUSTOM_TINT = SIM.filter((id) => {
  const def = getGenerator(id)!;
  return def.kind === 'sim' && def.tintFragment !== undefined && def.setTintUniforms !== undefined;
});

describe('sim 自定义着色接线自检', () => {
  test('注册表里确实有 sim（自检本身要有覆盖面）', () => {
    expect(SIM.length, '一个 sim 都没有，这条守卫是空转的').toBeGreaterThanOrEqual(2);
  });

  // 这条是**刻意**会红的：`test.each` 空数组会静默全绿 —— 一个「没有覆盖面」
  // 的守卫比没有守卫更坏，因为它看起来在守着什么。真加了自定义着色的 sim
  // 之后这条自然变绿。
  test('至少有一个 sim 用了自定义着色（否则上面几条 test.each 都是空转）', () => {
    expect(
      CUSTOM_TINT.length,
      '没有任何 sim 声明 tintFragment → 上面四条 test.each 一条都没跑',
    ).toBeGreaterThan(0);
  });

  test('声明了自定义着色的 sim 一定有 setTintUniforms', () => {
    // 只有 tintFragment 没有 setTintUniforms 是可编译的，但那意味着它声明不了
    // 任何私有 uniform（否则永远拿不到值）—— 要么两个都有，要么两个都没有。
    const orphans = SIM.filter((id) => {
      const def = getGenerator(id)!;
      if (def.kind !== 'sim') return false;
      const hasFrag = def.tintFragment !== undefined;
      const hasSetter = def.setTintUniforms !== undefined;
      return hasFrag !== hasSetter;
    });
    expect(
      orphans,
      'tintFragment 与 setTintUniforms 必须成对出现（缺一个 = 私有 uniform 拿不到值）',
    ).toEqual([]);
  });

  test.each(CUSTOM_TINT)('%s：tint 没有重复声明 TINT_HEAD 里的 uniform', (id) => {
    const probe = probeTint(id)!;
    expect(probe.headClashes, `${id} 与 TINT_HEAD 重复声明 → 编译失败`).toEqual([]);
  });

  test.each(CUSTOM_TINT)('%s：tint 声明的 uniform 都被 setTintUniforms 写到', (id) => {
    const probe = probeTint(id)!;
    const missed = [...probe.own.keys()].filter(
      (n) => !HEAD_OWNED.has(n) && !probe.written.has(n),
    );
    expect(
      missed,
      `${id} 的 tint 声明了却没写 → 这些 uniform 恒为默认值且不报错`,
    ).toEqual([]);
  });

  test.each(CUSTOM_TINT)('%s：写 tint uniform 的类型与声明一致', (id) => {
    const probe = probeTint(id)!;
    expect(
      typeMismatches(probe.written, probe.own),
      `${id} 的 tint 写入类型与声明不匹配 → GL INVALID_OPERATION 且静默不写`,
    ).toEqual([]);
  });

  test.each(CUSTOM_TINT)('%s：tint 没有摸到未声明的 uniform', (id) => {
    const probe = probeTint(id)!;
    expect([...probe.undeclared], `${id} 的 tint 摸了不存在的 uniform → 名字拼错了`).toEqual([]);
  });

  test('自定义着色的 program 名与预编译名一致（撞名就会拿错 program）', () => {
    for (const id of CUSTOM_TINT) {
      const name = algoTintProgramName(id);
      expect(name).toBe(`algo-tint-${id}`);
      // 不能和 realtime 生成器的名字撞（同一个 Kit.quad 按名缓存 program）
      expect(name).not.toBe(`algo-${id}`);
    }
  });
});

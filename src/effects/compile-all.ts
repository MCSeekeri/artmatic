/**
 * compile-all.ts — 把一个渲染上下文里**所有特效与实时算法**的着色器预先编译一遍。
 *
 * 试炼场的「全部编译」按钮用它：artmatic 的着色器是**惰性编译**的
 * （`effects/runner.ts` 首次用到某个 defId 才 `kit.quad(...)`），所以一个
 * 语法错误的 GLSL 在你点到它之前不会报错。批量编译把这类错误提前成一张清单。
 *
 * 为什么不用改 runner / kit 就能做到：`Kit.quad(fs, name)` **按名字缓存**
 * （engine/kit.ts 的 `programs` Map），而 runner 用的名字是 `fx-${defId}`、
 * 实时算法用的是 `algo-${defId}`。这里用**同名**调一次，命中的就是运行期
 * 那一个 program —— 预编译不是"另编一份"，是真的把运行期要用的那份编好。
 *
 * 因此本文件是**纯新增**：生产代码零调用，不引入钩子，回退成本为零。
 * 编译失败时 `new Program` 抛错且不写缓存，所以失败项下次仍会重编，
 * 不存在"坏 program 被缓存住"的污染。
 *
 * 覆盖面：所有特效的主 pass **与 pre-pass** + 所有 `realtime` 算法 + 所有转场。
 * 未覆盖 —— 算法的 `bake` / `sim` 通路共用的 reveal / tint program
 * （定义在 algo/runtime.ts 内部且未导出）。
 *
 * ## 转场这一批为什么非编不可
 *
 * 122 条第三方 GLSL，混着按 GLSL ES 1.00 写的、以及声明了规范之外 uniform 的。
 * 我们只做了两条最小改写（见 transitions/glsl.ts），够不够**只能靠编译回答**。
 * 目录层（transitions/catalog.ts）已经把结构性不可能的条目拒掉了，但
 * 「拒得掉的结构问题和编不过的语法问题」是两回事。
 *
 * 代价要知道：122 次编译，本机量级是秒级（重的几条有 voronoi / fbm 循环）。
 * 所以它是按钮与 E2E 的动作，**不在启动路径上**。
 */

import { getEffect, listEffects } from './registry';
import { getGenerator, listGenerators } from '../algos/registry';
import { ALGO_HEAD, algoProgramName } from '../algos/shader-lib';
import { listTransitions } from './transitions/registry';
import { EFFECT_HEAD, effectProgramName } from './shader-def';
import type { Kit } from '../engine/kit';

export interface CompileResult {
  id: string;
  ok: boolean;
  error?: string;
}

function message(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/**
 * 编译一个特效的全部 program（主 pass + 每一环 pre-pass）。
 * 名字走 `effectProgramName`，与 effects/runner.ts 同源。
 */
export function compileAllEffects(kit: Kit): CompileResult[] {
  const out: CompileResult[] = [];
  for (const { id } of listEffects()) {
    const entry = getEffect(id);
    if (!entry) {
      out.push({ id, ok: false, error: `注册表里没有 ${id}` });
      continue;
    }
    try {
      kit.quad(EFFECT_HEAD + entry.shader.fragment, effectProgramName(id));
      const pre = entry.shader.prePasses ?? [];
      for (let i = 0; i < pre.length; i++) {
        kit.quad(EFFECT_HEAD + pre[i]!.fragment, effectProgramName(id, i));
      }
      out.push({ id, ok: true });
    } catch (e) {
      out.push({ id, ok: false, error: message(e) });
    }
  }
  return out;
}

/** 编译全部 `realtime` 算法的着色器。名字与 algos/runtime.ts 同源。 */
export function compileAllAlgoShaders(kit: Kit): CompileResult[] {
  const out: CompileResult[] = [];
  for (const { id, kind } of listGenerators()) {
    if (kind !== 'realtime') continue;
    const def = getGenerator(id);
    if (!def || def.kind !== 'realtime') {
      out.push({ id, ok: false, error: `注册表里没有 ${id}` });
      continue;
    }
    try {
      kit.quad(ALGO_HEAD + def.fragment, algoProgramName(id));
      out.push({ id, ok: true });
    } catch (e) {
      out.push({ id, ok: false, error: message(e) });
    }
  }
  return out;
}

export interface CompileAllOutcome {
  results: CompileResult[];
  okCount: number;
  total: number;
}

/**
 * 编译全部转场。名字与 `transitions/runner.ts` 的 `tr-${id}` 一致，
 * 所以命中的就是运行期那一份 program（预编译不是"另编一份"）。
 */
export function compileAllTransitions(kit: Kit): CompileResult[] {
  return listTransitions().map((entry) => {
    try {
      kit.quad(entry.fragment, `tr-${entry.id}`);
      return { id: entry.id, ok: true };
    } catch (e) {
      return { id: entry.id, ok: false, error: message(e) };
    }
  });
}

export function compileAll(kit: Kit): CompileAllOutcome {
  const results = [
    ...compileAllEffects(kit),
    ...compileAllAlgoShaders(kit),
    ...compileAllTransitions(kit),
  ];
  return {
    results,
    okCount: results.filter((r) => r.ok).length,
    total: results.length,
  };
}

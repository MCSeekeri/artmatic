/**
 * transitions/runner.ts — 转场执行器：把一条转场跑在两张全帧层上。
 *
 * 与 `effects/runner.ts` 同构（`Kit.quad` 按名字缓存 → 惰性编译 + 命中运行期
 * 那一份 program，所以 `compile-all.ts` 的预编译不是"另编一份"）。
 *
 * ## 两个降级出口，都不许让整帧渲染抛错
 *
 * `Renderer.renderFrame` 里抛异常 = 预览整个停住。所以：
 *
 *   1. **目录里没有这个 id** —— 工程可能来自更新的版本。退化为内置 dissolve
 *      并记台账（不 pass-through `to`：那会让用户以为转场"生效了但不明显"）。
 *   2. **这条着色器编译失败** —— 同样退化为 dissolve。失败是**粘性**的：
 *      着色器编译失败不是瞬态，不能每帧重试（每帧重编一次大着色器会拖垮预览）。
 *
 * 两条都记进 `transitionCompileFailures()`，并由
 * `effects/compile-all.ts::compileAllTransitions` 在 E2E 里先一步拦住
 * （正常流程下这个台账应当是空的）。
 *
 * ## 诊断信息为什么用英文
 *
 * 这两条紧挨着 GL 驱动吐出来的日志（`compile tr-xxx.frag: ERROR: 0:12 …`），
 * 那是英文。中文诊断 + 英文驱动日志混排更难读。所以这里刻意不走
 * `i18n/locales`（也就不会命中 `tests/unit/i18n.test.ts` 的硬编码守卫）。
 */

import type { TransitionRunner } from '../../engine/compositor';
import type { Kit, Program } from '../../engine/kit';
import { BUILTIN_DISSOLVE_BODY, wrapTransitionFragment } from './glsl';
import { fillTransitionValues, writeTransitionUniforms } from './params';
import { getTransition } from './registry';
import type { TransitionEntry } from './types';

/** 内置 dissolve 的 id（台账里用它，与上游条目区分）。 */
export const BUILTIN_DISSOLVE_ID = 'builtin-dissolve';

const failures = new Map<string, string>();

/** 编译失败 / 找不到条目的台账。正常状态下是空的。 */
export function transitionCompileFailures(): ReadonlyMap<string, string> {
  return failures;
}

export function createTransitionRunner(kit: Kit): TransitionRunner {
  const programs = new Map<string, Program>();
  // 内置 dissolve 没有参数，也没有依赖 uniform 的全局量 —— 空集合即可。
  const fallback = kit.quad(
    wrapTransitionFragment(BUILTIN_DISSOLVE_BODY, new Set()),
    'tr-builtin-dissolve',
  );

  const programFor = (entry: TransitionEntry): Program | null => {
    // 粘性失败：不重试。理由见文件头。
    if (failures.has(entry.id)) return null;
    const cached = programs.get(entry.id);
    if (cached) return cached;
    try {
      // 名字必须是 `tr-${id}`：compile-all.ts 用同一个名字预编译，命中同一份缓存。
      const p = kit.quad(entry.fragment, `tr-${entry.id}`);
      programs.set(entry.id, p);
      return p;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      failures.set(entry.id, msg);
      console.error(`[transition ${entry.id}] compile failed, falling back to dissolve: ${msg}`);
      return null;
    }
  };

  return (defId, values, from, to, progress, ratio, dst) => {
    const entry = getTransition(defId);
    if (!entry && !failures.has(defId)) {
      const msg = 'not in catalog (project may be from a newer version)';
      failures.set(defId, msg);
      console.warn(`[transition ${defId}] ${msg}, falling back to dissolve`);
    }

    const prog = entry ? programFor(entry) : null;
    const active = prog ?? fallback;

    active.use();
    active
      .tex('from', from.tex)
      .tex('to', to.tex)
      // `ratio` 是 float（width / height），见 GL Transition Spec v1。
      .u('progress', progress)
      .u('ratio', ratio);
    if (prog && entry) {
      // 先补齐缺键（工程可能存于该转场加参数之前），再写 uniform。
      const filled = fillTransitionValues(entry.params, values);
      writeTransitionUniforms(kit.gl, prog.uniforms, entry.uniforms, filled);
    }
    kit.pass(active, dst);
  };
}

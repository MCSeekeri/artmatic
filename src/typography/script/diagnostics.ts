/**
 * script/diagnostics.ts — 脚本的**运行期诊断**（不进 doc）。
 *
 * 为什么单独放：脚本每帧都在求值，错误 / 耗时 / 超预算如果写回文档，会
 * 让工程每一帧都变脏（还会把 `docHash` 打穿）。这些是「这次运行怎么样」，
 * 与「文档是什么」是两件事 —— 与 `typography/runtime.ts` 的 `stats()` 同构。
 *
 * 只存 **code + detail**：句子在 `typography.ts` 的文案表里（`src/` 下不允许
 * 中文字面量）。`detail` 是引擎/我们自己给的英文细节（行号、属性名）。
 */

export type ScriptDiagnosticCode =
  | 'compile-failed'
  | 'runtime-error'
  | 'async-return'
  | 'budget-writes'
  | 'budget-time'
  | 'slow'
  | 'no-element'
  | 'path-only';

export interface ScriptDiagnostic {
  scriptId: string;
  name: string;
  code: ScriptDiagnosticCode;
  /** 非文案细节：JS 引擎的错误消息、属性名、元素 id。 */
  detail: string;
  /** 发生时的帧号（可能是负数：转场前半段）。 */
  frame: number;
  /** 该条脚本本次耗时（ms）。 */
  elapsedMs: number;
  /** 同一条诊断的重复次数（每帧都炸时不刷屏，只涨计数）。 */
  repeats: number;
  /** 最近一次发生的时刻（`Date.now`，仅用于 UI 排序 / 去抖，不参与求值）。 */
  at: number;
}

const MAX = 64;
const byScript = new Map<string, ScriptDiagnostic>();
let rev = 0;
const listeners = new Set<() => void>();

function bump(): void {
  rev++;
  for (const fn of [...listeners]) fn();
}

export function reportScriptDiagnostic(
  d: Omit<ScriptDiagnostic, 'repeats' | 'at'>,
): void {
  const prev = byScript.get(d.scriptId);
  const same = prev && prev.code === d.code && prev.detail === d.detail;
  byScript.set(d.scriptId, {
    ...d,
    repeats: same ? prev.repeats + 1 : 1,
    at: Date.now(),
  });
  if (byScript.size > MAX) {
    const first = byScript.keys().next().value;
    if (first !== undefined) byScript.delete(first);
  }
  /*
   * 同一条诊断每帧都会再来一次（脚本在播放）。**只有内容变化时才通知订阅者**：
   * 否则面板会在播放时每帧重渲染一次，而屏幕上显示的东西一个字都没变。
   * 重复次数仍然在涨，用户下次看面板时读到的就是累计值。
   */
  if (!same) bump();
}

export function clearScriptDiagnostic(scriptId: string): void {
  if (byScript.delete(scriptId)) bump();
}

/** 文档视图 / 脚本面板用：只取当前文档里那些脚本 id 的诊断。 */
export function scriptDiagnosticsFor(scriptIds: readonly string[]): ScriptDiagnostic[] {
  const out: ScriptDiagnostic[] = [];
  for (const id of scriptIds) {
    const d = byScript.get(id);
    if (d) out.push(d);
  }
  return out;
}

export function scriptDiagnosticsRevision(): number {
  return rev;
}

export function subscribeScriptDiagnostics(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/** 测试钩子。 */
export function resetScriptDiagnostics(): void {
  byScript.clear();
  bump();
}

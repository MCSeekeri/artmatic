/**
 * script/run.ts — 每帧求值的**唯一入口**（舞台与光栅化都只调它）。
 *
 * 顺序（不可换）：
 *   回滚上一帧的写入 → 逐条编译/执行 → 记下这一帧的撤销日志
 *
 * 「回滚上一帧」是「同一 t 两次求值逐字节相同」与「倒退 seek 不累积」的
 * 结构保证（见 `baseline.ts`）。光栅化每帧都是新 DOM，回滚是空操作；
 * 舞台复用 DOM，靠它把脚本的痕迹擦干净。
 *
 * 时间来源只有 `localSec` / `fps`（硬约束 1.1）。这里的 `performance.now()`
 * 只用于**预算诊断**，不参与任何画面求值 —— 把它换成 `0` 画面也不会变。
 */

import type { TypographyDocument } from '../document';
import { createBudget, createScriptContext, ScriptApiError } from './api';
import { commitScriptWrites, createWriteLog, undoScriptWrites, type ScriptWriteLog } from './baseline';
import { compileScript } from './compile';
import { reportScriptDiagnostic, type ScriptDiagnosticCode } from './diagnostics';
import { SCRIPT_LIMITS } from './model';

export interface ScriptRunInput {
  doc: TypographyDocument;
  /** 文档根（含 `[data-el-id]`）；舞台传 `.paper` 也行（自己往下找见 api）。 */
  root: HTMLElement;
  /** 片段内本地秒。 */
  localSec: number;
  fps: number;
  /** 片段时长（秒）。 */
  duration: number;
  /** 工程种子（`Project.seed`）。 */
  seed: number;
  /** 总开关（UiPrefs.runTypoScripts）。false = 不执行、并把上一帧的写入回滚。 */
  active: boolean;
  debug?: boolean;
}

export interface ScriptRunError {
  scriptId: string;
  code: ScriptDiagnosticCode;
  detail: string;
}

export interface ScriptRunReport {
  ran: number;
  disabled: boolean;
  errors: ScriptRunError[];
  elapsedMs: number;
  overBudget: boolean;
  writes: number;
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

function mapApiCode(err: ScriptApiError): ScriptDiagnosticCode {
  switch (err.code) {
    case 'writes':
      return 'budget-writes';
    case 'time':
      return 'budget-time';
    case 'path-only':
      return 'path-only';
    case 'no-canvas':
    case 'bad-var':
      return 'runtime-error';
  }
}

export function runScripts(input: ScriptRunInput): ScriptRunReport {
  const startedAll = performance.now();
  const errors: ScriptRunError[] = [];

  // 先回滚上一帧：停用 / 删脚本之后画面必须回到文档原样，而不是停在最后一帧。
  undoScriptWrites(input.root);

  if (!input.active) {
    return { ran: 0, disabled: true, errors, elapsedMs: 0, overBudget: false, writes: 0 };
  }

  const scripts = (input.doc.scripts ?? []).filter((s) => s.enabled && s.code.trim().length > 0);
  if (!scripts.length) {
    return { ran: 0, disabled: false, errors, elapsedMs: 0, overBudget: false, writes: 0 };
  }

  const log: ScriptWriteLog = createWriteLog();
  // 总写入次数在多条脚本之间平分：一条失控的脚本不该把整帧的预算吃完。
  const perScriptWrites = Math.max(64, Math.floor(SCRIPT_LIMITS.maxWrites / scripts.length));
  let ran = 0;
  let overBudget = false;

  for (const [index, script] of scripts.entries()) {
    const compiled = compileScript(script.code);
    if (!compiled.ok) {
      const code: ScriptDiagnosticCode = 'compile-failed';
      errors.push({ scriptId: script.id, code, detail: compiled.detail });
      reportScriptDiagnostic({
        scriptId: script.id,
        name: script.name,
        code,
        detail: compiled.detail,
        frame: Math.round(input.localSec * input.fps),
        elapsedMs: 0,
      });
      continue;
    }

    const budget = createBudget(perScriptWrites, SCRIPT_LIMITS.hardMs);
    const ctx = createScriptContext({
      root: input.root,
      doc: input.doc,
      localSec: input.localSec,
      fps: input.fps,
      duration: input.duration,
      seed: input.seed,
      scriptIndex: index,
      log,
      budget,
      debug: input.debug,
    });

    const t0 = performance.now();
    try {
      const ret = compiled.compiled.run(ctx);
      if (ret && typeof (ret as { then?: unknown }).then === 'function') {
        // 异步会让「等待期间 DOM 已被下一帧替换」，且导出循环没有 await 它的位置。
        const code: ScriptDiagnosticCode = 'async-return';
        const detail = 'script returned a Promise; scripts must be synchronous';
        errors.push({ scriptId: script.id, code, detail });
        reportScriptDiagnostic({
          scriptId: script.id,
          name: script.name,
          code,
          detail,
          frame: ctx.frame,
          elapsedMs: performance.now() - t0,
        });
      } else {
        ran++;
      }
    } catch (err) {
      const code: ScriptDiagnosticCode =
        err instanceof ScriptApiError ? mapApiCode(err) : 'runtime-error';
      if (code === 'budget-time' || code === 'budget-writes') overBudget = true;
      const detail = errorMessage(err);
      errors.push({ scriptId: script.id, code, detail });
      reportScriptDiagnostic({
        scriptId: script.id,
        name: script.name,
        code,
        detail,
        frame: ctx.frame,
        elapsedMs: performance.now() - t0,
      });
    }

    const elapsed = performance.now() - t0;
    if (elapsed > SCRIPT_LIMITS.softMs && !errors.some((e) => e.scriptId === script.id)) {
      // 软预算只提示，不中断 —— 一条 6ms 的脚本画面上是对的，没必要杀掉它。
      reportScriptDiagnostic({
        scriptId: script.id,
        name: script.name,
        code: 'slow',
        detail: `${elapsed.toFixed(2)} ms (soft limit ${SCRIPT_LIMITS.softMs} ms)`,
        frame: ctx.frame,
        elapsedMs: elapsed,
      });
    }
  }

  commitScriptWrites(input.root, log);

  return {
    ran,
    disabled: false,
    errors,
    elapsedMs: performance.now() - startedAll,
    overBudget,
    writes: log.writes(),
  };
}

/**
 * script/compile.ts — 用户脚本 → 可执行函数（含**软沙箱**）。
 *
 * ## 为什么是 `new Function` 而不是 Worker / iframe
 *
 * 脚本要写 DOM（样式、SVG 属性、canvas），而 Worker 没有 DOM；iframe 里的
 * 文档又进不了 snapDOM 的截图（`<foreignObject>` 不会执行子文档）。所以执行
 * 只能在主 realm —— 与插件同一个信任模型。
 *
 * ## ⚠️ 这不是安全边界
 *
 * 下面遮蔽的全局（`Math.random` / `Date.now` / 网络 / 存储 / 定时器）挡的是
 * **确定性与误用**，不是恶意代码：`(function(){}).constructor` 之类反射仍能
 * 拿回真全局。真正的边界是「脚本默认不运行，用户手动开启」（见 UiPrefs 的
 * `runTypoScripts`）。文档与界面都不许暗示这里安全。
 *
 * ## 代码形态
 *
 * 用户写的是**函数体**，`ctx` 在作用域里：
 *
 * ```js
 * const el = ctx.el('title');
 * el.style({ opacity: String(ctx.t) });
 * ```
 *
 * 编译成 `new Function('ctx', <遮蔽…>, '"use strict";' + code)`。
 * 不支持表达式形态（`(ctx) => …`）—— 两种形态并存会让「报错行号差一行」
 * 变成第三个需要解释的约定。
 */

import { codeHash } from './model';

export interface CompiledScript {
  /** 执行函数。返回值交给 `run.ts` 检查（Promise 会被拒）。 */
  run: (ctx: unknown) => unknown;
}

export type CompileResult =
  | { ok: true; compiled: CompiledScript }
  | { ok: false; detail: string };

/** 遮蔽的形参名。顺序即 `new Function` 的形参顺序，改动要同步 `SHADOWS`。 */
const SHADOW_NAMES = [
  'Math',
  'Date',
  'performance',
  'window',
  'document',
  'globalThis',
  'self',
  'fetch',
  'XMLHttpRequest',
  'WebSocket',
  'Worker',
  'localStorage',
  'sessionStorage',
  'setTimeout',
  'setInterval',
  'requestAnimationFrame',
  'queueMicrotask',
  'Function',
] as const;

function blocked(what: string): (...args: unknown[]) => never {
  return () => {
    throw new Error(`${what} is not available in typography scripts (use the ctx API)`);
  };
}

function sandboxMath(): Record<string, unknown> {
  const out: Record<string, unknown> = Object.create(null);
  for (const key of Object.getOwnPropertyNames(Math)) {
    if (key === 'random') continue;
    out[key] = (Math as unknown as Record<string, unknown>)[key];
  }
  out.random = blocked('Math.random');
  return Object.freeze(out);
}

function sandboxDate(): unknown {
  const Ctor = function Date(): never {
    throw new Error('Date is not available in typography scripts (time is ctx.t)');
  } as unknown as Record<string, unknown>;
  Ctor.now = blocked('Date.now');
  Ctor.parse = (Date as unknown as Record<string, unknown>).parse;
  Ctor.UTC = (Date as unknown as Record<string, unknown>).UTC;
  return Object.freeze(Ctor);
}

const PERF = Object.freeze({ now: blocked('performance.now') });
const STORE = Object.freeze({
  getItem: blocked('localStorage.getItem'),
  setItem: blocked('localStorage.setItem'),
  removeItem: blocked('localStorage.removeItem'),
});
const SHADOWS: readonly unknown[] = [
  sandboxMath(),
  sandboxDate(),
  PERF,
  undefined, // window
  undefined, // document
  undefined, // globalThis
  undefined, // self
  blocked('fetch'),
  blocked('XMLHttpRequest'),
  blocked('WebSocket'),
  blocked('Worker'),
  STORE,
  STORE,
  blocked('setTimeout'),
  blocked('setInterval'),
  blocked('requestAnimationFrame'),
  blocked('queueMicrotask'),
  blocked('Function'),
];

/**
 * 编译缓存：按 `代码哈希 + 长度` 记住上一次的编译结果。
 *
 * 舞台每帧都要取一次函数，而编译一秒钟能做上千次 —— 但这里缓存的是**整个
 * 编译过程**，命中率极高（代码只在编辑时变）。上限 32 条：超出直接清空，
 * 不做 LRU —— 同时打开 32 段不同脚本属于异常场景，清空只多一次编译。
 */
const cache = new Map<string, CompileResult>();
const CACHE_MAX = 32;

function errorDetail(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

export function compileScript(code: string): CompileResult {
  const key = `${codeHash(code)}:${code.length}`;
  const hit = cache.get(key);
  if (hit) return hit;

  let result: CompileResult;
  try {
    // eslint-disable-next-line no-new-func
    const factory = new Function(
      'ctx',
      ...SHADOW_NAMES,
      `"use strict";
const console = {
  log: (...a) => ctx.log(...a),
  info: (...a) => ctx.log(...a),
  warn: (...a) => ctx.log(...a),
  error: (...a) => ctx.log(...a),
  debug: (...a) => ctx.log(...a),
};
${code}`,
    ) as (...args: unknown[]) => unknown;
    result = {
      ok: true,
      compiled: {
        run: (ctx: unknown) => factory(ctx, ...SHADOWS),
      },
    };
  } catch (err) {
    result = { ok: false, detail: errorDetail(err) };
  }

  if (cache.size >= CACHE_MAX) cache.clear();
  cache.set(key, result);
  return result;
}

/**
 * 只做语法检查，**不执行**。agent 写入前用它把错误挡在改动之前
 * （否则用户会得到一条「看起来写成功、跑起来没反应」的脚本）。
 */
export function checkScriptSyntax(code: string): { ok: true } | { ok: false; detail: string } {
  const r = compileScript(code);
  return r.ok ? { ok: true } : { ok: false, detail: r.detail };
}

/** 测试钩子：清空编译缓存（不影响运行中的脚本）。 */
export function clearCompileCache(): void {
  cache.clear();
}

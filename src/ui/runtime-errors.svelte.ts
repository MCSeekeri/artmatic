/**
 * runtime-errors.svelte.ts — 未捕获错误 / 未处理 Promise 的**进程内**记录。
 *
 * 目的不是「兜住异常继续跑」——未捕获错误该中断就中断 —— 而是让用户能看见
 * 「刚才那一下为什么没反应」，并把可复制的诊断信息交出来。底栏只显示一条
 * 计数，详情在 Modal 里（见 `StatusBar.svelte`）。
 *
 * 三条边界：
 *   · 只在浏览器里安装（单测 / SSR 没有 window）；
 *   · 同一条 message 2 秒内只记一次：一个渲染循环里的重复抛错不该刷满列表；
 *   · 只留最近 5 条错误 + 最近 10 条 `console.error`。这是诊断线索，不是日志系统。
 */

export interface RuntimeErrorRecord {
  id: number;
  source: 'error' | 'rejection';
  message: string;
  stack: string;
  /** `Date.now()`：界面诊断用，不参与渲染求值。 */
  at: number;
}

const MAX_ERRORS = 5;
const MAX_CONSOLE = 10;
const DEDUPE_MS = 2000;
const INSTALLED_KEY = '__artmaticErrorCaptureInstalled';
const CONSOLE_KEY = '__artmaticConsoleErrorCaptureInstalled';

let errors = $state<RuntimeErrorRecord[]>([]);
let seq = 0;
const consoleLines: string[] = [];

/** 当前要显示的错误（最新在前）。 */
export function runtimeErrors(): RuntimeErrorRecord[] {
  return errors;
}

export function clearRuntimeErrors(): void {
  errors = [];
}

/** 最近的 `console.error` 文本（最多 10 条）。 */
export function recentConsoleErrors(): readonly string[] {
  return consoleLines;
}

function stringify(v: unknown): string {
  if (typeof v === 'string') return v;
  if (v instanceof Error) return v.stack || `${v.name}: ${v.message}`;
  try {
    return JSON.stringify(v) ?? String(v);
  } catch {
    return String(v);
  }
}

function push(source: RuntimeErrorRecord['source'], reason: unknown): void {
  const message =
    reason instanceof Error ? reason.message : typeof reason === 'string' ? reason : stringify(reason);
  const stack = reason instanceof Error ? reason.stack ?? '' : '';
  const now = Date.now();
  if (errors.some((e) => e.message === message && now - e.at < DEDUPE_MS)) return;
  errors = [{ id: ++seq, source, message, stack: stack || stringify(reason), at: now }, ...errors].slice(
    0,
    MAX_ERRORS,
  );
}

/**
 * 安装全局捕获。幂等（HMR / 重复 import 不会把 console.error 包两层）。
 * 在 `main.ts` 最早的同步段调用 —— 能力闸门之前，闸门自己抛错也能记下来。
 */
export function installErrorCapture(): void {
  if (typeof window === 'undefined') return;
  const w = window as unknown as Record<string, unknown>;
  if (w[INSTALLED_KEY]) return;
  w[INSTALLED_KEY] = true;

  window.addEventListener('error', (e) => {
    /*
     * 只记**真正的 JS 异常**（`e.error` 有值）。资源加载失败（img/script 404）
     * 也会触发 error 事件，但没有 error 对象 —— 把缺一张缩略图当成运行错误
     * 只会让底栏常亮一条没人能处理的提示。跨域脚本的「Script error.」同理。
     */
    if (e.error) push('error', e.error);
  });
  window.addEventListener('unhandledrejection', (e) => {
    push('rejection', e.reason);
  });

  if (!w[CONSOLE_KEY]) {
    w[CONSOLE_KEY] = true;
    const original = console.error.bind(console);
    console.error = (...args: unknown[]): void => {
      const line = args.map(stringify).join(' ');
      consoleLines.push(line);
      if (consoleLines.length > MAX_CONSOLE) consoleLines.shift();
      original(...args);
    };
  }
}

/** 复制到剪贴板的完整诊断文本：版本 / 路由 / UA / 错误 / 最近 console.error。 */
export function diagnosticText(): string {
  const version = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : 'dev';
  const href = typeof location !== 'undefined' ? location.href : '-';
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '-';
  const lines = [
    `Artmatic ${version}`,
    `URL: ${href}`,
    `UA: ${ua}`,
    '',
    'Runtime errors:',
    ...(errors.length
      ? errors.map(
          (e) =>
            `[${new Date(e.at).toISOString()}] ${e.source}: ${e.message}\n${e.stack}`,
        )
      : ['(none)']),
    '',
    'Recent console.error:',
    ...(consoleLines.length ? consoleLines : ['(none)']),
  ];
  return lines.join('\n');
}

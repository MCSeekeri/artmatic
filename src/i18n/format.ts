/**
 * format.ts — 占位符插值。纯函数，不碰任何 locale 状态，可单测。
 *
 * 语法只有一条：`{名字}`。中文没有单复数，所以刻意不做 plural ——
 * 真需要时加一个显式的 count 分支，不引 ICU 那套消息格式。
 */

export type MessageVars = Record<string, string | number>;

/**
 * 缺参数时**原样保留占位符**（返回 `{name}`），不返回空串。
 *
 * 理由：「已打开「」」这种缺字看起来像数据本身是空的，会把排查引向错误方向；
 * 而「已打开「{dir}」」一眼就知道是漏传了参数。两种都错，但后者可诊断。
 */
export function interpolate(template: string, vars?: MessageVars): string {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (whole, name: string) =>
    Object.prototype.hasOwnProperty.call(vars, name) ? String(vars[name]) : whole,
  );
}

/**
 * 抽出模板里用到的占位符名。只给测试用（断言「声明的参数都被用上」）。
 */
export function placeholdersOf(template: string): string[] {
  const out = new Set<string>();
  for (const m of template.matchAll(/\{(\w+)\}/g)) out.add(m[1]!);
  return [...out];
}

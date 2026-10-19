/**
 * format.ts — 数值 → 人类可读文本的纯格式化。
 *
 * 只在**用户看得见**的提示里用（底栏 flash、面板提示）。渲染路径不要拿它做
 * 任何判据：它是有损的展示层，`1.0 MB` 与 `1.04 MB` 是两种不同的真相。
 *
 * 放在 `core/` 是因为两类调用方都需要它：`ui/`（导出面板、媒体池）与
 * `project/`（打开工程时的孤儿素材报告）。后者不能 import `ui/`。
 */

/**
 * 体积的可读文本。
 *
 * 口径与原 `ui/export.ts::fmtSize` **逐字一致**（B 不带小数、KB 取整、
 * MB 一位、GB 两位）：面板上的体积提示不该因为一次重构换一种写法。
 */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 1024) return `${Math.max(0, Math.round(bytes))} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

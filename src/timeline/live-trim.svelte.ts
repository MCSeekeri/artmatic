/**
 * live-trim.svelte.ts — 正在拖片段首尾裁剪的**视图状态**（v13）。
 *
 * 只为一件事存在：拖动中让片段的显示名「跟着被裁掉」，松手后回到新左边界。
 *
 * 为什么不在 `ProjectStore` 里：它不是工程内容，不该进撤销快照，也不该被导出 /
 * Agent 看见。放在这里 = 手势层写、`ClipView` 读，两边都不必经过 store。
 *
 * 用一个容器对象而不是导出的 `let`：跨模块重新赋值导出的原始绑定在 Svelte 5 里
 * 不会传播，而改容器属性会（`$state` 是深度响应）。
 */

export type TrimEdge = 'start' | 'end';

export const liveTrim = $state<{
  /** null = 没有裁剪手势在进行。 */
  value: { clipId: string; edge: TrimEdge; anchorStart: number } | null;
}>({ value: null });

export function beginTrim(clipId: string, edge: TrimEdge, anchorStart: number): void {
  liveTrim.value = { clipId, edge, anchorStart };
}

export function endTrim(): void {
  liveTrim.value = null;
}

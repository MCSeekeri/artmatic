/**
 * curve-editor-state.svelte.ts — 曲线编辑器的开关与「片段最后编辑的属性」。
 *
 * 刻意**不放进 `app-state.svelte.ts`**：它是浮层，不是工程状态，也不该跟
 * 顶栏选项卡一起切换。任何入口（检查器的曲线按钮、时间轴右键、K 键）都只调
 * `openCurveEditor()`，不再各自维护一份「编辑器开着没」的布尔量。
 *
 * ## 多开
 *
 * 一个片段**最多一个**面板（再次打开只切属性并提到最上层），不同片段可以同时
 * 开着 —— 对比两条曲线时不用来回开关。面板的层叠顺序就是数组顺序：后开的在
 * 上面，点一下某个面板也会把它提到最上层。
 *
 * ## `lastCurve`
 *
 * 片段在时间轴上画的迷你曲线读它：**退出编辑器之后仍然保留**（用户要的是
 * 「上次在编辑器里看的那个属性」），但只在本次会话有效 —— 它是视图状态，
 * 不进工程、也不进撤销栈。属性被删掉时时间轴侧会自行回落到「不画」。
 */

export interface CurveEditorTarget {
  clipId: string;
  /** 指定要编辑的曲线；`null` = 让编辑器自己选第一条。 */
  curveKey: string | null;
  /** 默认层叠位置的下标（拖动过之后位置由面板自己记，这里只影响首次出现）。 */
  slot: number;
}

let targets = $state<CurveEditorTarget[]>([]);
/** clipId → 最后在编辑器里显示的 curve key。时间轴片段用它画迷你曲线。 */
let lastCurve = $state<Record<string, string>>({});
let nextSlot = 0;

/**
 * 打开编辑器。
 *
 * 同一片段已经开着时只切参数（保留面板位置与大小），并提到最上层；从另一个
 * 片段打开时新增一个面板，不替换原来那个。
 */
export function openCurveEditor(clipId: string, curveKey: string | null = null): void {
  const index = targets.findIndex((t) => t.clipId === clipId);
  if (index >= 0) {
    const t = targets[index]!;
    if (curveKey) t.curveKey = curveKey;
    if (curveKey) lastCurve[clipId] = curveKey;
    // 提到最上层：层叠顺序 = 数组顺序（见 App 的 `layer` 传参）。
    if (index !== targets.length - 1) {
      targets = [...targets.filter((x) => x.clipId !== clipId), t];
    }
    return;
  }
  if (targets.length === 0) nextSlot = 0;
  const key = curveKey ?? lastCurve[clipId] ?? null;
  // 层叠位置循环使用 0..5：开开关关很多次之后不会把新面板甩到屏幕外。
  targets = [...targets, { clipId, curveKey: key, slot: nextSlot++ % 6 }];
  if (key) lastCurve[clipId] = key;
}

/** 关闭一个面板；不传 clipId 时关闭全部（测试 / 换工程用）。 */
export function closeCurveEditor(clipId?: string): void {
  targets = clipId ? targets.filter((t) => t.clipId !== clipId) : [];
}

/** 切换某个片段面板里正在编辑的曲线。 */
export function setCurveEditorKey(clipId: string, curveKey: string): void {
  const t = targets.find((x) => x.clipId === clipId);
  if (!t) return;
  t.curveKey = curveKey;
  lastCurve[clipId] = curveKey;
}

/** 点一下面板 = 提到最上层（与「后开的在上面」同一份顺序）。 */
export function bumpCurveEditor(clipId: string): void {
  const index = targets.findIndex((t) => t.clipId === clipId);
  if (index < 0 || index === targets.length - 1) return;
  targets = [...targets.filter((t) => t.clipId !== clipId), targets[index]!];
}

export function curveEditorTargets(): CurveEditorTarget[] {
  return targets;
}

/**
 * 时间轴片段上要画的属性。返回的 key 可能已经被删掉 —— 调用方必须再查
 * `clip.curves[key]`（这里刻意不碰 Project，保持纯视图状态）。
 */
export function lastCurveKeyOf(clipId: string): string | null {
  return lastCurve[clipId] ?? null;
}

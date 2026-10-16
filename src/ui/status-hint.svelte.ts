/**
 * status-hint.svelte.ts — 底栏提示的状态（指针指着谁、手上正在做什么）。
 *
 * 只存**两层**：手势层与悬停层。第三层（场景）由 StatusBar 现场从 appState 取快照
 * 交给 `hints.ts` 算 —— 这个模块要能被 `timeline/drag.ts` / `timeline/marquee.ts`
 * import，那不能把 appState（连带渲染器、导出器整棵树）拉进它们的模块图。
 *
 * 与 `tooltip.svelte.ts` 的分工：那边管**悬浮气泡**（`use:tip` 的控件，鼠标停在上面
 * 350ms 后浮出来），这边管**底栏**（没有气泡的目标 + 场景状态 + 进行中的手势）。
 * 原来两者共用一份文字（底栏抄气泡），结果底栏 100% 是重复内容、还得跟着 modal 一起
 * 更新（而 modal 开着时底栏被遮罩盖住，压根看不见）—— 现在两边各管各的。
 */
import { targetKey, type Hint, type HintTarget } from './hints';

class StatusHint {
  /** 指针下的时间轴目标（Timeline 的委托 pointerover 写，离开时间轴时清）。 */
  hover = $state<HintTarget | null>(null);

  /**
   * 正在进行的手势（拖片段 / 框选）。
   *
   * **写在手势代码里，结束必须清**（与 `appState.dragIllegal` 同一条纪律）。
   * 忘了清的症状是底栏永远停在「松开放置」上，而且不会有任何报错。
   */
  gesture = $state<Hint | null>(null);

  /** 与 `hover` 并存的比较键：同一个目标重复写 `$state` 会让底栏白重渲一次。 */
  private hoverKey: string | null = null;

  setHover(target: HintTarget | null): void {
    const key = target ? targetKey(target) : null;
    if (key === this.hoverKey) return;
    this.hoverKey = key;
    this.hover = target;
  }

  clearHover(): void {
    this.setHover(null);
  }

  setGesture(hint: Hint | null): void {
    this.gesture = hint;
  }

  clearGesture(): void {
    this.gesture = null;
  }
}

export const statusHint = new StatusHint();

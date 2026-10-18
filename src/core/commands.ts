/**
 * commands.ts — 事务式撤销栈。
 *
 * 移植 angel-echo-splitter store.js 的快照模式（同作者内部移植）：
 * commit 前后各拍一次 JSON 快照，undo/redo 就是快照对换。
 * 工程是纯 JSON（典型 < 100KB），快照的代价远低于维护反向补丁的
 * 正确性风险——命令栈是「错了用户立刻发现」的部件，宁笨勿巧。
 *
 * 拖拽用手势事务：beginTx() 拍一次快照 → pointermove 期间随便改 →
 * endTx() 把整段拖拽 coalesce 成一条撤销记录。
 */

import { getLimits } from './capacity';

export class CommandStack {
  private undoStack: string[] = [];
  private redoStack: string[] = [];
  private txSnapshot: string | null = null;

  constructor(
    private readonly snapshot: () => string,
    private readonly restore: (json: string) => void,
    private readonly onChange: (label: string) => void,
  ) {}

  /**
   * 单次改动：fn 直接改状态，有变化才入栈。返回是否真的改了。
   *
   * ## 事务内不入栈
   *
   * `beginTx` 打开时，快照由**整段事务**统一提交（`endTx`）。这里若照旧逐次入栈，
   * 一次「包在事务里的多步操作」会留下 N 条中间记录：撤销一次回到事务起点（看着
   * 对），但再撤一次就落到某个中间态 —— 而那个状态用户从没见过。
   *
   * 现有的手势路径（`timeline/drag.ts`、`QuadHandles`、排版编辑器）在事务里都用
   * `touch()` 直改、不经过 `commit`，所以这条分支只影响「显式用事务包多笔 commit」
   * 的调用方（agent 的一轮对话正是这一类）。
   *
   * `onChange` 仍然每次调用：它只负责通知界面重绘（`ProjectStore` 的 version++），
   * 与「是否入栈」是两件事。事务里也必须让界面跟着动。
   */
  commit(label: string, fn: () => void): boolean {
    const before = this.snapshot();
    fn();
    if (this.snapshot() === before) return false;
    if (this.txSnapshot === null) this.pushUndo(before);
    this.onChange(label);
    return true;
  }

  /** 手势事务开始（拖拽 / 连续调参）。返回事务快照。 */
  beginTx(): string {
    this.txSnapshot = this.snapshot();
    return this.txSnapshot;
  }

  /** 手势事务结束：整段手势算一条撤销。无变化则不入栈。 */
  endTx(label: string): boolean {
    const before = this.txSnapshot;
    this.txSnapshot = null;
    if (!before) return false;
    if (this.snapshot() === before) return false;
    this.pushUndo(before);
    this.onChange(label);
    return true;
  }

  /** 手势中止（如 Esc 取消拖拽）：回滚到事务起点。 */
  cancelTx(): void {
    if (this.txSnapshot) this.restore(this.txSnapshot);
    this.txSnapshot = null;
  }

  get inTx(): boolean {
    return this.txSnapshot !== null;
  }

  /**
   * 清空两个栈。**载入另一份工程时必须调**：
   * 「撤销回上一个打开过的工程」是没人想要的行为，而且栈里躺的是
   * 上一份工程的快照，撤销会把两份工程的片段混在一起 ——
   * 那种损坏很难归因，因为每一步看起来都合法。
   */
  reset(): void {
    this.undoStack.length = 0;
    this.redoStack.length = 0;
    this.txSnapshot = null;
  }

  canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  undo(): boolean {
    const before = this.undoStack.pop();
    if (before === undefined) return false;
    this.redoStack.push(this.snapshot());
    this.restore(before);
    this.onChange('undo');
    return true;
  }

  redo(): boolean {
    const after = this.redoStack.pop();
    if (after === undefined) return false;
    this.undoStack.push(this.snapshot());
    this.restore(after);
    this.onChange('redo');
    return true;
  }

  /**
   * 入栈并把栈深夹回上限。
   *
   * 上限**每次入栈时读**（`limits.undoSteps`，按可用内存派生）而不是构造时抄一份：
   * 每条记录是一份**整工程快照**，所以「能存几步」是内存量的函数，而工程大小
   * 会随编辑增长 —— 构造时定死的话，一个排版多、曲线密的工程会悄悄把内存吃掉
   * （80 步 × 5 MB = 400 MB），而用户只看到「还能撤」。
   */
  private pushUndo(before: string): void {
    this.undoStack.push(before);
    const max = getLimits().undoSteps;
    while (this.undoStack.length > max) this.undoStack.shift();
    this.redoStack.length = 0;
  }

  /** 诊断读数：当前栈深与生效上限。 */
  depth(): { undo: number; redo: number; max: number } {
    return { undo: this.undoStack.length, redo: this.redoStack.length, max: getLimits().undoSteps };
  }
}

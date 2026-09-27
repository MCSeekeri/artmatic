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

const UNDO_MAX = 80;

export class CommandStack {
  private undoStack: string[] = [];
  private redoStack: string[] = [];
  private txSnapshot: string | null = null;

  constructor(
    private readonly snapshot: () => string,
    private readonly restore: (json: string) => void,
    private readonly onChange: (label: string) => void,
  ) {}

  /** 单次改动：fn 直接改状态，有变化才入栈。返回是否真的改了。 */
  commit(label: string, fn: () => void): boolean {
    const before = this.snapshot();
    fn();
    if (this.snapshot() === before) return false;
    this.pushUndo(before);
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

  private pushUndo(before: string): void {
    this.undoStack.push(before);
    if (this.undoStack.length > UNDO_MAX) this.undoStack.shift();
    this.redoStack.length = 0;
  }
}

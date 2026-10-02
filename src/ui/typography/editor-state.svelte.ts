/**
 * editor-state.svelte.ts — 排版编辑器的界面态（runes 单例）。
 *
 * 为什么单独一个模块而不是塞进 appState：这是**编辑器局部**的状态
 * （选中集、缩放、参考线），只有排版页和它的键盘分发用得到。放进 appState
 * 会让「时间轴的选择态」和「排版的选择态」纠缠在一起，而它们连语义都不同
 * （前者单选一个片段，后者多选若干元素）。
 *
 * 两条硬纪律：
 *  1. **选中态不进 store**（与时间轴的 selectedClipId 一致）——选择态写库会
 *     在拖拽过程中触发全量重建，把正在拖的 DOM 换掉。
 *  2. 文档写入一律经这里收口：离散改动走 store.commit（一笔撤销），
 *     手势中途走 store.touch（实时、不入栈），松手时 endTx 结算。
 *     直接改 store.project 会绕过撤销栈。
 */

import { appState } from '../app-state.svelte';
import type { Project, SourceClip } from '../../core/schema';
import {
  reorderElements,
  type TypographyDocument,
  type TypographyElement,
  type ZOrderOp,
} from '../../typography/document';
import { boundsOf, toRects, type Guide, type Rect } from '../../typography/geometry';

/** 在工程里找到某个排版片段的文档。找不到返回 null（片段可能刚被删）。 */
export function findTextDoc(project: Project, clipId: string): TypographyDocument | null {
  for (const track of project.tracks) {
    for (const clip of track.clips) {
      if (clip.id !== clipId) continue;
      if (clip.kind === 'source' && clip.source.type === 'text') return clip.source.doc;
      return null;
    }
  }
  return null;
}

class TypographyEditorState {
  /** 当前编辑的片段 id。null = 编辑器没打开。 */
  clipId = $state<string | null>(null);

  selectedIds = $state<string[]>([]);

  /** 显示缩放（1 = 文档像素 : 屏幕像素 1:1）。 */
  zoom = $state(1);

  /** 拖动中的智能参考线。松手即清空，不写库。 */
  guides = $state<Guide[]>([]);

  /** 「光栅预览」开关：把舞台换成显示真实光栅结果，用来验证所见即所得。 */
  rasterPreview = $state(false);

  /** 正在编辑文本的元素 id（P4 用）。 */
  editingTextId = $state<string | null>(null);

  private inGesture = false;

  /* ------------------------------------------------------------ 读取 */

  get clip(): SourceClip | null {
    void appState.version;
    const id = this.clipId;
    const store = appState.store;
    if (!id || !store) return null;
    const found = store.findClip(id);
    if (!found) return null;
    const c = found.clip;
    if (c.kind !== 'source' || c.source.type !== 'text') return null;
    return c;
  }

  get doc(): TypographyDocument | null {
    return this.clip?.source.type === 'text' ? this.clip.source.doc : null;
  }

  get elements(): TypographyElement[] {
    return this.doc?.elements ?? [];
  }

  get selected(): TypographyElement[] {
    const set = new Set(this.selectedIds);
    return this.elements.filter((e) => set.has(e.id));
  }

  /** 不可见的元素不参与选择（它根本不在 DOM 里，选中了也拖不动）。 */
  get selectableRects(): Rect[] {
    return toRects(this.elements.filter((e) => e.visible && !e.locked));
  }

  get selectionRect(): Rect | null {
    const sel = this.selected;
    return sel.length ? boundsOf(toRects(sel)) : null;
  }

  get canvasSize(): { w: number; h: number } {
    return this.doc?.size ?? { w: 1920, h: 1080 };
  }

  isSelected(id: string): boolean {
    return this.selectedIds.includes(id);
  }

  /* ------------------------------------------------------------ 文本编辑 */

  beginEditing(id: string): void {
    if (this.editingTextId === id) return;
    this.editingTextId = id;
  }

  /**
   * 结束文本编辑。
   *
   * **必须先 blur 再清状态**：提交逻辑挂在 `focusout` 上，而在那里读的是
   * `editingTextId` 才知道要提交哪个元素 —— 先清掉的话，用户刚打的字会被
   * 静默丢弃（而且看起来像「失焦了但没保存」这种最难描述的现象）。
   */
  stopEditing(): void {
    const active = typeof document !== 'undefined' ? (document.activeElement as HTMLElement | null) : null;
    if (active && active.isContentEditable) active.blur();
    this.editingTextId = null;
  }

  /* ------------------------------------------------------------ 生命周期 */

  open(clipId: string): void {
    if (this.clipId === clipId) return;
    this.clipId = clipId;
    this.selectedIds = [];
    this.guides = [];
    this.editingTextId = null;
  }

  close(): void {
    if (this.inGesture) this.cancelGesture();
    this.clipId = null;
    this.selectedIds = [];
    this.guides = [];
    this.editingTextId = null;
    appState.registerGestureCancel(null);
  }

  /* ------------------------------------------------------------ 选择 */

  setSelection(ids: string[]): void {
    // 去重但保序：z 序是有意义的（后选中的应当是最后绘制的）。
    const next = [...new Set(ids)];
    // 被编辑的元素不在新选择集里就收尾（提交在 focusout 里做）。
    if (this.editingTextId && !next.includes(this.editingTextId)) this.stopEditing();
    this.selectedIds = next;
  }

  selectOnly(id: string | null): void {
    this.setSelection(id ? [id] : []);
  }

  toggle(id: string): void {
    this.setSelection(
      this.selectedIds.includes(id)
        ? this.selectedIds.filter((x) => x !== id)
        : [...this.selectedIds, id],
    );
  }

  selectAll(): void {
    this.setSelection(this.selectableRects.map((r) => r.id));
  }

  clearSelection(): void {
    this.selectedIds = [];
    this.stopEditing();
  }

  /* ------------------------------------------------------------ 写入 */

  /** 离散改动：一笔撤销。 */
  commit(label: string, fn: (doc: TypographyDocument) => void): void {
    const id = this.clipId;
    if (!id) return;
    appState.store.commit(label, (p) => {
      const doc = findTextDoc(p, id);
      if (doc) fn(doc);
    });
  }

  /* 手势：beginTx → live(多次) → endTx / cancelTx。
   * 中途**不能**用 commit：每一步都会拍一次快照，一次拖拽会塞满撤销栈。 */
  beginGesture(): void {
    if (this.inGesture) return;
    appState.store.beginTx();
    this.inGesture = true;
    // 关 tab / 切页时若手势还没结算，必须回滚——否则 beginTx 悬空，
    // 之后每一次 commit 都会被并进这个事务里。
    appState.registerGestureCancel(() => this.cancelGesture());
  }

  live(fn: (doc: TypographyDocument) => void): void {
    const id = this.clipId;
    if (!id) return;
    const doc = findTextDoc(appState.store.project, id);
    if (!doc) return;
    fn(doc);
    appState.store.touch();
  }

  endGesture(label: string): void {
    if (!this.inGesture) return;
    this.inGesture = false;
    appState.store.endTx(label);
    appState.registerGestureCancel(null);
  }

  cancelGesture(): void {
    if (!this.inGesture) return;
    this.inGesture = false;
    appState.store.cancelTx();
    appState.registerGestureCancel(null);
  }

  get gestureActive(): boolean {
    return this.inGesture;
  }

  /* ------------------------------------------------------------ 常用动作 */

  nudge(dx: number, dy: number): void {
    const ids = new Set(this.selectedIds);
    if (!ids.size) return;
    this.commit('移动元素', (doc) => {
      for (const el of doc.elements) {
        if (!ids.has(el.id) || el.locked) continue;
        el.frame.x += dx;
        el.frame.y += dy;
      }
    });
  }

  /**
   * 层级调整。**唯一实现**：Ribbon 的四个按钮与图层面板的上下移都走这里，
   * 两处各写一份的话「上移一层」在两个入口下的行为迟早会不一致。
   */
  order(op: ZOrderOp): void {
    const ids = this.selectedIds;
    if (!ids.length) return;
    this.commit('调整层级', (doc) => {
      const next = reorderElements(doc, ids, op);
      doc.elements = next.elements;
    });
  }

  setZoom(z: number): void {
    this.zoom = Math.max(0.05, Math.min(4, z));
  }
}

export const editorState = new TypographyEditorState();

/**
 * keyframe-panel-state.svelte.ts — 关键帧面板的**会话级视图状态**。
 *
 * 不落库、不进撤销栈：它描述的是「我眼下在看哪个元素、选中了哪几帧」，
 * 不是工程内容（与 `editorState` 的选中态同一条纪律）。
 *
 * 关键帧用**时刻**标识而不是下标：`applyTrackTiming()` 每次写入都会重排关键帧，
 * 下标在排序之后会指向另一帧 —— 拖动一次就跳到别的点上，而画面上「看起来
 * 只是慢了一拍」。
 */

import type { KeySnapUnit } from '../../core/time';

export interface KeyframePop {
  /** 关键帧的锚点（视口坐标，菱形中心）。 */
  x: number;
  y: number;
}

/** 选中一帧：轨道 id + 时刻。 */
export interface KeySel {
  animId: string;
  t: number;
}

class KeyframePanelState {
  /** 元素列：选中的元素。null = 跟随舞台的选中集。 */
  elId = $state<string | null>(null);
  /** 属性列 / 轨道：选中的那条动画（顶栏的删轨道、行的加亮都跟着它）。 */
  animId = $state<string | null>(null);
  /**
   * 选中的关键帧。**可能多选**（框选），但只有恰好一帧时才谈得上「这一帧的
   * 值与缓动」—— 浮层和顶栏的时刻框都按这个口径判断。
   */
  keys = $state<KeySel[]>([]);
  /** 两列 aside 折叠（折叠后只剩元素列的图标位）。 */
  asideOpen = $state(true);
  /** 选中的关键帧浮层（值 + 曲线）。null = 关着。 */
  pop = $state<KeyframePop | null>(null);
  /**
   * 按住 Shift 拖关键帧时对齐到哪种刻度。
   *
   * 与面板的 `zoom` 同级：会话级视图状态，不落盘（落盘的是「面板开没开」这类
   * 布局偏好；拖动刻度换一个会话就该回到默认的「拍」）。
   */
  snapUnit = $state<KeySnapUnit>('beat');

  selectElement(id: string | null): void {
    if (this.elId === id) return;
    this.elId = id;
    this.animId = null;
    this.keys = [];
    this.pop = null;
  }

  selectTrack(id: string | null): void {
    if (this.animId === id) return;
    this.animId = id;
    this.keys = [];
    this.pop = null;
  }

  /** 点一帧：单选 + 可选地就地弹浮层。 */
  selectKey(animId: string, t: number, at?: KeyframePop): void {
    this.animId = animId;
    this.keys = [{ animId, t }];
    if (at) this.pop = at;
  }

  /** 框选：一批帧（可为空），并收起浮层。 */
  selectKeys(list: KeySel[]): void {
    this.moveKeys(list);
    this.pop = null;
  }

  /**
   * 拖动过程中把选中标记挪到新时刻（整组一起）。
   *
   * 传进来的是**当前**的完整选择集：拖动会连续改写文档，标记必须跟着走 ——
   * 否则下一帧的 `moveKey(from, to)` 会拿着一批已经不存在的时刻去找帧。
   */
  moveKeys(list: KeySel[]): void {
    this.keys = list.map((k) => ({ ...k }));
    if (list.length === 1) this.animId = list[0]!.animId;
  }

  closePop(): void {
    this.pop = null;
  }

  clearKeys(): void {
    this.keys = [];
    this.pop = null;
  }
}

export const kfPanel = new KeyframePanelState();

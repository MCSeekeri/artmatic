/**
 * drag-reorder.ts — 可复用的「拖曳排序」action。
 *
 * 三处列表共用同一份实现：顶栏的工程选项卡（横向）、时间轴的轨道行（纵向）、
 * 排版编辑器的图层列表（纵向）。三边各写一套的话，「拖到边界怎么算」
 * 「超过阈值才起拖」「拖完不许触发点击」这些细节必然各长一个样。
 *
 * ## 为什么不用 HTML5 的 drag & drop
 *
 * 原生 DnD 给不了一个关键效果：**其它项滑开让位**。它提供的是拖影 + 落点，
 * 而项目之间留不留空隙完全靠 `dragover` 里手改 DOM —— 那还不如直接用指针
 * 事件算完再一次性套 transform。另外原生 DnD 在 `<button>` 上还有平台差异
 * （Windows 上要额外处理 `draggable` 与 `selectstart`）。
 *
 * ## 算法
 *
 * 一切都在 **transform** 上做，DOM 顺序在拖曳期间**不动**：
 *  1. pointerdown 记下起点与被抓元素；
 *  2. 位移超过 4px 才算「开始拖」（否则仍是一次普通点击）；
 *  3. 拖曳中：被抓元素跟着指针走，其余项按「落点序号」各自反向平移一个
 *     被抓元素的尺寸 + 间隙 —— 这就是「滑开让位」；
 *  4. pointerup：一次性把 transform 全部清掉并回调 `onReorder`，
 *     父组件改完数组顺序后 Svelte 会在同一个 microtask 里把节点挪好，
 *     浏览器不会在这中间绘制，所以看不到闪回。
 *
 * 落点序号由「被抓元素的中心越过了谁的原始中心」决定，与列表项尺寸是否一致
 * 无关（选项卡宽度本来就不一样）。
 */

export interface ReorderOptions {
  /** 排列轴。选项卡横向、轨道与图层行纵向。 */
  axis: 'x' | 'y';
  /** 承载排序项的选择器（相对容器），例如 `[data-testid=track-side-row]`。 */
  itemSelector: string;
  /**
   * 只有按在这类元素上才起拖（相对容器）。缺省 = 项内任意处都能起拖。
   *
   * 检查器的特效卡片里全是滑杆 / 数字框 —— 不设把手的话，用户想拖一下滑杆
   * 就会把整张卡片拖走。页签 / 轨道 / 图层这三处没有这个问题，所以这个字段
   * 是**可选**的，不影响既有调用。
   */
  handleSelector?: string;
  /** 松手时回调，`from`/`to` 是**匹配集合**里的下标。 */
  onReorder: (from: number, to: number) => void;
  /** 为 true 时完全不接管指针事件。 */
  disabled?: boolean;
}

/** 起拖阈值（px）。低于它的位移一律当作点击 —— 按钮的点按会有 1~2px 抖动。 */
const THRESHOLD = 4;

interface ItemBox {
  el: HTMLElement;
  /** 沿轴的位置（起点）。 */
  start: number;
  size: number;
  center: number;
  /** 该项原本的 transform（一般是空串）。 */
  transform: string;
  zIndex: string;
}

function readGap(node: HTMLElement, axis: 'x' | 'y'): number {
  const gap = getComputedStyle(node).gap || getComputedStyle(node).rowGap;
  const part = gap.split(' ')[axis === 'x' ? 0 : gap.split(' ').length - 1] ?? gap;
  const n = Number.parseFloat(part);
  return Number.isFinite(n) ? n : 0;
}

export function reorder(node: HTMLElement, opts: ReorderOptions) {
  let o = opts;
  let cleanup: (() => void) | null = null;

  function boxes(axis: 'x' | 'y'): ItemBox[] {
    return Array.from(node.querySelectorAll<HTMLElement>(o.itemSelector)).map((el) => {
      const r = el.getBoundingClientRect();
      const start = axis === 'x' ? r.left : r.top;
      const size = axis === 'x' ? r.width : r.height;
      return {
        el,
        start,
        size,
        center: start + size / 2,
        transform: el.style.transform,
        zIndex: el.style.zIndex,
      };
    });
  }

  function onDown(e: PointerEvent): void {
    if (o.disabled || e.button !== 0 || cleanup) return;
    const target = e.target as HTMLElement | null;
    // 有把手时只认把手（且把手必须在项内）；没有时按整项算。
    const grip = o.handleSelector ? target?.closest<HTMLElement>(o.handleSelector) : target;
    if (!grip || !node.contains(grip)) return;
    const hit = grip.closest<HTMLElement>(o.itemSelector) ?? null;
    if (!hit || !node.contains(hit)) return;
    // 收成一个非空类型再往下传：`apply()` / `restore()` 是嵌套的函数声明，
    // TS 不会把外层的 null 收窄带进去。
    const grabbed: HTMLElement = hit;

    const axis = o.axis;
    const list = boxes(axis);
    const from = list.findIndex((b) => b.el === grabbed);
    if (from < 0 || list.length < 2) return;

    const grab = list[from]!;
    const pointerStart = axis === 'x' ? e.clientX : e.clientY;
    const gap = readGap(node, axis);
    const step = grab.size + gap;

    /*
     * 滚动容器与它的初始滚距。
     *
     * 自动滚动会让元素在视口里的坐标整体位移，而落点判定用的是**视口坐标**。
     * 不补这个差值的话，一旦拖到边缘触发滚动，落点就会一路漂 ——
     * 表现为「越滚越不准，最后整个顺序是错的」。
     */
    const scroller = findScroller(node);
    const scrollStart = scroller
      ? axis === 'x'
        ? scroller.scrollLeft
        : scroller.scrollTop
      : 0;

    let started = false;
    let delta = 0;
    let to = from;

    const onMove = (ev: PointerEvent): void => {
      delta = (axis === 'x' ? ev.clientX : ev.clientY) - pointerStart;
      if (!started) {
        if (Math.abs(delta) < THRESHOLD) return;
        started = true;
        node.classList.add('is-reordering');
        node.style.userSelect = 'none';
        grabbed.style.zIndex = '2';
        grabbed.classList.add('is-dragging');
      }

      apply();
      // 拖到视口边缘时自动滚动（轨道多的时候必须的，否则「拖不动到看不见的地方」）
      autoScroll(ev);
    };

    function scrollDeltaNow(): number {
      if (!scroller) return 0;
      return (axis === 'x' ? scroller.scrollLeft : scroller.scrollTop) - scrollStart;
    }

    function apply(): void {
      const center = grab.center + delta + scrollDeltaNow();
      let next = from;
      for (let j = 0; j < list.length; j += 1) {
        if (j === from) continue;
        const c = list[j]!.center;
        if (j > from && center > c) next = Math.max(next, j);
        if (j < from && center < c) next = Math.min(next, j);
      }
      to = next;

      const t = axis === 'x' ? `translateX(${delta}px)` : `translateY(${delta}px)`;
      grabbed.style.transform = t;
      for (let j = 0; j < list.length; j += 1) {
        const b = list[j]!;
        if (j === from) continue;
        let shift = 0;
        // 让位方向只看「落点相对原位往前还是往后」，与当前指针位置无关 ——
        // 用指针位置判断会在两个项之间来回抖。
        if (to > from && j > from && j <= to) shift = -step;
        else if (to < from && j >= to && j < from) shift = step;
        const st = axis === 'x' ? `translateX(${shift}px)` : `translateY(${shift}px)`;
        b.el.style.transform = shift === 0 ? b.transform : st;
      }
    }

    /** 拖曳期间指针靠近滚动容器边缘时滚动它。 */
    function autoScroll(ev: PointerEvent): void {
      if (!scroller) return;
      const r = scroller.getBoundingClientRect();
      const edge = 24;
      const speed = 8;
      if (axis === 'y') {
        if (ev.clientY < r.top + edge) scroller.scrollTop -= speed;
        else if (ev.clientY > r.bottom - edge) scroller.scrollTop += speed;
      } else {
        if (ev.clientX < r.left + edge) scroller.scrollLeft -= speed;
        else if (ev.clientX > r.right - edge) scroller.scrollLeft += speed;
      }
    }

    function restore(): void {
      for (const b of list) {
        b.el.style.transform = b.transform;
        b.el.style.zIndex = b.zIndex;
        b.el.classList.remove('is-dragging');
      }
      node.classList.remove('is-reordering');
      node.style.removeProperty('user-select');
    }

    const finish = (commit: boolean): void => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancel);
      cleanup = null;
      restore();
      if (commit && started && to !== from) o.onReorder(from, to);
      if (started) suppressNextClick();
    };

    const onUp = (): void => finish(true);
    const onCancel = (): void => finish(false);

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
    cleanup = () => finish(false);
  }

  /**
   * 拖完之后紧跟的这一次 click 必须吞掉。
   *
   * 不然「在选项卡上拖一下」会顺带切一次工程，在图层行上拖一下会顺带改一次
   * 选中 —— 而用户的心智里刚才那次是"拖"，不是"点"。
   * 用捕获阶段拦，并只拦这一次。
   */
  function suppressNextClick(): void {
    const kill = (e: MouseEvent): void => {
      e.stopPropagation();
      e.preventDefault();
    };
    window.addEventListener('click', kill, true);
    setTimeout(() => window.removeEventListener('click', kill, true), 0);
  }

  node.addEventListener('pointerdown', onDown);

  return {
    update(next: ReorderOptions) {
      // 拖曳进行中不允许换配置：`onReorder` 换了会把松手回调指到别的数组上。
      if (cleanup) return;
      o = next;
    },
    destroy() {
      cleanup?.();
      node.removeEventListener('pointerdown', onDown);
    },
  };
}

/** 找最近的可滚动祖先（轨道区与图层列表都可能比视口长）。 */
function findScroller(node: HTMLElement): HTMLElement | null {
  let el: HTMLElement | null = node.parentElement;
  while (el) {
    const s = getComputedStyle(el);
    if (/(auto|scroll)/.test(s.overflowY) || /(auto|scroll)/.test(s.overflowX)) return el;
    el = el.parentElement;
  }
  return null;
}

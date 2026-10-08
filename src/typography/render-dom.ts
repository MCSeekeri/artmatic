/**
 * render-dom.ts — TypographyDocument → DOM 子树。
 *
 * **舞台与光栅化共用这一个函数**，这是「编辑器里看到的 = 导出的」的结构保证。
 * 两边唯一的差别是 `forRaster`：
 *   - 舞台：文本层可编辑（contenteditable），元素可被选择层覆盖；
 *   - 光栅化：纯静态副本，不带任何编辑痕迹。
 *
 * 结构（从外到内）：
 *   .typo-doc            文档根：尺寸、裁切、isolation
 *     <style>            动画面板（唯一注入点）
 *     .typo-el           几何 + 旋转 + 不透明度 + 混合模式
 *       .typo-anim       动画层（每个动画一层，可嵌套）
 *         content        文本 / SVG / 图片
 *
 * 为什么把动画单独放一层：动画预设大量使用 transform，而外层 .typo-el 的
 * transform 被旋转占用了。放在同一元素上会互相覆盖。
 */

import { animationStyleSheet, ANIM_ID_ATTR } from './animation';
import {
  animLayerStyle,
  applyDecls,
  docStyle,
  elementStyle,
  groupStyle,
  imageStyle,
  paintDefId,
  paintNeedsDefs,
  runsWrapperStyle,
  shapePaintAttrs,
  spanStyle,
  textStyle,
} from './css';
import { normalizeRuns, runsSignature, type TextRun, type TextSpanStyle } from './rich-text';
import { groupBox } from './groups';
import {
  DOC_ROOT_ATTR,
  EL_ID_ATTR,
  GROUP_ID_ATTR,
  RUNS_SIG_ATTR,
  RUNS_WRAP_ATTR,
  SPAN_ATTR,
  type PaintStop,
  type ShapeElement,
  type TexturePattern,
  type TypographyDocument,
  type TypographyElement,
  type TypographyGroup,
} from './document';
import { shapeGeometry } from './shapes';

export interface BuildDocOptions {
  /** true = 产出给光栅化的静态副本（不做 contenteditable）。 */
  forRaster?: boolean;
  /** 图片素材 → URL。返回 null 表示素材还没准备好，该元素这帧缺席。 */
  resolveImage?: (assetId: string) => string | null;
  /**
   * 正在编辑文本的元素 id。编辑期间**不覆写 textContent**（否则每帧同步都会
   * 把用户刚打的字抹掉并把光标弹到开头），并给它开 pointer-events 与
   * contenteditable（文档元素默认是 `pointer-events: none`，否则收不到焦点）。
   */
  editingId?: string | null;
}

const SVG_NS = 'http://www.w3.org/2000/svg';

/**
 * 结构签名：元素 id / 种类 / 顺序 / 动画 id 的组合。
 *
 * 舞台用它决定「要不要重建 DOM」：只有这些变了才重建，纯粹的拖拽（改 frame）
 * 走 syncDocDom 就地更新样式。重建的代价不只是 CPU —— 它会**丢掉正在编辑的
 * contenteditable 的选区**，用户打到一半字光标就飞了。
 */
export function docSignature(doc: TypographyDocument | null): string {
  if (!doc) return '';
  return (
    doc.elements
      .map(
        (e) =>
          `${e.id}:${e.kind}:${e.visible ? 1 : 0}:${e.animations.map((a) => a.id).join(',')}:${e.groupId ?? ''}`,
      )
      .join('|') + `#g${(doc.groups ?? []).map((g) => g.id).join(',')}`
  );
}

export function buildDocDom(doc: TypographyDocument, opts: BuildDocOptions = {}): HTMLElement {
  const root = document.createElement('div');
  root.className = 'typo-doc';
  root.setAttribute(DOC_ROOT_ATTR, '1');
  applyDecls(root, docStyle(doc));

  // 动画样式表。没有动画时 animationStyleSheet 返回 ''，不插空 <style>。
  const sheet = animationStyleSheet(doc);
  if (sheet) {
    const style = document.createElement('style');
    style.textContent = sheet;
    root.appendChild(style);
  }

  /*
   * 组合外壳画在**成员下面**。
   *
   * 扁平数组里没法表达「一层包住另一层」，所以外壳是**独立的兄弟节点**，
   * 插在该组最底层那个成员的前面 —— 于是它盖住组底下的东西、又被组内成员盖住，
   * 与「组是一个容器」的观感一致。
   */
  const shellDone = new Set<string>();
  for (const el of doc.elements) {
    // 隐藏的元素直接不渲染：光栅化时少一个节点，舞台上也免得出现
    // 「看不见但能选中」的幽灵元素（在图层面板里取消隐藏即可）。
    if (!el.visible) continue;
    if (el.groupId && !shellDone.has(el.groupId)) {
      shellDone.add(el.groupId);
      const g = (doc.groups ?? []).find((x) => x.id === el.groupId);
      if (g) {
        const shell = buildGroupShell(doc, g);
        if (shell) root.appendChild(shell);
      }
    }
    const node = buildElement(el, opts);
    if (node) root.appendChild(node);
  }
  return root;
}

function buildGroupShell(doc: TypographyDocument, g: TypographyGroup): HTMLElement | null {
  const box = groupBox(doc, g);
  // 没有任何可见成员就不画 —— 否则会在空处留一个孤零零的框。
  if (!box) return null;
  const shell = document.createElement('div');
  shell.className = 'typo-group';
  shell.setAttribute(GROUP_ID_ATTR, g.id);
  applyDecls(shell, groupStyle(g, box));
  return shell;
}

function buildElement(el: TypographyElement, opts: BuildDocOptions): HTMLElement | null {
  const shell = document.createElement('div');
  shell.className = `typo-el typo-el-${el.kind}`;
  shell.setAttribute(EL_ID_ATTR, el.id);
  applyDecls(shell, elementStyle(el));

  // 动画层：doc.elements[i].animations 的第一个在最外层。
  // 嵌套而不是并列，是因为多个动画会各自写 transform，并列只能有一个生效。
  let cursor: HTMLElement = shell;
  for (const anim of el.animations) {
    const layer = document.createElement('div');
    layer.className = 'typo-anim';
    layer.setAttribute(ANIM_ID_ATTR, anim.id);
    applyDecls(layer, animLayerStyle());
    cursor.appendChild(layer);
    cursor = layer;
  }

  const content = buildContent(el, opts);
  if (!content) return null;
  cursor.appendChild(content);
  return shell;
}

function buildContent(el: TypographyElement, opts: BuildDocOptions): Element | null {
  if (el.kind === 'text') {
    const box = document.createElement('div');
    box.className = 'typo-text';
    applyDecls(box, textStyle(el.style));
    applyRuns(box, el.runs);
    if (!opts.forRaster) {
      // 舞台上的双击进入编辑由编辑器自己接管（设置 contenteditable）。
      // 这里只标出可编辑意图，不直接开 —— 否则选择手势会被文本框吃掉。
      box.dataset.editable = 'true';
    }
    return box;
  }

  if (el.kind === 'shape') {
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.style.position = 'absolute';
    svg.style.left = '0';
    svg.style.top = '0';
    svg.style.width = '100%';
    svg.style.height = '100%';
    svg.style.overflow = 'visible';
    syncShape(svg, el);
    return svg;
  }

  // image
  const url = opts.resolveImage?.(el.assetId) ?? null;
  if (!url) return null; // 素材没准备好：这帧缺席，与 algo 未烘好时同语义

  const { wrapper, img: imgDecls } = imageStyle(el);
  const wrap = document.createElement('div');
  wrap.className = 'typo-image';
  applyDecls(wrap, wrapper);

  const img = document.createElement('img');
  img.src = url;
  img.alt = '';
  img.draggable = false;
  applyDecls(img, imgDecls);
  wrap.appendChild(img);
  return wrap;
}

/* ------------------------------------------------------------ 就地同步
 *
 * 舞台的每帧更新走这里，而不是重建整棵树。
 * 与 buildDocDom 共用 css.ts 的同一份声明表，所以「就地更新」与「重建」
 * 不可能产出不同的样式 —— 这是两者能互换的前提。
 */

export function syncDocDom(host: HTMLElement, doc: TypographyDocument, opts: BuildDocOptions = {}): void {
  /*
   * 自己找文档根，而不是要求调用方传对。
   *
   * 这里踩过一次：调用方传的是 `.paper` 这个**外层容器**，而本函数只看直接
   * 子节点里带 `data-el-id` 的 —— 外层容器的唯一子节点是 `.typo-doc`（不带该
   * 属性），于是 `shells` 全空、循环全部 continue。表现是「拖了半天画面纹丝
   * 不动，退出编辑页再进来才更新」，而且**不报任何错**、控制台一片安静。
   * 让本函数自己往下找一层，这类传参错误就从「静默失效」变成「不可能发生」。
   */
  const root = host.hasAttribute(DOC_ROOT_ATTR)
    ? host
    : host.querySelector<HTMLElement>(`[${DOC_ROOT_ATTR}]`);
  if (!root) return;

  applyDecls(root, docStyle(doc));
  syncStyleSheet(root, doc);
  syncGroupShells(root, doc);

  const shells = new Map<string, HTMLElement>();
  for (const child of Array.from(root.children)) {
    const el = child as HTMLElement;
    const id = el.getAttribute(EL_ID_ATTR);
    if (id) shells.set(id, el);
  }

  for (const el of doc.elements) {
    const shell = shells.get(el.id);
    if (!shell) continue; // 结构差异由 docSignature 触发重建，这里不做增删
    syncElement(shell, el, opts);
  }
}

/**
 * 就地刷新组合外壳。
 *
 * 结构变化（成组 / 解组 / 换组）由 `docSignature` 触发整棵重建，这里只负责
 * **几何与样式**：拖一个成员时外壳要跟着长大/移动，而签名没变、不会重建。
 * 漏掉这一步的表现是「拖动组里的元素，组的背景框留在原地」。
 */
function syncGroupShells(root: HTMLElement, doc: TypographyDocument): void {
  const shells = new Map<string, HTMLElement>();
  for (const child of Array.from(root.children)) {
    const gid = (child as HTMLElement).getAttribute(GROUP_ID_ATTR);
    if (gid) shells.set(gid, child as HTMLElement);
  }
  if (!shells.size) return;

  for (const [gid, shell] of shells) {
    const g = (doc.groups ?? []).find((x) => x.id === gid);
    const box = g ? groupBox(doc, g) : null;
    // 组没了（解组）或没有可见成员：先藏起来，真正的删除由重建完成。
    if (!g || !box) {
      shell.style.display = 'none';
      continue;
    }
    shell.style.display = '';
    applyDecls(shell, groupStyle(g, box));
  }
}

function syncStyleSheet(root: HTMLElement, doc: TypographyDocument): void {  // 第一个子节点是 <style>（buildDocDom 里 prepend 的形态）。动画参数改了
  // 但动画 id 没变时，签名不变、不重建 —— 全靠这里把新参数写回去。
  const sheet = animationStyleSheet(doc);
  const first = root.firstElementChild;
  const existing = first && first.tagName === 'STYLE' ? (first as HTMLStyleElement) : null;
  if (sheet) {
    if (existing) {
      if (existing.textContent !== sheet) existing.textContent = sheet;
    } else {
      const style = document.createElement('style');
      style.textContent = sheet;
      root.prepend(style);
    }
  } else if (existing) {
    existing.remove();
  }
}

function syncElement(shell: HTMLElement, el: TypographyElement, opts: BuildDocOptions): void {
  applyDecls(shell, elementStyle(el));

  // 钻进动画层，停在内容节点上。
  let cursor: Element | null = shell.firstElementChild;
  for (let i = 0; i < el.animations.length; i++) {
    const layer = cursor as HTMLElement | null;
    if (!layer || !layer.hasAttribute(ANIM_ID_ATTR)) return;
    applyDecls(layer, animLayerStyle());
    cursor = layer.firstElementChild;
  }
  const content = cursor as HTMLElement | null;
  if (!content) return;

  if (el.kind === 'text') {
    applyDecls(content, textStyle(el.style));
    const editing = opts.editingId === el.id;
    /*
     * 编辑态与文档内容**不能同时写**：同步每帧都跑，覆写 textContent 会把用户
     * 刚打的字抹掉、光标弹回开头。
     *
     * 但不覆写 ≠ 什么都不做 —— 在编辑中给选区加粗时，DOM 必须跟着重建。
     * 判据是**内容签名**：签名没变就一个节点都不动（打字时属于这一类），
     * 变了才重建（应用了行内格式属于这一类，编辑器随后把光标还原）。
     */
    const sig = runsSignature(el.runs);
    if (content.getAttribute(RUNS_SIG_ATTR) !== sig) applyRuns(content, el.runs);
    applyEditingState(content, editing);
    return;
  }

  if (el.kind === 'shape') {
    syncShape(content as unknown as SVGSVGElement, el);
    return;
  }

  // image：素材 URL 变了要重整（这里只处理声明，src 由调用方保证）
  const img = content.querySelector('img');
  if (!img) return;
  const { wrapper, img: imgDecls } = imageStyle(el);
  applyDecls(content, wrapper);
  applyDecls(img, imgDecls);
  const url = opts.resolveImage?.(el.assetId) ?? null;
  if (url && img.getAttribute('src') !== url) img.setAttribute('src', url);
}

/**
 * 把几何写进 `<svg>`。**build 与 sync 共用这一个**，所以「重建」与「就地更新」
 * 不可能产出不同的图形（这是两者能互换的前提）。
 *
 * 结构固定为 `<svg><g><path/></g></svg>`：`<g>` 只在自定义路径（按 0..100
 * authored）时才带 scale 变换。固定结构省掉了「条件插入/删除子节点」这类
 * 容易漏掉的分支。
 */
export function syncShape(svg: SVGSVGElement, el: ShapeElement): void {
  const geo = shapeGeometry(el.shape, {
    w: el.frame.w,
    h: el.frame.h,
    radius: el.radius,
    sides: el.sides,
    waist: el.waist,
    inner: el.inner,
    angle: el.angle,
    path: el.path,
  });
  svg.setAttribute('viewBox', geo.viewBox);

  syncPaintDefs(svg, el, geo.scaleFrom100 === true);

  // 手写遍历而不是 `querySelector(':scope > g')`：后者在 SVG 子树里的支持
  // 各浏览器不一致，而这里的结构是固定的（defs? + g），手扫更省心。
  let g: SVGGElement | null = null;
  for (const child of Array.from(svg.children)) {
    if (child.tagName.toLowerCase() === 'g') {
      g = child as SVGGElement;
      break;
    }
  }
  if (!g) {
    g = document.createElementNS(SVG_NS, 'g');
    svg.appendChild(g);
  }
  if (geo.scaleFrom100) {
    g.setAttribute('transform', `scale(${el.frame.w / 100} ${el.frame.h / 100})`);
  } else {
    g.removeAttribute('transform');
  }

  let path = g.firstElementChild as SVGPathElement | null;
  if (!path) {
    path = document.createElementNS(SVG_NS, 'path');
    g.appendChild(path);
  }
  path.setAttribute('d', geo.d);
  for (const [k, v] of Object.entries(shapePaintAttrs(el, geo.evenOdd))) path.setAttribute(k, v);
}

/* ------------------------------------------------------------ 填充的 <defs> */

/**
 * 渐变 / 纹理 → `<defs>` 里的 `<linearGradient>` / `<radialGradient>` / `<pattern>`。
 *
 * **按需增删**，不是每次重建整棵 svg：`syncShape` 每帧都在跑，无条件
 * `replaceChildren` 会让每一帧都新建一批 SVG 节点。这里只在「需要 defs」
 * 时确保它存在，并把 id 固定成由元素 id 派生 —— 同一个元素永远拿到同一个
 * 引用标识。
 *
 * 渐变的坐标用 `objectBoundingBox`（0..1）：元素盒多大都不用管，
 * 也不用跟 `viewBox` 的单位换算打交道。纹理用 `userSpaceOnUse`，
 * 因为「每 20px 一个点」这种周期必须落在**文档像素**上才有意义。
 */
function syncPaintDefs(svg: SVGSVGElement, el: ShapeElement, scaleFrom100: boolean): void {
  const needs = paintNeedsDefs(el.fill);
  let defs = svg.firstElementChild as SVGDefsElement | null;
  if (!defs || defs.tagName.toLowerCase() !== 'defs') defs = null;

  if (!needs) {
    if (defs) defs.remove();
    return;
  }
  if (!defs) {
    defs = document.createElementNS(SVG_NS, 'defs') as SVGDefsElement;
    svg.prepend(defs);
  }

  const paint = el.fill;
  const id = paintDefId(el.id);
  defs.replaceChildren();

  if (paint.kind === 'linear' || paint.kind === 'radial') {
    const grad = document.createElementNS(
      SVG_NS,
      paint.kind === 'linear' ? 'linearGradient' : 'radialGradient',
    );
    grad.setAttribute('id', id);
    grad.setAttribute('gradientUnits', 'objectBoundingBox');
    if (paint.kind === 'linear') {
      // 0° = 左→右，顺时针。方向向量乘 0.5 得到过中心、贯穿整个包围盒的线段。
      const rad = (paint.angle * Math.PI) / 180;
      const dx = Math.cos(rad) / 2;
      const dy = Math.sin(rad) / 2;
      grad.setAttribute('x1', String(0.5 - dx));
      grad.setAttribute('y1', String(0.5 - dy));
      grad.setAttribute('x2', String(0.5 + dx));
      grad.setAttribute('y2', String(0.5 + dy));
    } else {
      grad.setAttribute('cx', '0.5');
      grad.setAttribute('cy', '0.5');
      grad.setAttribute('r', '0.5');
    }
    for (const stop of sortedStops(paint.stops)) {
      const node = document.createElementNS(SVG_NS, 'stop');
      node.setAttribute('offset', String(stop.offset));
      node.setAttribute('stop-color', stop.color);
      grad.appendChild(node);
    }
    defs.appendChild(grad);
    return;
  }

  // texture
  if (paint.kind !== 'texture') return;
  // 自定义路径的 user space 是 0..100（外面还套了一层 scale），
  // 所以「文档 px」在这里要先除以那个比例。
  const unit = scaleFrom100 ? 100 / Math.max(1, el.frame.w) : 1;
  const cell = Math.max(2, paint.scale * unit);
  const thick = Math.max(0.2, paint.thickness * unit);

  const pat = document.createElementNS(SVG_NS, 'pattern');
  pat.setAttribute('id', id);
  pat.setAttribute('patternUnits', 'userSpaceOnUse');
  pat.setAttribute('width', String(cell));
  pat.setAttribute('height', String(cell));

  const bg = document.createElementNS(SVG_NS, 'rect');
  bg.setAttribute('x', '0');
  bg.setAttribute('y', '0');
  bg.setAttribute('width', String(cell));
  bg.setAttribute('height', String(cell));
  bg.setAttribute('fill', paint.bg);
  pat.appendChild(bg);

  for (const motif of textureMotifs(paint.pattern, cell, thick, paint.color)) pat.appendChild(motif);
  defs.appendChild(pat);
}

/** 图案的原始形状。统一在这里生成 —— 加一种纹理只需要在 switch 里加一条。 */
function textureMotifs(
  pattern: TexturePattern,
  cell: number,
  thick: number,
  color: string,
): SVGElement[] {
  const el = (tag: string): SVGElement => document.createElementNS(SVG_NS, tag);
  const line = (x1: number, y1: number, x2: number, y2: number): SVGElement => {
    const l = el('line');
    l.setAttribute('x1', String(x1));
    l.setAttribute('y1', String(y1));
    l.setAttribute('x2', String(x2));
    l.setAttribute('y2', String(y2));
    l.setAttribute('stroke', color);
    l.setAttribute('stroke-width', String(thick));
    return l;
  };
  const half = cell / 2;
  switch (pattern) {
    case 'dots': {
      const c = el('circle');
      c.setAttribute('cx', String(half));
      c.setAttribute('cy', String(half));
      c.setAttribute('r', String(thick));
      c.setAttribute('fill', color);
      return [c];
    }
    case 'grid':
      // 画在上/左两条边上，平铺之后就是一整张网格。
      return [line(0, 0, cell, 0), line(0, 0, 0, cell)];
    case 'diagonal':
      return [line(0, cell, cell, 0)];
    case 'cross':
      return [line(0, 0, cell, cell), line(0, cell, cell, 0)];
    case 'checker': {
      const out: SVGElement[] = [];
      for (const [x, y] of [
        [0, 0],
        [half, half],
      ] as const) {
        const r = el('rect');
        r.setAttribute('x', String(x));
        r.setAttribute('y', String(y));
        r.setAttribute('width', String(half));
        r.setAttribute('height', String(half));
        r.setAttribute('fill', color);
        out.push(r);
      }
      return out;
    }
    case 'wave': {
      const p = el('path');
      // 一个周期的正弦（两个二次贝塞尔拼）。控制点取 4/3·(√2−1) 的近似，
      // 0.55 是肉眼看着最像正弦的那个系数。
      p.setAttribute('d', `M0,${half} Q${cell * 0.25},${half - cell * 0.55} ${half},${half} Q${cell * 0.75},${half + cell * 0.55} ${cell},${half}`);
      p.setAttribute('fill', 'none');
      p.setAttribute('stroke', color);
      p.setAttribute('stroke-width', String(thick));
      return [p];
    }
    default:
      return [];
  }
}

/** 色标归一化：排序、钳制、不足两个时补足 —— 单色标的渐变是无效的。 */
export function sortedStops(stops: PaintStop[]): PaintStop[] {
  const list = (stops ?? []).map((s) => ({
    offset: Math.max(0, Math.min(1, Number(s.offset) || 0)),
    color: s.color,
  }));
  list.sort((a, b) => a.offset - b.offset);
  if (list.length === 0) return [
    { offset: 0, color: '#ffffff' },
    { offset: 1, color: '#000000' },
  ];
  if (list.length === 1) {
    return [
      { offset: 0, color: list[0]!.color },
      { offset: 1, color: list[0]!.color },
    ];
  }
  return list;
}

/* ------------------------------------------------------------ 富文本（DOM 侧） */

/**
 * 把 runs 写成子节点：每段一个 `<span data-run="…">`。
 *
 * 写 DOM 用 `textContent` 而不是 `innerHTML` —— 文本是用户内容，
 * 走 innerHTML 等于把编辑器变成一个 HTML 注入点。
 *
 * 没有覆盖的段**也**包一层 span：结构统一之后读回来不必分情况，
 * 而「有没有覆盖」这件事本来就写在 `SPAN_ATTR` 里。
 */
export function applyRuns(box: HTMLElement, runs: readonly TextRun[]): void {
  /*
   * 文本段装在**一个内层盒子**里，不是直接挂在 `.typo-text` 下。
   *
   * `.typo-text` 是 flex（垂直对齐靠它），而 flex 会把每个子元素块级化 ——
   * 直接挂的话每一段各占一行，标题中间加粗两个字就断成三行。外面套一层之后
   * flex 项只有它一个，段与段之间是正常的行内流动。
   *
   * 内层盒子在读取侧是**透明**的：`serializeRuns` / `plainIndex` / `setCaretRange`
   * 都只对 `<br>` 特殊处理，普通元素只是往下走一层，不产生字符。
   */
  // 手扫子节点而不是 `:scope >`：后者在 SVG 子树与部分版本里的支持不一致，
  // 而这里结构是固定的（最多一个内层盒子）。
  let wrap: HTMLElement | null = null;
  for (const child of Array.from(box.children)) {
    if (child.hasAttribute(RUNS_WRAP_ATTR)) {
      wrap = child as HTMLElement;
      break;
    }
  }
  if (!wrap) {
    wrap = document.createElement('span');
    wrap.setAttribute(RUNS_WRAP_ATTR, '1');
    applyDecls(wrap, runsWrapperStyle());
    box.replaceChildren(wrap);
  }
  const target = wrap;
  target.replaceChildren();
  for (const run of runs) {
    const span = document.createElement('span');
    span.setAttribute(SPAN_ATTR, JSON.stringify(run.style ?? {}));
    applyDecls(span, spanStyle(run.style));
    span.textContent = run.text;
    target.appendChild(span);
  }
  // 必须和模型签名一致：下一次同步据此判断「不用重建」。
  box.setAttribute(RUNS_SIG_ATTR, runsSignature(runs));
}

/**
 * DOM → runs（用户改完字之后读回来）。
 *
 * 遍历所有文本节点，取**最近的**带 `SPAN_ATTR` 的祖先作为这一段的行内样式。
 * 浏览器在段边界打字时会自己拆 / 并 span，这里不假设结构，只按祖先归属来判 —— 
 * 所以「在加粗段末尾继续打字」得到的新字**仍然是加粗的**，符合直觉。
 */
export function serializeRuns(root: HTMLElement): TextRun[] {
  const out: TextRun[] = [];
  const walk = (node: Node, style: TextSpanStyle | undefined): void => {
    for (const child of Array.from(node.childNodes)) {
      if (child.nodeType === Node.TEXT_NODE) {
        const text = (child as Text).data;
        if (text) out.push({ text, style: style ? { ...style } : undefined });
        continue;
      }
      if (child.nodeType !== Node.ELEMENT_NODE) continue;
      const el = child as HTMLElement;
      if (el.tagName.toLowerCase() === 'br') {
        out.push({ text: '\n', style: style ? { ...style } : undefined });
        continue;
      }
      walk(el, parseSpanAttr(el.getAttribute(SPAN_ATTR)) ?? style);
    }
  };
  walk(root, undefined);
  return normalizeRuns(out);
}

function parseSpanAttr(raw: string | null): TextSpanStyle | undefined {
  if (!raw) return undefined;
  try {
    const obj = JSON.parse(raw) as TextSpanStyle;
    return obj && Object.keys(obj).length ? obj : undefined;
  } catch {
    // 属性被外力写坏了就当作「没有覆盖」，而不是抛出去让整棵 DOM 停更。
    return undefined;
  }
}

/**
 * 纯文本下标表：DOM 节点 → 它在纯文本里的 `[start, end)`。
 *
 * **这是「选区 ↔ 纯文本下标」换算的唯一真源。**
 *
 * 为什么不用 `Range.toString()`：它按规范只拼**文本节点**的内容，`<br>` 贡献
 * 零个字符。而 Chromium 把编辑区里的换行**存成 `<br>`**（`execCommand('insertText', '\n')`
 * 也一样），于是「回车之后」的所有偏移都会整体少算一格 —— 表现是加粗/改字号
 * 落在隔壁几个字上，而且只在有空行的文本框里出现。
 *
 * 所以换行一律按 1 个字符计，与 `serializeRuns` / `plainTextOfDom` 口径一致。
 */
function plainIndex(root: HTMLElement): { text: string; at: Map<Node, { start: number; end: number }> } {
  const at = new Map<Node, { start: number; end: number }>();
  let out = '';
  const walk = (node: Node): void => {
    for (const child of Array.from(node.childNodes)) {
      const start = out.length;
      if (child.nodeType === Node.TEXT_NODE) {
        out += (child as Text).data;
      } else if (child.nodeType === Node.ELEMENT_NODE) {
        if ((child as HTMLElement).tagName.toLowerCase() === 'br') out += '\n';
        else walk(child);
      }
      at.set(child, { start, end: out.length });
    }
  };
  walk(root);
  at.set(root, { start: 0, end: out.length });
  return { text: out, at };
}

/** 编辑区里的纯文本。与 `serializeRuns` / `caretRange` 同源。 */
export function plainTextOfDom(root: HTMLElement): string {
  return plainIndex(root).text;
}

/**
 * 当前选区的**纯文本下标**区间（`[start, end]` 顺序已归一）。
 *
 * 选区端点可能落在元素节点上（`(span, 0)` 这种），那时取该子节点的起点 ——
 * `plainIndex` 给每个节点都记了区间，所以两种情况都是查表。
 */
export function caretRange(root: HTMLElement): { start: number; end: number } | null {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return null;
  const range = sel.getRangeAt(0);
  if (!root.contains(range.startContainer) || !root.contains(range.endContainer)) return null;

  const { at } = plainIndex(root);
  const offsetOf = (node: Node, offset: number): number => {
    if (node.nodeType === Node.TEXT_NODE) {
      const cell = at.get(node);
      if (cell) return cell.start + offset;
    }
    // 元素节点：offset 是子节点下标 ⇒ 就是那个子节点的起点。
    const child = node.childNodes[offset];
    if (child) {
      const cell = at.get(child);
      if (cell) return cell.start;
    }
    // 落在末尾：用该节点自己的终点。
    return at.get(node)?.end ?? 0;
  };

  const a = offsetOf(range.startContainer, range.startOffset);
  const b = offsetOf(range.endContainer, range.endOffset);
  return { start: Math.min(a, b), end: Math.max(a, b) };
}

/**
 * 把光标（或选区）放回纯文本下标处。重建节点之后必须调它。
 *
 * 与 `plainIndex` 同一套口径（`<br>` 记 1 个字符），否则「还原光标」会把
 * 光标放到隔壁一行去。
 */
export function setCaretRange(root: HTMLElement, start: number, end: number): void {
  const table: { node: Text; start: number }[] = [];
  let total = 0;
  const walk = (node: Node): void => {
    for (const child of Array.from(node.childNodes)) {
      if (child.nodeType === Node.TEXT_NODE) {
        table.push({ node: child as Text, start: total });
        total += (child as Text).data.length;
      } else if (child.nodeType === Node.ELEMENT_NODE) {
        if ((child as HTMLElement).tagName.toLowerCase() === 'br') total += 1;
        else walk(child);
      }
    }
  };
  walk(root);
  if (!table.length) return;

  const pointAt = (offset: number): { node: Node; offset: number } => {
    const wanted = Math.max(0, Math.min(offset, total));
    for (const cell of table) {
      const len = cell.node.data.length;
      if (wanted <= cell.start + len) return { node: cell.node, offset: wanted - cell.start };
    }
    const last = table[table.length - 1]!;
    return { node: last.node, offset: last.node.data.length };
  };

  const a = pointAt(start);
  const b = pointAt(end);
  const range = document.createRange();
  range.setStart(a.node, a.offset);
  range.setEnd(b.node, b.offset);
  const sel = window.getSelection();
  if (!sel) return;
  sel.removeAllRanges();
  sel.addRange(range);
}

/**
 * 切换文本节点的可编辑态。
 *
 * 文档元素默认 `pointer-events: none`（同一份样式要同时服务光栅化，那边不该有
 * 任何交互语义），所以不显式打开的话 contenteditable 收不到焦点 —— 表现为
 * 「双击了，但打不出字」。
 *
 * 只在状态**真的变了**时才写属性：每帧重设 contentEditable 会打断输入法组合。
 */
function applyEditingState(node: HTMLElement, editing: boolean): void {
  const current = node.getAttribute('data-editing') === '1';
  if (current === editing) return;
  node.setAttribute('data-editing', editing ? '1' : '0');
  node.contentEditable = editing ? 'true' : 'false';
  node.style.pointerEvents = editing ? 'auto' : '';
  node.style.userSelect = editing ? 'text' : '';
  node.style.cursor = editing ? 'text' : '';
}

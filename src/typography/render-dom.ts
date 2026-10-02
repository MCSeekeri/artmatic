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
import { animLayerStyle, applyDecls, docStyle, elementStyle, imageStyle, shapePaintAttrs, textStyle } from './css';
import {
  DOC_ROOT_ATTR,
  EL_ID_ATTR,
  type ShapeElement,
  type TypographyDocument,
  type TypographyElement,
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
  return doc.elements
    .map((e) => `${e.id}:${e.kind}:${e.visible ? 1 : 0}:${e.animations.map((a) => a.id).join(',')}`)
    .join('|');
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

  for (const el of doc.elements) {
    // 隐藏的元素直接不渲染：光栅化时少一个节点，舞台上也免得出现
    // 「看不见但能选中」的幽灵元素（在图层面板里取消隐藏即可）。
    if (!el.visible) continue;
    const node = buildElement(el, opts);
    if (node) root.appendChild(node);
  }
  return root;
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
    // 用 textContent 而不是 innerHTML：文本是用户内容，
    // 走 innerHTML 等于把编辑器变成一个 HTML 注入点。
    box.textContent = el.text;
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

function syncStyleSheet(root: HTMLElement, doc: TypographyDocument): void {
  // 第一个子节点是 <style>（buildDocDom 里 prepend 的形态）。动画参数改了
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
    // 编辑态与文档内容**不能同时写**：同步每帧都跑，覆写 textContent 会把用户
    // 刚打的字抹掉、光标弹回开头。
    if (!editing && content.textContent !== el.text) content.textContent = el.text;
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
    path: el.path,
  });
  svg.setAttribute('viewBox', geo.viewBox);

  let g = svg.firstElementChild as SVGGElement | null;
  if (!g || g.tagName.toLowerCase() !== 'g') {
    svg.replaceChildren();
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
  for (const [k, v] of Object.entries(shapePaintAttrs(el))) path.setAttribute(k, v);
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

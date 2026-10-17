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
  textBoxStyle,
  textFillStyle,
  textStyle,
  textureMotifSpec,
} from './css';
import { normalizeRuns, runsSignature, type TextRun, type TextSpanStyle } from './rich-text';
import { resolveThemeColor, themeById, type TypographyTheme } from './theme';
import { groupBox } from './groups';
import {
  DOC_ROOT_ATTR,
  EL_ID_ATTR,
  GROUP_ID_ATTR,
  RUNS_SIG_ATTR,
  RUNS_WRAP_ATTR,
  SPAN_ATTR,
  normalizeStops,
  type ImageElement,
  type Paint,
  type PaintStop,
  type ShapeElement,
  type TextElement,
  type TexturePattern,
  type TypographyDocument,
  type TypographyElement,
  type TypographyGroup,
} from './document';
import { shapeGeometry } from './shapes';
import { ensureImageFx, fxKey, imageCanvasFor, imageNeedsFx } from './image-fx';
import { OFFLINE_BG, OFFLINE_ICON_PATHS, OFFLINE_INK } from '../core/offline-media';

export interface BuildDocOptions {
  /** true = 产出给光栅化的静态副本（不做 contenteditable）。 */
  forRaster?: boolean;
  /** 图片素材 → URL。返回 null 表示素材还没准备好，该元素这帧缺席。 */
  resolveImage?: (assetId: string) => string | null;
  /**
   * 图片素材是不是「脱机」的（引用了但不存在的媒体）。
   *
   * 与 `resolveImage` 返回 null 是两件事：那个是「还没准备好」（异步加载中的
   * 正常状态，这一帧缺席）；这个是「不存在」（打开工程时文件读不到、素材被
   * 移除、跨工程粘贴带来的悬空 assetId）—— 画面给暗红占位符而不是空白。
   * 不传 = 没有脱机这回事（老行为）。
   */
  isImageOffline?: (assetId: string) => boolean;
  /** 占位符上的文字（「脱机媒体」，由调用方从 i18n 注入；空 = 只画图标）。 */
  offlineLabel?: string;
  /**
   * 工程自定义配色方案（`Project.customThemes`）。文档里的 `@slot` 引用
   * 可能指向自定义方案 —— 不给的话那些颜色会静默回落默认方案
   * （「换了方案画面没变」的另一种形态）。
   */
  customThemes?: readonly TypographyTheme[];
  /**
   * 正在编辑文本的元素 id。编辑期间**不覆写 textContent**（否则每帧同步都会
   * 把用户刚打的字抹掉并把光标弹到开头），并给它开 pointer-events 与
   * contenteditable（文档元素默认是 `pointer-events: none`，否则收不到焦点）。
   */
  editingId?: string | null;
  /**
   * 图片元素的抠图 / 四角处理**异步完成**时调用（见 `typography/image-fx.ts`）。
   *
   * 舞台必须传（DOM 不会自己重绘）；光栅化那条路不用它 —— 它在截图前
   * `await ensureDocImagesFx()`，拿到的一定是处理完的结果。
   */
  onImageFxReady?: () => void;
}

const SVG_NS = 'http://www.w3.org/2000/svg';

/**
 * 占位态标记（图片元素正在显示「脱机媒体」时挂在内容节点上）。
 *
 * sync 路径靠它判断「要不要换节点」—— 素材就绪 / 消失不改 `docSignature`
 * （那只看文档结构），所以状态迁移必须在这里就地完成。
 */
const OFFLINE_ATTR = 'data-typo-offline';

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
  /*
   * 配色方案在**顶层查一次表**，往下逐层传对象。
   *
   * 不把 `doc.theme` 这一路透传下去，是因为解析发生在每个颜色上（一帧几十次），
   * 每次都 `themeById()` 查一遍 Map 是白白多出来的。也不做成模块级缓存：
   * 同一进程里可以同时存在多个文档（舞台 + 光栅化 host + lab），
   * 缓存住会造成「A 文档的颜色跑进 B 文档」这种极难查的串味。
   */
  const theme = themeById(doc.theme, opts.customThemes);
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
        const shell = buildGroupShell(doc, g, theme);
        if (shell) root.appendChild(shell);
      }
    }
    const node = buildElement(el, opts, theme);
    if (node) root.appendChild(node);
  }
  return root;
}

function buildGroupShell(
  doc: TypographyDocument,
  g: TypographyGroup,
  theme: TypographyTheme,
): HTMLElement | null {
  const box = groupBox(doc, g);
  // 没有任何可见成员就不画 —— 否则会在空处留一个孤零零的框。
  if (!box) return null;
  const shell = document.createElement('div');
  shell.className = 'typo-group';
  shell.setAttribute(GROUP_ID_ATTR, g.id);
  applyDecls(shell, groupStyle(g, box, theme));
  return shell;
}

function buildElement(
  el: TypographyElement,
  opts: BuildDocOptions,
  theme: TypographyTheme,
): HTMLElement | null {
  const shell = document.createElement('div');
  shell.className = `typo-el typo-el-${el.kind}`;
  shell.setAttribute(EL_ID_ATTR, el.id);
  applyDecls(shell, elementStyle(el));
  // 文本框背景 / 边框画在**外壳**上，在文字之下；字形填充在内层另一个节点
  // （`background-clip: text`），两者互不干扰 —— 见 css.ts::textBoxStyle。
  if (el.kind === 'text') applyDecls(shell, textBoxStyle(el, theme));

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

  const content = buildContent(el, opts, theme);
  if (!content) return null;
  cursor.appendChild(content);
  return shell;
}

/**
 * 文本元素的**字形填充**取值（`fill` 经过「行内彩色 run」这道关卡之后的实际值）。
 *
 * ⚠️ 已知限制：字形填充用 CSS `background-clip: text` 实现，它把整块的背景
 * （渐变 / 纹理）裁到**所有**字形上 —— 于是行内 run 各自的 `color` 会被一并盖掉。
 * 一旦发现任何一个 run 设了行内 `color`，这里就返回 `undefined`（回落到
 * `style.color` 那条老路）：宁可少一个能力，也不静默改掉用户已经设好的行内语义。
 * 这条限制同时写在 document.ts 的 `TextElement.fill` 上。
 */
function textFillOf(el: TextElement): Paint | undefined {
  if (!el.fill) return undefined;
  for (const run of el.runs) {
    if (run.style?.color) return undefined;
  }
  return el.fill;
}

function buildContent(
  el: TypographyElement,
  opts: BuildDocOptions,
  theme: TypographyTheme,
): Element | null {
  if (el.kind === 'text') {
    const box = document.createElement('div');
    box.className = 'typo-text';
    applyDecls(box, textStyle(el.style, theme));
    // 字形填充（渐变 / 径向 / 纹理）。放在 textStyle **之后** —— 它要能覆盖
    // textStyle 里的 `color`（裁切填充时字形本身是透明的）。
    applyDecls(box, textFillStyle(textFillOf(el), theme));
    applyRuns(box, el.runs, theme);
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
    syncShape(svg, el, theme);
    return svg;
  }

  // image
  const url = opts.resolveImage?.(el.assetId) ?? null;
  if (!url) {
    /*
     * 素材**不存在** → 脱机媒体占位图（PR / 达芬奇式暗红块）。
     * 只是还没准备好 → 这一帧缺席，与 algo 未烘好时同语义（异步就绪后重绘）。
     * 两者必须分开：给「还没准备好」也画占位符的话，正常加载会满屏闪暗红。
     */
    if (opts.isImageOffline?.(el.assetId)) return buildOfflineImage(el, opts.offlineLabel ?? '');
    return null;
  }
  return buildImageNode(el, url, opts);
}

/**
 * 图片元素的内容节点（外壳 + `<img>` 或处理后的 `<canvas>`）。build 与 sync 共用。
 *
 * 有抠图 / 非恒等四角时走 canvas（见 `typography/image-fx.ts` 的文件头：
 * snapDOM 会丢 `matrix3d`，但保留 canvas）。处理是异步的：未就绪先显示**原图**，
 * 就绪后由 `onImageFxReady` 通知宿主重绘 —— 不让用户看到空白。
 */
function buildImageNode(el: ImageElement, url: string, opts: BuildDocOptions): HTMLElement {
  const { wrapper, img: imgDecls } = imageStyle(el);
  const wrap = document.createElement('div');
  wrap.className = 'typo-image';
  applyDecls(wrap, wrapper);

  if (imageNeedsFx(el)) {
    const cv = fxCanvasNode(el, url);
    if (cv) {
      wrap.appendChild(cv);
      return wrap;
    }
    void ensureImageFx(el, url, opts.onImageFxReady);
  }

  const img = document.createElement('img');
  img.src = url;
  img.alt = '';
  img.draggable = false;
  applyDecls(img, imgDecls);
  wrap.appendChild(img);
  return wrap;
}

/**
 * 处理后的 canvas 节点；未就绪返回 null。
 *
 * `data-typo-fx` 记的是**产出这张位图的键**：就地同步靠它判断「参数 / 尺寸
 * 变了没有」—— 只看键，不再单独比宽高（键里已经含 `WxH`）。
 */
function fxCanvasNode(el: ImageElement, url: string): HTMLCanvasElement | null {
  const key = fxKey(el, url);
  const cv = imageCanvasFor(el, url);
  if (!cv) return null;
  cv.dataset.typoFx = key;
  /*
   * **不能复用 `imageStyle().img`**：这张位图已经是「按 crop 裁剪 + fit 摆放」
   * 之后的结果（尺寸就是元素框），再套一次 crop 的百分比放大 / 偏移会二次裁切。
   */
  applyDecls(cv, { width: '100%', height: '100%', display: 'block' });
  return cv;
}

/**
 * 「脱机媒体」占位节点：暗红底 + `file-x-corner` 图标 + 一行文字。
 *
 * 样式走**内联**而不是 class + 样式表：snapDOM 光栅化只拷计算样式，而排版
 * 文档的样式表不在光栅宿主里 —— 内联是「舞台」与「光栅」两条路都保证一致的
 * 唯一写法（与 `imageStyle` 同一理由）。
 *
 * 尺寸用容器查询单位（cqw）：占位符要跟着元素框缩放，而框的像素尺寸到渲染期
 * 才知道（doc 单位 × 缩放 × dpr）—— 用 px 就得在每次同步时重算内联值。
 * 颜色与字形与引擎侧（视频 / 图片片段）共用 `core/offline-media.ts`。
 */
function buildOfflineImage(el: ImageElement, label: string): HTMLElement {
  const { wrapper } = imageStyle(el);
  const wrap = document.createElement('div');
  wrap.className = 'typo-image';
  wrap.setAttribute(OFFLINE_ATTR, '1');
  applyDecls(wrap, wrapper);

  const box = document.createElement('div');
  box.setAttribute(
    'style',
    [
      'position:absolute',
      'left:0',
      'top:0',
      'width:100%',
      'height:100%',
      'box-sizing:border-box',
      // 容器查询：下面的 cqw 以这个盒为容器。
      'container-type:size',
      'display:flex',
      'flex-direction:column',
      'align-items:center',
      'justify-content:center',
      'gap:4cqw',
      `background:${OFFLINE_BG}`,
      `color:${OFFLINE_INK}`,
    ].join(';'),
  );

  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('style', 'width:22cqw;height:22cqw;flex:none');
  for (const d of OFFLINE_ICON_PATHS) {
    const p = document.createElementNS(SVG_NS, 'path');
    p.setAttribute('d', d);
    svg.appendChild(p);
  }
  box.appendChild(svg);

  if (label) {
    const text = document.createElement('span');
    text.setAttribute('style', 'font-size:7cqw;line-height:1.2;white-space:nowrap');
    text.textContent = label;
    box.appendChild(text);
  }

  wrap.appendChild(box);
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

  const theme = themeById(doc.theme, opts.customThemes);
  applyDecls(root, docStyle(doc));
  syncStyleSheet(root, doc);
  syncGroupShells(root, doc, theme);

  const shells = new Map<string, HTMLElement>();
  for (const child of Array.from(root.children)) {
    const el = child as HTMLElement;
    const id = el.getAttribute(EL_ID_ATTR);
    if (id) shells.set(id, el);
  }

  for (const el of doc.elements) {
    const shell = shells.get(el.id);
    if (!shell) continue; // 结构差异由 docSignature 触发重建，这里不做增删
    syncElement(shell, el, opts, theme);
  }
}

/**
 * 就地刷新组合外壳。
 *
 * 结构变化（成组 / 解组 / 换组）由 `docSignature` 触发整棵重建，这里只负责
 * **几何与样式**：拖一个成员时外壳要跟着长大/移动，而签名没变、不会重建。
 * 漏掉这一步的表现是「拖动组里的元素，组的背景框留在原地」。
 */
function syncGroupShells(root: HTMLElement, doc: TypographyDocument, theme: TypographyTheme): void {
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
    applyDecls(shell, groupStyle(g, box, theme));
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

function syncElement(
  shell: HTMLElement,
  el: TypographyElement,
  opts: BuildDocOptions,
  theme: TypographyTheme,
): void {
  applyDecls(shell, elementStyle(el));
  // 与 buildElement 同一份声明：就地同步时切回「无填充」由它复位。
  if (el.kind === 'text') applyDecls(shell, textBoxStyle(el, theme));

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
    applyDecls(content, textStyle(el.style, theme));
    // 与 buildContent 同一份声明：切回纯色时这里负责**复位**上一次的裁切。
    applyDecls(content, textFillStyle(textFillOf(el), theme));
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
    if (content.getAttribute(RUNS_SIG_ATTR) !== sig) applyRuns(content, el.runs, theme);
    applyEditingState(content, editing);
    return;
  }

  if (el.kind === 'shape') {
    syncShape(content as unknown as SVGSVGElement, el, theme);
    return;
  }

  /*
   * image：三种状态 —— 有 URL（`<img>`）/ 脱机（占位节点）/ 都没准备好
   * （保留现状等异步就绪）。状态迁移不走 `docSignature`（素材就绪 / 消失
   * 不改文档结构签名），所以必须在这里就地换节点。
   */
  const url = opts.resolveImage?.(el.assetId) ?? null;
  const offline = !url && opts.isImageOffline?.(el.assetId) === true;
  const wasOffline = content.hasAttribute(OFFLINE_ATTR);

  if (offline && !wasOffline) {
    content.replaceChildren(buildOfflineImage(el, opts.offlineLabel ?? ''));
    content.setAttribute(OFFLINE_ATTR, '1');
    return;
  }
  if (wasOffline) {
    if (!offline && url) {
      // 媒体回来了：换回真图（几何声明下面统一刷）。
      content.replaceChildren(buildImageNode(el, url, opts));
      content.removeAttribute(OFFLINE_ATTR);
    } else {
      // 仍在占位态（含「既没就绪也没脱机」的加载中间态 —— 那时继续显示
      // 占位符比闪一下空节点好）：只更新几何。
      applyDecls(content, imageStyle(el).wrapper);
      return;
    }
  }

  const { wrapper, img: imgDecls } = imageStyle(el);
  applyDecls(content, wrapper);

  /*
   * `<img>` ↔ `<canvas>` 的状态迁移（抠图 / 四角开关、参数变化、就绪）。
   *
   * 与 offline 同理：这些变化**不改 `docSignature`**（签名只看结构），所以
   * 必须在这里就地换节点。判据是 canvas 的**位图尺寸**也要对得上 ——
   * 元素框改了大小，旧 canvas 的位图是旧尺寸，直接留着会糊。
   */
  const child = content.firstElementChild as HTMLElement | null;
  const canvasEl = child && child.tagName === 'CANVAS' ? (child as HTMLCanvasElement) : null;
  const wantsFx = url !== null && imageNeedsFx(el);

  if (wantsFx && url) {
    if (!canvasEl || canvasEl.dataset.typoFx !== fxKey(el, url)) {
      const cv = fxCanvasNode(el, url);
      if (cv) {
        content.replaceChildren(cv);
      } else {
        // 未就绪：保留现有节点（原图或上一次的结果），处理完成后靠回调重绘。
        void ensureImageFx(el, url, opts.onImageFxReady);
      }
    }
  } else if (canvasEl && url) {
    // 关掉 fx（删了 key / quad 回恒等）：换回普通 `<img>` + CSS。
    // url 为空（素材还在加载）时保留现有节点，别造一个空 src 的 img。
    content.replaceChildren(buildImageNode(el, url, opts));
  }

  const img = content.querySelector('img');
  if (!img || !url) return;
  applyDecls(img, imgDecls);
  if (img.getAttribute('src') !== url) img.setAttribute('src', url);
}

/**
 * 把几何写进 `<svg>`。**build 与 sync 共用这一个**，所以「重建」与「就地更新」
 * 不可能产出不同的图形（这是两者能互换的前提）。
 *
 * 结构固定为 `<svg><g><path/></g></svg>`：`<g>` 只在自定义路径（按 0..100
 * authored）时才带 scale 变换。固定结构省掉了「条件插入/删除子节点」这类
 * 容易漏掉的分支。
 */
export function syncShape(svg: SVGSVGElement, el: ShapeElement, theme?: TypographyTheme): void {
  const geo = shapeGeometry(el.shape, {
    w: el.frame.w,
    h: el.frame.h,
    radius: el.radius,
    sides: el.sides,
    waist: el.waist,
    inner: el.inner,
    angle: el.angle,
    path: el.path,
    evenOdd: el.evenOdd,
  });
  svg.setAttribute('viewBox', geo.viewBox);

  syncPaintDefs(svg, el, geo.scaleFrom100 === true, theme);

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
  for (const [k, v] of Object.entries(shapePaintAttrs(el, geo.evenOdd, theme))) {
    path.setAttribute(k, v);
  }
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
function syncPaintDefs(
  svg: SVGSVGElement,
  el: ShapeElement,
  scaleFrom100: boolean,
  theme?: TypographyTheme,
): void {
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
      node.setAttribute('stop-color', resolveThemeColor(stop.color, theme));
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
  bg.setAttribute('fill', resolveThemeColor(paint.bg, theme));
  pat.appendChild(bg);

  const ink = resolveThemeColor(paint.color, theme);
  for (const motif of textureMotifs(paint.pattern, cell, thick, ink)) pat.appendChild(motif);
  defs.appendChild(pat);
}

/**
 * 图案的原始形状 → SVG 节点。
 *
 * 几何真源在 css.ts 的 `textureMotifSpec`（纯数据），这里只做「数据 → DOM」——
 * 图形与文本字形填充因此共用同一套图案，加一种纹理只改那一处 switch。
 */
function textureMotifs(
  pattern: TexturePattern,
  cell: number,
  thick: number,
  color: string,
): SVGElement[] {
  return textureMotifSpec(pattern, cell, thick, color).map((prim) => {
    const el = document.createElementNS(SVG_NS, prim.tag);
    for (const [k, v] of Object.entries(prim.attrs)) el.setAttribute(k, v);
    return el;
  });
}

/** 色标归一化：排序、钳制、不足两个时补足 —— 单色标的渐变是无效的。 */
export function sortedStops(stops: PaintStop[]): PaintStop[] {
  // 排序 / 钳制（offset 0..1）的真源在 document.normalizeStops，与 CSS 那条路共用。
  const list = normalizeStops(stops);
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
export function applyRuns(box: HTMLElement, runs: readonly TextRun[], theme?: TypographyTheme): void {
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
    applyDecls(span, spanStyle(run.style, theme));
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

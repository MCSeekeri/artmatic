/**
 * css.ts — 元素 → CSS 声明的**唯一真源**（纯函数，不碰 DOM）。
 *
 * 为什么必须只有一份：舞台（编辑器里的实时 DOM）与光栅化（离屏 DOM → snapDOM）
 * 用的是同一套样式。如果两边各写一份，「编辑器里正常、导出跑版」这种问题
 * 会非常难定位 —— 这与 ui/tokens.ts 那次教训同源（当时 grid-draw.ts 在 TS 里
 * 重抄了一份调色板，改一次配色要改两处，改漏就是「面板变了、网格没变」）。
 *
 * 产出的对象是 **kebab-case 的 CSS 声明表**，调用方（render-dom.ts）
 * 逐条写进 element.style.setProperty。
 */

import type { TextSpanStyle } from './rich-text';
import {
  normalizeStops,
  type ImageElement,
  type Paint,
  type ShapeElement,
  type TextElement,
  type TexturePattern,
  type TextStyle,
  type TypographyDocument,
  type TypographyElement,
  type TypographyGroup,
} from './document';

export type CssDecls = Record<string, string>;

export function paintCss(p: Paint): string {
  return p.kind === 'solid' ? p.color : 'transparent';
}

/** 渐变 / 纹理在文档里的 `<defs>` id 前缀。 */
export const PAINT_ID_PREFIX = 'typo-paint-';

/** 某个元素的填充 defs id。**由元素 id 派生**：同一元素每帧都得到同一个 id，
 *  否则每次 sync 都会新增一个 `<linearGradient>`，DOM 无限增长。 */
export function paintDefId(elId: string): string {
  return `${PAINT_ID_PREFIX}${elId}`;
}

/** 填充是否需要 `<defs>`（纯色 / 无填充不需要）。 */
export function paintNeedsDefs(p: Paint): boolean {
  return p.kind === 'linear' || p.kind === 'radial' || p.kind === 'texture';
}

/** SVG `fill` 属性的值。 */
export function fillAttr(p: Paint, elId: string): string {
  if (p.kind === 'solid') return p.color;
  if (p.kind === 'none') return 'transparent';
  return `url(#${paintDefId(elId)})`;
}

/** 填充的整体不透明度（0..1）。缺省 = 1。`none` 没有这个概念，一律视为 1。 */
export function paintOpacity(p: Paint): number {
  if (p.kind === 'none' || p.opacity === undefined) return 1;
  return Math.max(0, Math.min(1, p.opacity));
}

/**
 * 把一个颜色按整体不透明度混成半透明。
 *
 * 用 `color-mix(in srgb, …)` 而不是自己解析 hex 再拼 `rgba(…)`：
 * 颜色值可能是任意 CSS 颜色（`#rgb` / `rgb()` / 命名色），自己解析必然漏。
 * `>= 1` 时原样返回 —— 不透明时不留 `color-mix` 噪声（快照里更好比对）。
 */
function fade(color: string, opacity: number): string {
  if (opacity >= 1) return color;
  const pct = Math.max(0, Math.min(100, opacity * 100));
  return `color-mix(in srgb, ${color} ${Math.round(pct * 1000) / 1000}%, transparent)`;
}

function px(v: number): string {
  return `${Math.round(v * 1000) / 1000}px`;
}

function rad2deg(rad: number): number {
  return (rad * 180) / Math.PI;
}

/* ------------------------------------------------------------ 文档根 */

export function docStyle(doc: TypographyDocument): CssDecls {
  return {
    position: 'relative',
    width: px(doc.size.w),
    height: px(doc.size.h),
    // 文档背景独立于元素，且在元素之下。
    // 注意：光栅化时**不要**把这段背景带进 PNG —— 排版层是要叠到视频上的，
    // 自带不透明底会把下面的画面整个盖住。所以这里只描述「预览用的底板」，
    // 由 render-dom 决定要不要注入（forRaster 时不注入）。
    overflow: 'hidden',
    // 关键：mix-blend-mode 的混合范围必须被限制在文档内部。
    // 不加这句，元素会与页面背景（编辑器 UI / 时间轴）混合，预览与导出不一致。
    isolation: 'isolate',
    contain: 'layout size style',
  };
}

/* ------------------------------------------------------------ 元素外壳 */

/**
 * 外层：几何 + 旋转 + 不透明度 + 混合模式。
 * **动画不在这里** —— 动画预设大量使用 transform，而这里的 transform 被旋转占用。
 * 动画挂在紧接着的内层包装上（见 animLayerStyle），两者互不干扰。
 */
export function elementStyle(el: TypographyElement): CssDecls {
  return {
    position: 'absolute',
    left: px(el.frame.x),
    top: px(el.frame.y),
    width: px(el.frame.w),
    height: px(el.frame.h),
    transform: el.frame.rot ? `rotate(${rad2deg(el.frame.rot)}deg)` : 'none',
    'transform-origin': '50% 50%',
    opacity: String(el.opacity),
    'mix-blend-mode': el.blend,
    'pointer-events': 'none',
    'user-select': 'none',
    'box-sizing': 'border-box',
  };
}

/** 内层：动画的落点。每个动画一层，嵌套排列，这样多个 transform 动画可以叠加。 */
export function animLayerStyle(): CssDecls {
  return {
    position: 'absolute',
    left: '0',
    top: '0',
    width: '100%',
    height: '100%',
    'transform-origin': '50% 50%',
    'box-sizing': 'border-box',
  };
}

/* ------------------------------------------------------------ 文本 */

export function textStyle(style: TextStyle): CssDecls {
  // 竖排时「垂直对齐」在视觉上变成了水平方向，所以主轴翻转。
  const vertical = style.writingMode === 'vertical-rl';
  const vAlign =
    style.vAlign === 'middle' ? 'center' : style.vAlign === 'bottom' ? 'flex-end' : 'flex-start';

  return {
    position: 'absolute',
    left: '0',
    top: '0',
    width: '100%',
    height: '100%',
    display: 'flex',
    'flex-direction': vertical ? 'row' : 'column',
    'justify-content': vAlign,
    // 让匿名 flex item 撑满主轴宽度，text-align 才有效果。
    'align-items': 'stretch',
    'box-sizing': 'border-box',
    overflow: 'hidden',

    'font-family': style.fontFamily,
    'font-size': px(style.fontSize),
    'font-weight': String(style.fontWeight),
    'font-style': style.fontStyle,
    'letter-spacing': px(style.letterSpacing),
    'line-height': String(style.lineHeight),
    'text-align': style.align,
    color: style.color,
    'text-decoration': style.textDecoration,
    'text-transform': style.textTransform,
    'white-space': 'pre-wrap',
    'word-break': 'break-word',
    'writing-mode': style.writingMode,
    'text-autospace': style.textAutospace ?? 'none',
    // 文档内容不该继承编辑器/页面的字体回退差异。
    margin: '0',
    padding: '0',
    border: '0',
    background: 'transparent',
  };
}

/**
 * 文本框的**背景与边框** → 写在元素外壳（`.typo-el`）上的 CSS 声明。
 *
 * 与 `textFillStyle`（字形着色，走内层 `.typo-text` 的
 * `background-clip: text`）分属两个节点，所以互不干扰：这一层在文字**之下**，
 * 是「文本框底色 / 边框」；那一层裁到字形上，是「字的颜色」。
 *
 * 三件与字形路径对齐的事：
 *  - 渐变色标与 `paintToBackground` 一样过 `cssStops` 归一化（排序 + 高精度
 *    百分比），否则同一个文档在「组合壳」与「文本框」上会排成不同的渐变；
 *  - 纹理复用 `textFillBackgroundImage`（内联 SVG 平铺），不是回落到纯底色
 *    —— 图形与字形都能平铺，文本框没理由比它们少；
 *  - **总是返回完整声明**：就地同步（syncDocDom）不重建节点，切回「无填充」
 *    时必须能把上一份 background 复位。
 */
export function textBoxStyle(el: TextElement): CssDecls {
  const fill = el.boxFill;
  const out: CssDecls = {};
  if (fill && fill.kind === 'solid') {
    out['background-color'] = fade(fill.color, paintOpacity(fill));
    out['background-image'] = 'none';
    out['background-size'] = 'auto';
  } else if (fill && fill.kind !== 'none') {
    const cell = fill.kind === 'texture' ? Math.max(2, fill.scale) : null;
    out['background-color'] = 'transparent';
    out['background-image'] = textFillBackgroundImage(fill);
    // 纹理按周期平铺（与 textFillStyle 同一口径），渐变铺满整个文本框。
    out['background-size'] = cell === null ? 'auto' : `${cell}px ${cell}px`;
  } else {
    out['background-color'] = 'transparent';
    out['background-image'] = 'none';
    out['background-size'] = 'auto';
  }
  out['background-repeat'] = 'repeat';

  const s = el.boxStroke;
  // 无边框写 `0 solid transparent` 而不是 `none`：声明表逐键同构，
  // 「有 → 无」在就地同步下才能逐键复位（没有删除语义）。
  out.border = s ? `${px(Math.max(0, s.width))} ${s.style ?? 'solid'} ${s.color}` : '0 solid transparent';
  return out;
}

/* ------------------------------------------------------------ 图形 */

/**
 * 图形用 `<path>` 画在**与元素盒等尺寸的 viewBox** 里（`0 0 w h`），所以缩放是
 * 1:1，描边宽度可以直接用文档 px。
 *
 * 早期版本用 `viewBox="0 0 100 100"` + `preserveAspectRatio="none"` 拉伸，代价是
 * 非等比缩放时边框一边粗一边细（水平边按 sy 缩放、垂直边按 sx）—— 看起来就像
 * 被 `transform: scale()` 拉歪了。改成像素盒之后这类换算整体消失。
 */
export function shapePaintAttrs(el: ShapeElement, evenOdd = false): CssDecls {
  const attrs: CssDecls = {
    fill: fillAttr(el.fill, el.id),
    // 圆环 / 方框靠**嵌套子路径 + evenodd** 挖洞，不用 evenodd 的话内圈会被填满，
    // 看起来就是一个实心圆/矩形 —— 形状参数全都"没生效"。
    'fill-rule': evenOdd ? 'evenodd' : 'nonzero',
    stroke: 'none',
    'stroke-width': '0',
    'stroke-linejoin': 'round',
    'stroke-linecap': 'round',
  };
  // 填充的整体不透明度：**一处 fill-opacity 就覆盖纯色 / url(#渐变) / url(#pattern)**，
  // 不必分别处理三种填充。不透明时不写这个属性，保持老工程渲染结果逐字节不变。
  const fillOpacity = paintOpacity(el.fill);
  if (fillOpacity < 1) attrs['fill-opacity'] = String(fillOpacity);
  if (!el.stroke) return attrs;

  attrs.stroke = el.stroke.color;
  attrs['stroke-width'] = String(Math.max(0, el.stroke.width));
  if (el.stroke.style === 'dashed') attrs['stroke-dasharray'] = '6 4';
  if (el.stroke.style === 'dotted') attrs['stroke-dasharray'] = '1 3';
  return attrs;
}

/* ------------------------------------------------------------ 图片 */

/**
 * 裁剪用「外层裁窗 + 内层按比例放大并偏移」实现：
 *   crop = {x,y,w,h}（相对源图的 0..1）
 * 内层图片的尺寸是 100/cw %、位置是 -cx/cw * 100 %，
 * 于是 crop 矩形正好铺满外层元素框。fit 作用在内层 <img> 上。
 */
export function imageStyle(el: ImageElement): { wrapper: CssDecls; img: CssDecls } {
  const c = el.crop;
  const wrapper: CssDecls = {
    position: 'absolute',
    left: '0',
    top: '0',
    width: '100%',
    height: '100%',
    overflow: 'hidden',
    'border-radius': el.radius ? px(el.radius) : '0',
    'box-sizing': 'border-box',
  };

  if (!c || c.w <= 0 || c.h <= 0) {
    return {
      wrapper,
      img: {
        width: '100%',
        height: '100%',
        'object-fit': el.fit,
        display: 'block',
      },
    };
  }

  return {
    wrapper,
    img: {
      position: 'absolute',
      width: `${(100 / c.w).toFixed(4)}%`,
      height: `${(100 / c.h).toFixed(4)}%`,
      left: `${((-c.x / c.w) * 100).toFixed(4)}%`,
      top: `${((-c.y / c.h) * 100).toFixed(4)}%`,
      'object-fit': el.fit,
      display: 'block',
      'max-width': 'none',
    },
  };
}

/* ------------------------------------------------------------ 组合外壳 */

/**
 * 组合的共享外壳 → CSS 声明。
 *
 * 它是**普通 DOM 盒子**（不是 SVG），所以填充直接用 CSS：
 *  - 纯色 → `background-color`
 *  - 线性 / 径向渐变 → `linear-gradient` / `radial-gradient`
 *  - 纹理 → 回落到底色（CSS 里复刻那套 SVG pattern 需要另一份实现，
 *    而组合壳的纹理几乎没人用；宁可少一个能力，也不要两套会分家的图案代码）
 *
 * 角度换算：本项目的 Paint 角度是「0° = 左→右，顺时针」，
 * 而 CSS 的 `0deg` 是「从下往上、顺时针」⇒ 加 90°。
 */
export function groupStyle(
  g: TypographyGroup,
  box: { x: number; y: number; w: number; h: number },
): CssDecls {
  const decls: CssDecls = {
    position: 'absolute',
    left: px(box.x),
    top: px(box.y),
    width: px(box.w),
    height: px(box.h),
    'border-radius': g.radius ? px(g.radius) : '0',
    'box-sizing': 'border-box',
    'pointer-events': 'none',
    background: paintToBackground(g.fill),
  };
  if (g.stroke) {
    decls.border = `${px(g.stroke.width)} ${g.stroke.style ?? 'solid'} ${g.stroke.color}`;
  }
  return decls;
}

/**
 * 色标位置 → CSS 百分比。
 *
 * 三位小数（`33.33%`）而不是取整到一起：`Math.round(offset * 100)` 会把
 * 0.3333 与 0.3349 压成同一个 33% —— 面板上拖色标时手一停位置就跳，
 * 而且与 SVG 那条路（用原始 float）对不上。
 */
function stopPct(offset: number): string {
  return `${Math.round(offset * 100000) / 1000}%`;
}

/** 渐变色标的 CSS 片段（`色 33.33%`），排序归一化与 SVG 那条路共用。 */
function cssStops(p: Paint, op: number): string {
  return normalizeStops(p.kind === 'linear' || p.kind === 'radial' ? p.stops : [])
    .map((s) => `${fade(s.color, op)} ${stopPct(s.offset)}`)
    .join(', ');
}

export function paintToBackground(p: Paint): string {
  // 整体不透明度按**色标**乘进去（CSS 背景没有「层不透明度」这种属性）。
  const op = paintOpacity(p);
  switch (p.kind) {
    case 'solid':
      return fade(p.color, op);
    case 'linear': {
      return `linear-gradient(${Math.round(p.angle + 90)}deg, ${cssStops(p, op)})`;
    }
    case 'radial': {
      return `radial-gradient(circle at 50% 50%, ${cssStops(p, op)})`;
    }
    case 'texture':
      // 组合壳的纹理回落到**底色**（见 groupStyle 的说明），所以这里只乘底色。
      return fade(p.bg, op);
    default:
      return 'transparent';
  }
}

/**
 * 富文本的**内层容器**。
 *
 * ⚠️ **必须有这一层。** `.typo-text` 是 `display: flex`（靠它做垂直对齐），
 * 而 **flex 容器的每一个子元素都会被块级化** —— 直接把每段文字的 `<span>`
 * 挂进去，每段就各占一行：一个 6 字的标题只要中间加粗两个字，就会断成三行。
 * 外面套一个普通块级盒子之后，flex 项只有它一个，行内的 span 恢复正常流。
 *
 * 用 `<span>` + `display: block` 而不是 `<div>`：这样「编辑区里除了行内段
 * 不该有块级标签」这条判据仍然只看标签名就成立（见 rich-text 的遍历约定）。
 */
export function runsWrapperStyle(): CssDecls {
  return { display: 'block', width: '100%', 'min-width': '0' };
}

/* ------------------------------------------------------------ 纹理几何（纯数据） */

/**
 * 一个 SVG 图元的**纯数据**描述（标签 + 属性）。
 *
 * 纹理图案只有一套几何，却有两个消费方：图形走真实的 SVG `<pattern>`（render-dom），
 * 文本字形填充走内联的 `data:image/svg+xml`（本文件）。把它抽成纯数据是为了
 * **不让两套图案代码分家** —— 加一种纹理只改这里的 switch，两个渲染路径同时生效。
 */
export interface SvgPrimitive {
  tag: string;
  attrs: Record<string, string>;
}

/** 图案的原始形状（cell = 一个周期；thick = 线宽；color = 线/点色）。 */
export function textureMotifSpec(
  pattern: TexturePattern,
  cell: number,
  thick: number,
  color: string,
): SvgPrimitive[] {
  const line = (x1: number, y1: number, x2: number, y2: number): SvgPrimitive => ({
    tag: 'line',
    attrs: {
      x1: String(x1),
      y1: String(y1),
      x2: String(x2),
      y2: String(y2),
      stroke: color,
      'stroke-width': String(thick),
    },
  });
  const half = cell / 2;
  switch (pattern) {
    case 'dots':
      return [
        { tag: 'circle', attrs: { cx: String(half), cy: String(half), r: String(thick), fill: color } },
      ];
    case 'grid':
      // 画在上/左两条边上，平铺之后就是一整张网格。
      return [line(0, 0, cell, 0), line(0, 0, 0, cell)];
    case 'diagonal':
      return [line(0, cell, cell, 0)];
    case 'cross':
      return [line(0, 0, cell, cell), line(0, cell, cell, 0)];
    case 'checker':
      return [
        { tag: 'rect', attrs: { x: '0', y: '0', width: String(half), height: String(half), fill: color } },
        {
          tag: 'rect',
          attrs: { x: String(half), y: String(half), width: String(half), height: String(half), fill: color },
        },
      ];
    case 'wave': {
      // 一个周期的正弦（两个二次贝塞尔拼）。控制点取 4/3·(√2−1) 的近似，
      // 0.55 是肉眼看着最像正弦的那个系数。
      const d = `M0,${half} Q${cell * 0.25},${half - cell * 0.55} ${half},${half} Q${cell * 0.75},${half + cell * 0.55} ${cell},${half}`;
      return [{ tag: 'path', attrs: { d, fill: 'none', stroke: color, 'stroke-width': String(thick) } }];
    }
    default:
      return [];
  }
}

/* ------------------------------------------------------------ 文本字形填充 */

/**
 * 文本元素 → 字形填充的 CSS 声明。
 *
 * 实现是 CSS 的 `background-clip: text`（渐变 / 径向 / 纹理裁到字形上），
 * **总是返回一份完整声明**：不仅要设上，也要在「切回纯色」时把上一帧残留的
 * 裁切复位 —— 就地同步（syncDocDom）不会重建节点，残留的 `background-clip`
 * 会让 `style.color` 再也显不出来。
 *
 * 只有 `linear` / `radial` / `texture` 才覆盖字形着色；`solid` / `none` /
 * `undefined` 一律复位，交回 `style.color` 那条老路（见 TextElement.fill 的语义）。
 */
export function textFillStyle(fill: Paint | undefined): CssDecls {
  const usable =
    fill && fill.kind !== 'none' && fill.kind !== 'solid' ? fill : null;
  if (!usable) {
    return {
      'background-image': 'none',
      'background-size': 'auto',
      'background-repeat': 'repeat',
      'background-clip': 'border-box',
      '-webkit-background-clip': 'border-box',
    };
  }
  // 纹理要按周期平铺（background-size = 一个周期），渐变则铺满整个文本框（auto）。
  const cell = usable.kind === 'texture' ? Math.max(2, usable.scale) : null;
  return {
    'background-image': textFillBackgroundImage(usable),
    'background-clip': 'text',
    '-webkit-background-clip': 'text',
    'background-repeat': 'repeat',
    'background-size': cell === null ? 'auto' : `${cell}px ${cell}px`,
    color: 'transparent',
  };
}

/** 文本字形填充的 `background-image`：渐变 / 径向直接映射成 CSS，纹理转成内联 SVG。 */
export function textFillBackgroundImage(p: Paint): string {
  const op = paintOpacity(p);
  switch (p.kind) {
    case 'linear':
      return `linear-gradient(${Math.round(p.angle + 90)}deg, ${cssStops(p, op)})`;
    case 'radial':
      return `radial-gradient(circle at 50% 50%, ${cssStops(p, op)})`;
    case 'texture':
      return textureDataUri(p, op);
    default:
      return 'none';
  }
}

/**
 * 纹理 → `url("data:image/svg+xml,…")`。
 *
 * 与图形共用 `textureMotifSpec` 的几何；整体不透明度用一层 `<g opacity>` 表达
 * —— 在 SVG 属性里用 `color-mix()` 的兼容性不稳，而组透明度哪都认。
 * 色标里的 `#` 交给 `encodeURIComponent` 转义成 `%23`，data-URI 才不会断。
 */
function textureDataUri(paint: Extract<Paint, { kind: 'texture' }>, opacity: number): string {
  const cell = Math.max(2, paint.scale);
  const thick = Math.max(0.2, paint.thickness);
  const body: string[] = [
    `<rect x="0" y="0" width="${cell}" height="${cell}" fill="${paint.bg}"/>`,
  ];
  for (const prim of textureMotifSpec(paint.pattern, cell, thick, paint.color)) {
    const attrs = Object.entries(prim.attrs)
      .map(([k, v]) => `${k}="${v}"`)
      .join(' ');
    body.push(`<${prim.tag} ${attrs}/>`);
  }
  const op = opacity < 1 ? ` opacity="${Math.round(opacity * 1000) / 1000}"` : '';
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${cell}" height="${cell}">` +
    `<defs><pattern id="p" patternUnits="userSpaceOnUse" width="${cell}" height="${cell}">` +
    `<g${op}>${body.join('')}</g>` +
    `</pattern></defs><rect width="100%" height="100%" fill="url(#p)"/></svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
}

/* ------------------------------------------------------------ 行内富文本 */

/**
 * 一段文本的**局部覆盖** → CSS。
 *
 * **只写被覆盖的那几项**，其余一律继承 `.typo-text` 上的元素级样式。
 * 「先铺满一份完整样式再改一项」的话，元素级之后改一次就传不下去了 ——
 * 把整块字从 97 调到 120 时，被单独加粗过的那一段会停在旧字号。
 *
 * 段落级属性（行高 / 对齐 / 竖排）刻意**不在**覆盖范围内：同一行里两种行高
 * 谁也画不对，见 rich-text.ts 里 `SPAN_STYLE_KEYS` 的说明。
 */
export function spanStyle(span: TextSpanStyle | undefined): CssDecls {
  if (!span) return {};
  const out: CssDecls = {};
  if (span.fontFamily !== undefined) out['font-family'] = span.fontFamily;
  if (span.fontSize !== undefined) out['font-size'] = px(span.fontSize);
  if (span.fontWeight !== undefined) out['font-weight'] = String(span.fontWeight);
  if (span.fontStyle !== undefined) out['font-style'] = span.fontStyle;
  if (span.letterSpacing !== undefined) out['letter-spacing'] = px(span.letterSpacing);
  if (span.color !== undefined) out.color = span.color;
  if (span.textDecoration !== undefined) out['text-decoration'] = span.textDecoration;
  return out;
}

/* ------------------------------------------------------------ 工具 */

/** 把声明表写进元素的内联样式。唯一写样式的出口。 */
export function applyDecls(el: HTMLElement | SVGElement, decls: CssDecls): void {
  for (const [k, v] of Object.entries(decls)) el.style.setProperty(k, v);
}

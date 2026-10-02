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

import type {
  ImageElement,
  Paint,
  ShapeElement,
  TextStyle,
  TypographyDocument,
  TypographyElement,
} from './document';

export type CssDecls = Record<string, string>;

export function paintCss(p: Paint): string {
  return p.kind === 'solid' ? p.color : 'transparent';
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

/* ------------------------------------------------------------ 图形 */

/**
 * 图形用 `<path>` 画在**与元素盒等尺寸的 viewBox** 里（`0 0 w h`），所以缩放是
 * 1:1，描边宽度可以直接用文档 px。
 *
 * 早期版本用 `viewBox="0 0 100 100"` + `preserveAspectRatio="none"` 拉伸，代价是
 * 非等比缩放时边框一边粗一边细（水平边按 sy 缩放、垂直边按 sx）—— 看起来就像
 * 被 `transform: scale()` 拉歪了。改成像素盒之后这类换算整体消失。
 */
export function shapePaintAttrs(el: ShapeElement): CssDecls {
  const attrs: CssDecls = {
    fill: paintCss(el.fill),
    stroke: 'none',
    'stroke-width': '0',
    'stroke-linejoin': 'round',
    'stroke-linecap': 'round',
  };
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

/* ------------------------------------------------------------ 工具 */

/** 把声明表写进元素的内联样式。唯一写样式的出口。 */
export function applyDecls(el: HTMLElement | SVGElement, decls: CssDecls): void {
  for (const [k, v] of Object.entries(decls)) el.style.setProperty(k, v);
}

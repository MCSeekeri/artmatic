/**
 * format-painter.ts — 「格式刷 / 动画刷」的**纯逻辑**（无 DOM / 无时钟 / 可单测）。
 *
 * 两件事：
 *  1. `applyElementFormat(source, target)` —— 把 source 的**外观**写给 target；
 *  2. `applyElementAnimations(source, target)` —— 把 source 的动画条目复制给 target。
 *
 * ## 为什么按种类分字段，而不是「把整个元素浅拷贝过去」
 *
 * 元素的字段里混着**三种东西**：内容（`runs` / `assetId`）、几何（`frame` /
 * `transform3d`）、外观（`fill` / `stroke` / `radius` / 图片的各项处理）。格式刷
 * 只该搬第三种 —— 拷贝 `frame` 会把目标元素挪到源元素的位置上（「我只是想刷个
 * 颜色」），拷贝 `assetId` 会直接把图片换掉。
 *
 * ## 跨种类怎么落
 *
 * 图形和文本框各有一套「底色 + 边框」：图形是 `fill` / `stroke`，文本框是
 * `boxFill` / `boxStroke`（文本框背景与边框，见 document.ts）。所以图形 → 文本框
 * 时**落到盒子上**，反过来也是 —— 这正是用户在 Office 里期望的（从图形刷到
 * 文本框，得到同色底 + 同色边框）。字形的 `fill` / `glyphStroke` 是文本独有的，
 * 只在文本框之间搬。
 *
 * 图片的 `radius` 与图形共用一个名字，所以跨种类也搬（都是「圆角大小」）。
 *
 * **目标没有的字段一律静默跳过**（图形没有 `fit`、文本框没有 `crop`…），这与
 * 用户的要求一致：刷子不该报错，也不该为了「对齐」去给目标凭空造字段。
 *
 * ## 不搬的东西（有意）
 *
 * `opacity` / `blend`：那是**图层**属性（影响与底下内容的合成），不是「格式」。
 * Figma 的 Copy properties 也是这个口径 —— 它复制 effects / stroke / fill，但不
 * 复制不透明度。搬过来会让「我只想刷个填充」变成「整块变半透明」，而且很难看出
 * 是哪一步带过来的。
 */

import { newId } from '../core/schema';
import type { AnimTiming, ElementAnimation } from './animation';
import type { TypographyElement } from './document';

/** 深拷贝一份可选值（`undefined` / `null` 原样返回，不产生 `{}`）。 */
function copy<T>(v: T): T {
  if (v === undefined || v === null) return v;
  return structuredClone(v);
}

/**
 * 把 `source` 的外观写给 `target`（**原地改 target**）。
 *
 * 返回是否真的动了文档：全被跳过（例如从纯图形刷到纯图片）时返回 false，
 * 调用方据此决定要不要开一笔撤销（空中一笔撤销很脏）。
 */
export function applyElementFormat(source: TypographyElement, target: TypographyElement): boolean {
  if (source.id === target.id) return false;
  let changed = false;

  /* ---------------------------------------------------------- 通用外观 */

  // 阴影 / 虚化：三种元素都有，且都是「看得见的样子」。
  if (source.shadows !== undefined || target.shadows !== undefined) {
    const next = copy(source.shadows);
    if (JSON.stringify(next) !== JSON.stringify(target.shadows)) {
      if (next === undefined) delete target.shadows;
      else target.shadows = next;
      changed = true;
    }
  }
  if ((source.blur ?? 0) !== (target.blur ?? 0)) {
    if (source.blur) target.blur = source.blur;
    else delete target.blur;
    changed = true;
  }

  /* -------------------------------------------------------------- 填充 */

  /*
   * 「填充」按目标种类落地：
   *  · 图形 ← 图形的 fill（或文本框的 boxFill）
   *  · 文本框 ← 图形的 fill 落到 boxFill（文本框**底**），字形 fill 只在文本之间搬
   *
   * `imageFill`（用一张素材当图形底色）跟 fill 是一对：源没有它就必须**清掉**
   * 目标的，否则刚刷过去的纯色填充会被图片盖住 —— 表现是「刷了没反应」。
   */
  if (target.kind === 'shape') {
    if (source.kind === 'shape') {
      target.fill = copy(source.fill);
      if (source.imageFill) target.imageFill = copy(source.imageFill);
      else delete target.imageFill;
      changed = true;
    } else if (source.kind === 'text' && source.boxFill) {
      target.fill = copy(source.boxFill);
      delete target.imageFill;
      changed = true;
    }
  } else if (target.kind === 'text') {
    if (source.kind === 'shape' && !source.imageFill) {
      target.boxFill = copy(source.fill);
      changed = true;
    } else if (source.kind === 'text') {
      if (source.boxFill) target.boxFill = copy(source.boxFill);
      else delete target.boxFill;
      // 字形填充：只在文本之间搬（图形的填充不是「字色」）。
      if (source.fill) target.fill = copy(source.fill);
      else delete target.fill;
      changed = true;
    }
  }

  /* -------------------------------------------------------------- 描边 */

  if (target.kind === 'shape') {
    const out = source.kind === 'shape' ? source.stroke : source.kind === 'text' ? source.boxStroke : undefined;
    if (out !== undefined) {
      target.stroke = out ? copy(out) : null;
      changed = true;
    }
  } else if (target.kind === 'text') {
    if (source.kind === 'shape') {
      if (source.stroke) target.boxStroke = copy(source.stroke);
      else delete target.boxStroke;
      changed = true;
    } else if (source.kind === 'text') {
      if (source.boxStroke) target.boxStroke = copy(source.boxStroke);
      else delete target.boxStroke;
      if (source.glyphStroke) target.glyphStroke = copy(source.glyphStroke);
      else delete target.glyphStroke;
      changed = true;
    }
  }

  /* -------------------------------------------------------------- 圆角 */

  // 圆角在图形与图片上同名同义（文档 px），跨种类照搬。
  if (
    (target.kind === 'shape' || target.kind === 'image') &&
    (source.kind === 'shape' || source.kind === 'image')
  ) {
    const r = source.radius;
    if ((target.radius ?? 0) !== (r ?? 0)) {
      if (r === undefined) delete target.radius;
      else target.radius = r;
      changed = true;
    }
  }

  /* -------------------------------------------------------------- 文本 */

  if (target.kind === 'text' && source.kind === 'text') {
    // 整块排版样式：字体 / 字号 / 字重 / 行距 / 对齐 / 字色 / 装饰 / 高亮…
    target.style = copy(source.style);
    changed = true;
  }

  /* -------------------------------------------------------------- 图片 */

  if (target.kind === 'image' && source.kind === 'image') {
    /*
     * `assetId` 是**内容**，不搬。其余都是「这张图怎么被处理和摆放的」：
     * 适配方式、裁剪窗、色键抠图、四角透视、色彩校正、重新着色、边框、滤镜。
     */
    target.fit = source.fit;
    if (source.crop) target.crop = copy(source.crop);
    else delete target.crop;
    if (source.key) target.key = copy(source.key);
    else delete target.key;
    if (source.quad) target.quad = copy(source.quad);
    else delete target.quad;
    if (source.adjust) target.adjust = copy(source.adjust);
    else delete target.adjust;
    if (source.recolor) target.recolor = copy(source.recolor);
    else delete target.recolor;
    if (source.border) target.border = copy(source.border);
    else delete target.border;
    if (source.filter) target.filter = copy(source.filter);
    else delete target.filter;
    changed = true;
  }

  return changed;
}

/**
 * 动画条目深拷贝（**换新 id**）。
 *
 * id 是 CSS 规则的命名空间（`[data-anim-id="…"]` + `@keyframes artmatic-a-<id>`）：
 * 两个元素共享同一个 id 会把它们的动画绑成一份 —— 改一个另一个跟着变，而且
 * 关键帧面板按 id 定位条目时会撞车。所以必须重新发号。
 *
 * 手写深拷贝而不是 `structuredClone` 整体过一遍：`iterations` 可能是 **Infinity**
 * （循环），任何走 JSON 的深拷贝都会把它变成 null（CSS 里就是「播 1 次」）。
 */
export function cloneAnimations(list: readonly ElementAnimation[]): ElementAnimation[] {
  return list.map((a) => {
    const base: AnimTiming = {
      delay: a.delay,
      duration: a.duration,
      iterations: a.iterations,
      easing: Array.isArray(a.easing) ? ([...a.easing] as AnimTiming['easing']) : a.easing,
      direction: a.direction,
      fill: a.fill,
    };
    if (a.kind === 'preset') {
      return { ...base, id: newId(), kind: 'preset', preset: a.preset, ...(a.params ? { params: { ...a.params } } : {}) };
    }
    if (a.kind === 'custom') {
      return { ...base, id: newId(), kind: 'custom', css: a.css, ...(a.animation ? { animation: a.animation } : {}) };
    }
    return {
      ...base,
      id: newId(),
      kind: 'tracks',
      prop: a.prop,
      keys: a.keys.map((k) => ({
        t: k.t,
        v: k.v,
        ...(k.ease === undefined ? {} : { ease: k.ease === null ? null : copy(k.ease) }),
        // 标记色是「编排意图」的一部分，刷子一并搬过去（漏了就是静默丢标记）。
        ...(k.color ? { color: k.color } : {}),
      })),
    };
  });
}

/**
 * 把 source 的动画整份写给 target（原地改 target）。
 *
 * **整份替换而不是追加**：格式刷的语义是「变成和它一样」，追加会让重复点两次的
 * 结果翻倍。返回是否真的改了（源没有动画 = 清空目标 —— 那也是一次真实的改动，
 * 与「刷成一样」一致）。
 */
export function applyElementAnimations(source: TypographyElement, target: TypographyElement): boolean {
  if (source.id === target.id) return false;
  // 两边都没有动画、或内容本来就一样 = 无事可做（别开一笔空撤销）。
  if (!source.animations.length && !target.animations.length) return false;
  if (animationsEquivalent(source.animations, target.animations)) return false;
  target.animations = cloneAnimations(source.animations);
  return true;
}

/**
 * 两组动画的**内容**是否一样（忽略 id）。
 *
 * id 每次复制都会换新的（见 `cloneAnimations`），所以「重复刷一次」在字节层面
 * 永远不同。判断要不要真写库时看内容：一样就别开一笔空撤销。
 * `JSON.stringify` 会把 Infinity 变成 null，但两边同规则，比较依然正确。
 */
export function animationsEquivalent(
  a: readonly ElementAnimation[],
  b: readonly ElementAnimation[],
): boolean {
  const strip = (list: readonly ElementAnimation[]): unknown[] =>
    list.map((item) => {
      const { id: _id, ...rest } = item;
      return rest;
    });
  return JSON.stringify(strip(a)) === JSON.stringify(strip(b));
}

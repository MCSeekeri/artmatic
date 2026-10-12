/**
 * bake-animation.ts — 把 CSS 动画定位到某个时刻（**有 DOM**）。
 *
 * 两个入口，共享同一个 seek 内核：
 *   seekAnimations()  只 seek，不动 DOM —— 给编辑器舞台用，它要反复 seek。
 *   bakeAnimations()  seek 之后把计算结果固化进内联样式并停掉动画 —— 给光栅化用。
 *
 * 为什么必须分开：烘焙会把 `animation` 置为 none，动画从此不再响应 seek；
 * 舞台用它就等于「预览一次之后就再也不动了」。而光栅化用的是每帧新建的
 * 临时 DOM，烘焙反而能消除各截图库对动画状态的不同处理
 * （技术笔记实测 html2canvas-pro 会丢掉动画状态，停在 x=100 却渲在 x=8）。
 *
 * ADR-003 规则 ④ 的落地处。WAAPI 的 seek 是精确的（实测误差 0），
 * 所以 CSS 动画可以做帧精确导出，但必须走这条烘焙路径。
 */

import { animationCurrentTimeMs, customSubAnimations, ANIM_ID_ATTR, type ElementAnimation } from './animation';
import type { TypographyDocument } from './document';

export type AnimValueSnapshot = {
  el: HTMLElement;
  transform: string;
  opacity: string;
  filter: string;
};

/** 文档里所有动画：id → 定义。 */
export function animationSpecs(doc: TypographyDocument): Map<string, ElementAnimation> {
  const out = new Map<string, ElementAnimation>();
  for (const el of doc.elements) for (const a of el.animations) out.set(a.id, a);
  return out;
}

function animLayers(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(`[${ANIM_ID_ATTR}]`));
}

/**
 * 把 root 内所有动画 seek 到 localSec。
 * 调用方必须保证 root **已经挂进文档** —— 脱离文档的元素拿不到 CSSAnimation，
 * `getAnimations()` 会返回空数组，表现为「动画永远停在第一帧」。
 *
 * 一个动画层可能同时挂着**多条动画**（自定义条目的逗号简写，见 animation.ts）：
 * 每条各有自己的延迟。`getAnimations()` 按简写里的顺序返回它们，所以逐条用
 * 各自的延迟 seek。预设 / 旧单 body 自定义只有一条、延迟 = spec.delay，
 * 结果与扩展前逐字一致。数量对不上时整层退回 spec.delay（防御，正常不会发生）。
 */
export function seekAnimations(
  root: HTMLElement,
  specs: Map<string, ElementAnimation>,
  localSec: number,
): void {
  for (const layer of animLayers(root)) {
    const animId = layer.getAttribute(ANIM_ID_ATTR);
    if (!animId) continue;
    const spec = specs.get(animId);
    if (!spec) continue;
    const parts = customSubAnimations(spec);
    const list = layer.getAnimations();
    const perPart = list.length === parts.length;
    list.forEach((a, i) => {
      const delay = perPart ? parts[i]!.delay : spec.delay;
      a.pause();
      a.currentTime = animationCurrentTimeMs({ delay }, localSec);
    });
  }
}

/** 读一遍即将被烘焙掉的属性。 */
function snapshot(layers: HTMLElement[]): AnimValueSnapshot[] {
  return layers.map((el) => {
    const cs = getComputedStyle(el);
    return { el, transform: cs.transform, opacity: cs.opacity, filter: cs.filter };
  });
}

/**
 * seek + 烘焙。返回快照数组便于测试断言（快照就是在写内联之前的计算值）。
 *
 * 顺序很关键：**先停动画，再写内联**。CSS 动画在层叠里压过内联样式，
 * 反过来的话我们写进去的值会被动画的计算值盖掉，等于什么都没做，
 * 而且看起来「有时候对有时候不对」，极难定位。
 *
 * 一个条目里无论几条动画（逗号简写）都渲染成**同一层**（render-dom.ts），
 * 所以这里逐层快照即可：计算值已经叠加了该层所有动画的结果，多动画不需要
 * 单独的处理分支。嵌套只发生在**多个条目**之间（每条目一层）。
 */
export function bakeAnimations(
  root: HTMLElement,
  specs: Map<string, ElementAnimation>,
  localSec: number,
): AnimValueSnapshot[] {
  seekAnimations(root, specs, localSec);

  const layers = animLayers(root);
  if (layers.length === 0) return [];

  const snaps = snapshot(layers);
  for (const s of snaps) s.el.style.animation = 'none';
  for (const s of snaps) {
    if (s.transform && s.transform !== 'none') s.el.style.transform = s.transform;
    if (s.opacity) s.el.style.opacity = s.opacity;
    if (s.filter && s.filter !== 'none') s.el.style.filter = s.filter;
  }
  return snaps;
}

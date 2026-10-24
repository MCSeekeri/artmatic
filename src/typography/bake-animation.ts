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

import { animationCurrentTimeMs, ANIM_ID_ATTR, type ElementAnimation } from './animation';
import type { TypographyDocument } from './document';

export type AnimValueSnapshot = {
  el: HTMLElement;
  /** CSS 属性名（kebab-case）→ 该时刻的计算值。 */
  values: Map<string, string>;
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
 * 一个动画层可能同时挂着**多条动画**（自定义条目的逗号简写，见 animation.ts），
 * 每条各有自己的 delay —— 但延迟已经写进 CSS 简写（`animationShorthand`），属于
 * effect timing，因此 `currentTime` 对每一条都是**同一个绝对时间**。别再按
 * `localSec - delay` 逐条换算：那会把延迟算两遍，起点的 `currentTime` 要走到
 * `delay` 才进 active 段（delay=3s ⇒ 6s 才开始），且全程不报错。
 */
export function seekAnimations(
  root: HTMLElement,
  specs: Map<string, ElementAnimation>,
  localSec: number,
): void {
  const currentTime = animationCurrentTimeMs(localSec);
  for (const layer of animLayers(root)) {
    const animId = layer.getAttribute(ANIM_ID_ATTR);
    if (!animId) continue;
    if (!specs.has(animId)) continue;
    for (const a of layer.getAnimations()) {
      a.pause();
      a.currentTime = currentTime;
    }
  }
}

/**
 * `getKeyframes()` 里不是 CSS 属性的键（WAAPI 的元数据）。
 * 漏掉一个的后果：它会被当成属性名去读计算值，读回空串（无害），但值是对象时
 * 会拼出 `[object Object]` 写进内联样式。
 */
const KEYFRAME_META_KEYS = new Set(['offset', 'computedOffset', 'easing', 'composite']);

/** WAAPI 的键名是 camelCase（`letterSpacing`），CSS 侧一律 kebab-case。 */
function cssPropName(key: string): string | null {
  if (KEYFRAME_META_KEYS.has(key)) return null;
  // `--*` 自定义属性没有大小写折叠，原样透传（注册过的属性会被内插，未注册的是离散）。
  if (key.startsWith('--')) return key;
  if (!/^[A-Za-z][A-Za-z0-9]*$/.test(key)) return null;
  return key.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`);
}

/**
 * 这一层上**实际会被插值的 CSS 属性名**（并集）。
 *
 * 为什么不能写死 transform/opacity/filter：那两个枚举来自预设与 agent 的
 * `keys` 生成器（它们只产这三样），而手写 CSS 通道**属性名不受限**
 * （`parseCustomCss` 只校验关键帧选择器）。一旦用户写了 `color` / `clip-path`，
 * 写死的快照就会漏掉它 —— 停掉动画后该属性回落到基础样式值，
 * 表现是「预览会动、导出不动，且不报错」。
 */
function animatedProps(layer: HTMLElement): string[] {
  const out = new Set<string>();
  for (const a of layer.getAnimations()) {
    // `Animation.effect` 的类型是 AnimationEffect，getKeyframes 只在 KeyframeEffect 上。
    const effect = a.effect as KeyframeEffect | null;
    if (!effect || typeof effect.getKeyframes !== 'function') continue;
    for (const frame of effect.getKeyframes()) {
      for (const key of Object.keys(frame)) {
        // 该帧没写这个属性时 WAAPI 给 null（计算值），跳过不算「被插值」的证据。
        if ((frame as Record<string, unknown>)[key] === null) continue;
        const prop = cssPropName(key);
        if (prop) out.add(prop);
      }
    }
  }
  return [...out];
}

/** 读一遍即将被烘焙掉的属性。 */
function snapshot(layers: HTMLElement[]): AnimValueSnapshot[] {
  return layers.map((el) => {
    const cs = getComputedStyle(el);
    const values = new Map<string, string>();
    for (const prop of animatedProps(el)) {
      const value = cs.getPropertyValue(prop);
      if (value) values.set(prop, value);
    }
    return { el, values };
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
    for (const [prop, value] of s.values) s.el.style.setProperty(prop, value);
  }
  return snaps;
}

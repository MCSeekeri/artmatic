/**
 * animation-presets/enter.ts — **进入**动画（从无到有）。
 *
 * 一条预设 = 一条定义（时长 / 缓动 / 参数）+ 一段 keyframes 体。约束见
 * `types.ts` 的 `KeyframeBuilder` 注释（那里写的每一条都会被解析器惩罚，
 * 而且不报错）。守卫测试：`tests/unit/anim-presets-enter.test.ts`。
 *
 * 进入动画的收尾一律是「稳态」：`opacity:1` / 恒等变换 / 满视口的 clip-path。
 * 末帧停在别的值上（比如还差 10% 缩放）会在下一次插入动画时留下一条接不上的
 * 曲线，而用户看不出那是预设的锅。
 */

import type { PresetModule } from './types';
import { num } from './types';

const defs: PresetModule['defs'] = [
  { id: 'fade-in', labelKey: 'anim.fadeIn', duration: 0.6, easing: 'ease-out' },
  { id: 'slide-in-left', labelKey: 'anim.slideInLeft', duration: 0.6, easing: 'ease-out', params: { dist: 80 } },
  { id: 'slide-in-right', labelKey: 'anim.slideInRight', duration: 0.6, easing: 'ease-out', params: { dist: 80 } },
  // 注意 id 与文案的对应关系是原样保留的：id 描述**运动方向**，文案描述**来向**，
  // 所以 slide-in-up 配「下方滑入」。改文案时别顺手把它「修正」成上方。
  { id: 'slide-in-up', labelKey: 'anim.slideInUp', duration: 0.6, easing: 'ease-out', params: { dist: 80 } },
  { id: 'slide-in-down', labelKey: 'anim.slideInDown', duration: 0.6, easing: 'ease-out', params: { dist: 80 } },
  { id: 'zoom-in', labelKey: 'anim.zoomIn', duration: 0.6, easing: 'ease-out', params: { z0: 0.8 } },
  { id: 'zoom-out', labelKey: 'anim.zoomOut', duration: 0.6, easing: 'ease-out', params: { z1: 1.25 } },
  { id: 'pop', labelKey: 'anim.pop', duration: 0.45, easing: 'ease-in-out', params: { z1: 1.15 } },
  { id: 'blur-in', labelKey: 'anim.blurIn', duration: 0.7, easing: 'ease-out', params: { blur: 12 } },

  /*
   * 下面这些是「同一个圆角方形，换一种进场方式」。时长分两档：**翻 / 滚 / 落**
   * 这类带路径的给 0.8~0.9s（短了看不出弧线），展开 / 擦除这类「一次到位」的给
   * 0.55~0.7s（拖长会显得黏）。
   */
  { id: 'flip-in-x', labelKey: 'anim.flipInX', duration: 0.9, easing: 'ease-out' },
  { id: 'flip-in-y', labelKey: 'anim.flipInY', duration: 0.9, easing: 'ease-out' },
  { id: 'swivel-in', labelKey: 'anim.swivelIn', duration: 0.7, easing: 'ease-out', params: { rot: -40, z0: 0.85 } },
  { id: 'stretch-in-x', labelKey: 'anim.stretchInX', duration: 0.55, easing: 'ease-out' },
  { id: 'stretch-in-y', labelKey: 'anim.stretchInY', duration: 0.55, easing: 'ease-out' },
  { id: 'sweep-in', labelKey: 'anim.sweepIn', duration: 0.7, easing: 'ease-out' },
  { id: 'iris-in', labelKey: 'anim.irisIn', duration: 0.8, easing: 'ease-out' },
  { id: 'skew-in', labelKey: 'anim.skewIn', duration: 0.7, easing: 'ease-out', params: { dist: 40 } },
  { id: 'bounce-in', labelKey: 'anim.bounceIn', duration: 0.9, easing: 'ease-out', params: { dist: 60 } },
  { id: 'drop-in', labelKey: 'anim.dropIn', duration: 0.8, easing: 'ease-out', params: { dist: 90 } },
  { id: 'tracking-in', labelKey: 'anim.trackingIn', duration: 0.8, easing: 'ease-out' },
  { id: 'roll-in', labelKey: 'anim.rollIn', duration: 0.8, easing: 'ease-out', params: { dist: 60, rot: -180 } },
];

const keyframes: PresetModule['keyframes'] = {
  'fade-in': () => 'from{opacity:0}to{opacity:1}',

  'slide-in-left': (p) =>
    `from{transform:translateX(${-num(p, 'dist', 80)}px);opacity:0}to{transform:translateX(0);opacity:1}`,

  'slide-in-right': (p) =>
    `from{transform:translateX(${num(p, 'dist', 80)}px);opacity:0}to{transform:translateX(0);opacity:1}`,

  'slide-in-up': (p) =>
    `from{transform:translateY(${num(p, 'dist', 80)}px);opacity:0}to{transform:translateY(0);opacity:1}`,

  'slide-in-down': (p) =>
    `from{transform:translateY(${-num(p, 'dist', 80)}px);opacity:0}to{transform:translateY(0);opacity:1}`,

  'zoom-in': (p) =>
    `from{transform:scale(${num(p, 'z0', 0.8)});opacity:0}to{transform:scale(1);opacity:1}`,

  'zoom-out': (p) =>
    `from{transform:scale(${num(p, 'z1', 1.25)});opacity:0}to{transform:scale(1);opacity:1}`,

  pop: (p) => `0%{transform:scale(1)}60%{transform:scale(${num(p, 'z1', 1.15)})}100%{transform:scale(1)}`,

  'blur-in': (p) =>
    `from{filter:blur(${num(p, 'blur', 12)}px);opacity:0}to{filter:blur(0);opacity:1}`,

  /*
   * 3D 翻转：`perspective()` 让「翻到 90° 时压成一条线」看起来有纵深。
   *
   * 这条的 transform 里带了 `perspective` / `rotateX`，`decomposeTransform`
   * 拆不动 —— 整条按**原始字符串**存成 `transform` 轨道（画面正确、可编辑性
   * 差一档）。这是刻意的：没有 perspective 的 `rotateX` 是纯平面投影，看起来
   * 只是「变矮」，不是翻转。
   */
  'flip-in-x': () =>
    'from{transform:perspective(700px) rotateX(-90deg);opacity:0}to{transform:perspective(700px) rotateX(0deg);opacity:1}',

  'flip-in-y': () =>
    'from{transform:perspective(700px) rotateY(-90deg);opacity:0}to{transform:perspective(700px) rotateY(0deg);opacity:1}',

  // 旋转进入：转着放大到位（rot + sx/sy + opacity 四条通道，全可编辑）
  'swivel-in': (p) =>
    `from{transform:rotate(${num(p, 'rot', -40)}deg) scale(${num(p, 'z0', 0.85)});opacity:0}` +
    'to{transform:rotate(0deg) scale(1);opacity:1}',

  // 展开：从一条**线**长出来。scaleX(0) 的中间态是看不见的，配 opacity 才不闪。
  'stretch-in-x': () => 'from{transform:scaleX(0);opacity:0}to{transform:scaleX(1);opacity:1}',
  'stretch-in-y': () => 'from{transform:scaleY(0);opacity:0}to{transform:scaleY(1);opacity:1}',

  /*
   * 擦除 / 圆形展开：走 `clip-path` 而不是 opacity —— 它们要的是「一点点露出来」
   * 而不是「整体变亮」。`inset()` 与 `circle()` 的首末帧同名同参数量，浏览器
   * 才能插值（`inset(0 100% 0 0)` → `inset(0 0 0 0)`）。
   */
  'sweep-in': () => 'from{clip-path:inset(0 100% 0 0)}to{clip-path:inset(0 0 0 0)}',
  'iris-in': () => 'from{clip-path:circle(0%)}to{clip-path:circle(100%)}',

  // 斜切进入：斜着挤进来（skewX 拆不动，整条存原始 transform）
  'skew-in': (p) =>
    `from{transform:skewX(-12deg) translateX(${-num(p, 'dist', 40)}px);opacity:0}` +
    'to{transform:skewX(0deg) translateX(0);opacity:1}',

  /*
   * 弹跳：落地点先压过头再回弹（60 → 0 → -18 → 0 → -6 → 0）。
   * 只用 translateY（y 通道），回弹的那两段靠关键帧本身给形状，不额外写缓动。
   */
  'bounce-in': (p) => {
    const d = num(p, 'dist', 60);
    return (
      `0%{transform:translateY(${d}px);opacity:0}` +
      '45%{transform:translateY(0);opacity:1}' +
      '65%{transform:translateY(-18px)}' +
      '85%{transform:translateY(0)}' +
      '93%{transform:translateY(-6px)}' +
      '100%{transform:translateY(0)}'
    );
  },

  // 落下：从上方掉下来，落地小压一下（8px）再归位
  'drop-in': (p) => {
    const d = num(p, 'dist', 90);
    return (
      `0%{transform:translateY(${-d}px);opacity:0}` +
      '70%{transform:translateY(8px);opacity:1}' +
      '100%{transform:translateY(0)}'
    );
  },

  // 字距收拢：文字类预设，图形上无效果（letter-spacing 不影响非文本）
  'tracking-in': () => 'from{letter-spacing:0.6em;opacity:0}to{letter-spacing:0em;opacity:1}',

  // 滚动进入：边滚边挪进来（rot 与 x 都是可编辑通道）
  'roll-in': (p) =>
    `from{transform:translateX(${-num(p, 'dist', 60)}px) rotate(${num(p, 'rot', -180)}deg);opacity:0}` +
    'to{transform:translateX(0) rotate(0deg);opacity:1}',
};

export const ENTER_PRESETS: PresetModule = { defs, keyframes };

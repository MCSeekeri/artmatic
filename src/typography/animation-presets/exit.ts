/**
 * animation-presets/exit.ts — **退出**动画（从有到无）。
 *
 * 退出动画的末帧一般是 `opacity:0`；擦除 / 圆形收拢那两条用 `clip-path` 代替
 * （它们要的是「一点点消失」，整体变透明反而不对）。别在这里写「回到原位」：
 * 那是强调动画的形状。
 *
 * 时长普遍比进入短半拍（0.6~0.9s）：离场不需要让人看清，拖长只会挡住下一件事。
 * 缓动一律 `ease-in` —— 起步慢一点、结尾快，才像「被抽走」。
 *
 * 约束见 `types.ts` 的 `KeyframeBuilder` 注释。
 */

import type { PresetModule } from './types';
import { num } from './types';

const defs: PresetModule['defs'] = [
  { id: 'fade-out', labelKey: 'anim.fadeOut', duration: 0.6, easing: 'ease-in' },

  /* ---- 与进入组的四向滑入镜像 ---- */
  { id: 'slide-out-left', labelKey: 'anim.slideOutLeft', duration: 0.6, easing: 'ease-in', params: { dist: 80 } },
  { id: 'slide-out-right', labelKey: 'anim.slideOutRight', duration: 0.6, easing: 'ease-in', params: { dist: 80 } },
  { id: 'slide-out-up', labelKey: 'anim.slideOutUp', duration: 0.6, easing: 'ease-in', params: { dist: 80 } },
  { id: 'slide-out-down', labelKey: 'anim.slideOutDown', duration: 0.6, easing: 'ease-in', params: { dist: 80 } },

  { id: 'shrink-out', labelKey: 'anim.shrinkOut', duration: 0.6, easing: 'ease-in', params: { z0: 0.65 } },
  { id: 'grow-out', labelKey: 'anim.growOut', duration: 0.6, easing: 'ease-in', params: { z1: 1.4 } },
  { id: 'flip-out-x', labelKey: 'anim.flipOutX', duration: 0.9, easing: 'ease-in' },
  { id: 'flip-out-y', labelKey: 'anim.flipOutY', duration: 0.9, easing: 'ease-in' },
  { id: 'sweep-out', labelKey: 'anim.sweepOut', duration: 0.7, easing: 'ease-in' },
  { id: 'iris-out', labelKey: 'anim.irisOut', duration: 0.8, easing: 'ease-in' },
  { id: 'blur-out', labelKey: 'anim.blurOut', duration: 0.7, easing: 'ease-in', params: { blur: 12 } },
  { id: 'roll-out', labelKey: 'anim.rollOut', duration: 0.8, easing: 'ease-in', params: { dist: 60 } },
];

const keyframes: PresetModule['keyframes'] = {
  'fade-out': () => 'from{opacity:1}to{opacity:0}',

  'slide-out-left': (p) =>
    `from{transform:translateX(0);opacity:1}to{transform:translateX(${-num(p, 'dist', 80)}px);opacity:0}`,

  'slide-out-right': (p) =>
    `from{transform:translateX(0);opacity:1}to{transform:translateX(${num(p, 'dist', 80)}px);opacity:0}`,

  // id 描述运动方向（向上移出去），文案也照运动方向写 —— 与进入组「id 是方向、
  // 文案是来向」的翻转不同，退出时两者一致，不用脑子再换算一次。
  'slide-out-up': (p) =>
    `from{transform:translateY(0);opacity:1}to{transform:translateY(${-num(p, 'dist', 80)}px);opacity:0}`,

  'slide-out-down': (p) =>
    `from{transform:translateY(0);opacity:1}to{transform:translateY(${num(p, 'dist', 80)}px);opacity:0}`,

  'shrink-out': (p) =>
    `from{transform:scale(1);opacity:1}to{transform:scale(${num(p, 'z0', 0.65)});opacity:0}`,

  'grow-out': (p) =>
    `from{transform:scale(1);opacity:1}to{transform:scale(${num(p, 'z1', 1.4)});opacity:0}`,

  // 3D 翻转退出：与进入组同一套 perspective（整条存原始 transform）
  'flip-out-x': () =>
    'from{transform:perspective(700px) rotateX(0deg);opacity:1}to{transform:perspective(700px) rotateX(90deg);opacity:0}',

  'flip-out-y': () =>
    'from{transform:perspective(700px) rotateY(0deg);opacity:1}to{transform:perspective(700px) rotateY(90deg);opacity:0}',

  // 擦除退出：左边先没（与 sweep-in 的推进方向一致：从左往右揭开，反过来收）
  'sweep-out': () => 'from{clip-path:inset(0 0 0 0)}to{clip-path:inset(0 0 0 100%)}',

  'iris-out': () => 'from{clip-path:circle(100%)}to{clip-path:circle(0%)}',

  'blur-out': (p) =>
    `from{filter:blur(0);opacity:1}to{filter:blur(${num(p, 'blur', 12)}px);opacity:0}`,

  'roll-out': (p) =>
    `from{transform:translateX(0) rotate(0deg);opacity:1}` +
    `to{transform:translateX(${num(p, 'dist', 60)}px) rotate(180deg);opacity:0}`,
};

export const EXIT_PRESETS: PresetModule = { defs, keyframes };

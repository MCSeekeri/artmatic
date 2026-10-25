/**
 * animation-presets/emphasis.ts — **强调**动画（原地动，首末状态相同）。
 *
 * 强调一律**回到原状**（首帧 = 末帧）：它是「提醒一下」，不是「换个样子」。
 * 落成有终态的强调（比如变淡后就一直淡着）会让下一次插入动画从半透明的值
 * 接着走，用户在关键帧面板里看到的是一条解释不清的曲线。
 *
 * 这里有三类「颜色感」的强调（彩色脉冲 / 亮度脉冲 / 发光）走的是 `filter`
 * 而不是 `color`：预设不该写死颜色（文档可能换了配色方案、元素可能是深色
 * 背景上的白字），滤镜改的是**渲染结果**，与主题无关。
 *
 * 约束见 `types.ts` 的 `KeyframeBuilder` 注释。
 */

import type { PresetModule } from './types';
import { num } from './types';

const defs: PresetModule['defs'] = [
  { id: 'fade-in-out', labelKey: 'anim.fadeInOut', duration: 1.2, easing: 'ease-in-out' },
  { id: 'pulse', labelKey: 'anim.pulse', duration: 1, easing: 'ease-in-out' },
  { id: 'spin', labelKey: 'anim.spin', duration: 1, easing: 'linear' },
  { id: 'shake', labelKey: 'anim.shake', duration: 0.5, easing: 'linear' },

  /*
   * 时长按「节奏」分三档，不按动画种类：
   *  - 0.5~0.9s：抖动 / 闪烁 / 心跳（一眨眼就过去的一次性提醒）；
   *  - 1.2~1.6s：摇摆 / 翻滚 / 颜色（有来回，需要看清）；
   *  - 2.0s+：漂浮 / 环绕（慢动作，长驻感）。
   */
  { id: 'contract', labelKey: 'anim.contract', duration: 1, easing: 'ease-in-out', params: { z0: 0.9 } },
  { id: 'beat', labelKey: 'anim.beat', duration: 1.2, easing: 'ease-in-out', params: { z1: 1.18 } },
  { id: 'flash', labelKey: 'anim.flash', duration: 0.8, easing: 'linear' },
  { id: 'swing', labelKey: 'anim.swing', duration: 1, easing: 'ease-in-out', params: { rot: 18 } },
  { id: 'wobble', labelKey: 'anim.wobble', duration: 0.9, easing: 'ease-in-out' },
  { id: 'jello', labelKey: 'anim.jello', duration: 0.9, easing: 'ease-in-out' },
  { id: 'float', labelKey: 'anim.float', duration: 2.4, easing: 'ease-in-out', params: { dist: 8 } },
  { id: 'circulate', labelKey: 'anim.circulate', duration: 2, easing: 'linear', params: { r: 10 } },
  { id: 'swirl', labelKey: 'anim.swirl', duration: 1.2, easing: 'ease-in-out', params: { z0: 0.6 } },
  { id: 'flip', labelKey: 'anim.flip', duration: 1.2, easing: 'ease-in-out' },
  { id: 'hue-cycle', labelKey: 'anim.hueCycle', duration: 1.6, easing: 'linear' },
  { id: 'brightness-pulse', labelKey: 'anim.brightnessPulse', duration: 1.2, easing: 'ease-in-out', params: { boost: 1.6 } },
  { id: 'glow', labelKey: 'anim.glow', duration: 1.4, easing: 'ease-in-out', params: { blur: 6 } },
  { id: 'blur-pulse', labelKey: 'anim.blurPulse', duration: 1.2, easing: 'ease-in-out', params: { blur: 6 } },
  { id: 'tracking-out', labelKey: 'anim.trackingOut', duration: 1.2, easing: 'ease-in-out' },
  { id: 'jitter', labelKey: 'anim.jitter', duration: 0.5, easing: 'linear' },
  { id: 'squash', labelKey: 'anim.squash', duration: 0.9, easing: 'ease-in-out' },
  { id: 'hop', labelKey: 'anim.hop', duration: 0.9, easing: 'ease-in-out', params: { dist: 14 } },
];

const keyframes: PresetModule['keyframes'] = {
  'fade-in-out': () => '0%{opacity:0}50%{opacity:1}100%{opacity:0}',

  pulse: () => '0%{opacity:1}50%{opacity:0.35}100%{opacity:1}',

  spin: () => 'from{transform:rotate(0)}to{transform:rotate(360deg)}',

  shake: () =>
    '0%,100%{transform:translateX(0)}25%{transform:translateX(-6px)}75%{transform:translateX(6px)}',

  // 收缩：与 pulse 同构，但换的是**尺寸**（缩一下再回来）
  contract: (p) =>
    `0%{transform:scale(1)}50%{transform:scale(${num(p, 'z0', 0.9)})}100%{transform:scale(1)}`,

  // 心跳：两跳（第二跳略小）—— 单跳就是 pop，双跳才有「心跳」的辨识度
  beat: (p) => {
    const z = num(p, 'z1', 1.18);
    return (
      `0%{transform:scale(1)}12%{transform:scale(${z})}24%{transform:scale(1)}` +
      `36%{transform:scale(${(z + 1) / 2})}48%{transform:scale(1)}100%{transform:scale(1)}`
    );
  },

  // 闪烁：快速两暗两亮（线性，不要缓动 —— 缓动会让「暗」变成长长的呼吸）
  flash: () =>
    '0%{opacity:1}20%{opacity:0.1}40%{opacity:1}60%{opacity:0.1}80%{opacity:1}100%{opacity:1}',

  // 摇摆：像钟摆一样左右衰减
  swing: (p) => {
    const r = num(p, 'rot', 18);
    return (
      `0%{transform:rotate(0deg)}25%{transform:rotate(${r}deg)}` +
      `55%{transform:rotate(${-r * 0.78}deg)}80%{transform:rotate(${r * 0.44}deg)}` +
      '100%{transform:rotate(0deg)}'
    );
  },

  // 晃动：平移 + 微转（shake 只平移；这里多一个转，读起来是「晃」不是「抖」）
  wobble: () =>
    '0%{transform:translateX(0) rotate(0deg)}20%{transform:translateX(-6px) rotate(-5deg)}' +
    '45%{transform:translateX(6px) rotate(5deg)}70%{transform:translateX(-3px) rotate(-2deg)}' +
    '100%{transform:translateX(0) rotate(0deg)}',

  // 果冻：横竖反相挤压（sx 与 sy 永远走反向，这才像软的东西）
  jello: () =>
    '0%{transform:scale(1,1)}20%{transform:scale(1.18,0.82)}40%{transform:scale(0.86,1.14)}' +
    '60%{transform:scale(1.08,0.94)}80%{transform:scale(0.98,1.02)}100%{transform:scale(1,1)}',

  // 漂浮：慢速上下（2.4s 一次，快了就变成「弹」）
  float: (p) => {
    const d = num(p, 'dist', 8);
    return `0%{transform:translateY(0)}50%{transform:translateY(${-d}px)}100%{transform:translateY(0)}`;
  },

  /*
   * 环绕：绕着**自己左侧的一个圆**转一圈，0% 与 100% 都在原点。
   *
   * 圆心取 (-r, 0) 是为了让路径**经过元素原位**：圆心放在元素上就变成了「绕着
   * 自己转」，而那是 spin 的事；圆心偏移一点才有「绕场一周」的感觉。9 个关键帧
   * （每 45°）足够圆，再多就是噪声。
   */
  circulate: (p) => {
    const r = num(p, 'r', 10);
    const round = (v: number): number => Math.round(v * 100) / 100 + 0;
    const out: string[] = [];
    for (let i = 0; i <= 8; i++) {
      const a = (i * 45 * Math.PI) / 180;
      out.push(
        `${i * 12.5}%{transform:translate(${round(-r + r * Math.cos(a))}px,${round(r * Math.sin(a))}px)}`,
      );
    }
    return out.join('');
  },

  // 陀螺旋转：转两圈的同时收一次腰
  swirl: (p) =>
    `0%{transform:rotate(0deg) scale(1)}50%{transform:rotate(360deg) scale(${num(p, 'z0', 0.6)})}` +
    '100%{transform:rotate(720deg) scale(1)}',

  // 原地翻转：整圈翻过去（3D，同样整条存原始 transform）
  flip: () =>
    '0%{transform:perspective(700px) rotateY(0deg)}50%{transform:perspective(700px) rotateY(180deg)}' +
    '100%{transform:perspective(700px) rotateY(360deg)}',

  /*
   * 彩色脉冲：色相转一圈。**不写死颜色** —— 它改的是渲染结果的色相，
   * 文档换配色方案、元素是白字还是黑字，都照样成立。
   */
  'hue-cycle': () =>
    '0%{filter:hue-rotate(0deg)}50%{filter:hue-rotate(180deg)}100%{filter:hue-rotate(360deg)}',

  // 亮度脉冲：变亮再回来（比透明度更像「发光」，因为底色不跟着透）
  'brightness-pulse': (p) => {
    const b = num(p, 'boost', 1.6);
    return `0%{filter:brightness(1)}50%{filter:brightness(${b})}100%{filter:brightness(1)}`;
  },

  // 发光：投影光晕收放（currentColor = 跟着文字 / 图形自己的颜色走）
  glow: (p) => {
    const b = num(p, 'blur', 6);
    return (
      '0%{filter:drop-shadow(0 0 0 currentColor)}' +
      `50%{filter:drop-shadow(0 0 ${b}px currentColor)}` +
      '100%{filter:drop-shadow(0 0 0 currentColor)}'
    );
  },

  // 模糊脉冲：纯 blur → 会被拆成可编辑的 blur 通道
  'blur-pulse': (p) => {
    const b = num(p, 'blur', 6);
    return `0%{filter:blur(0)}50%{filter:blur(${b}px)}100%{filter:blur(0)}`;
  },

  // 字距展开：文字类（图形上无效果），配合排版是「呼吸」一样的提示
  'tracking-out': () => '0%{letter-spacing:0}50%{letter-spacing:0.3em}100%{letter-spacing:0}',

  // 颤抖：高频小幅（0.5s 内五个方向），比 shake 碎
  jitter: () =>
    '0%{transform:translate(0,0) rotate(0deg)}20%{transform:translate(2px,-2px) rotate(-3deg)}' +
    '40%{transform:translate(-2px,1px) rotate(2deg)}60%{transform:translate(1px,2px) rotate(-2deg)}' +
    '80%{transform:translate(-1px,-1px) rotate(3deg)}100%{transform:translate(0,0) rotate(0deg)}',

  // 压扁：只动竖向（与 jello 的「横竖反相」区分：这个是一下压下去再弹回来）
  squash: () =>
    '0%{transform:scale(1,1)}45%{transform:scale(1.12,0.78)}100%{transform:scale(1,1)}',

  // 弹跳：两段跳（第二段矮一半）
  hop: (p) => {
    const d = num(p, 'dist', 14);
    return (
      `0%{transform:translateY(0)}30%{transform:translateY(${-d}px)}55%{transform:translateY(0)}` +
      `75%{transform:translateY(${-d / 2}px)}100%{transform:translateY(0)}`
    );
  },
};

export const EMPHASIS_PRESETS: PresetModule = { defs, keyframes };

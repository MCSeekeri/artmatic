/**
 * anim-catalog.ts — 动画预设的**展示信息**：分组 + 图标（纯数据 + 纯函数）。
 *
 * 为什么不放进 `typography/animation.ts` 的 `ANIM_PRESETS`：那张表是**模型**
 * （预设 id → 时长 / 缓动 / 参数），会被渲染层、schema 迁移、agent 一起读；
 * 而分组名与示意图形是**界面**的事，改一个图标不该动模型。与特效目录
 * （`effects/catalog.ts` 而不是各 `defs/`）同一条理由。
 *
 * 图标本身按「进入 / 强调 / 退出」分在 `anim-icons/` 三个文件里，共用
 * `anim-icons/prims.ts` 那一套图元；这个文件只做**归组与汇总** —— 五十多个
 * 图标全堆在一个对象里的话，加一个「强调」动画也要动这份大家都在改的表。
 *
 * 图形语言：见 `anim-icons/prims.ts` 的文件头（圆角方形 + 运动提示）。
 */

import type { MessageKey } from '../../i18n/locales';
import type { AnimPreset } from '../../typography/animation';
import type { AnimIconPrim } from './anim-icons/prims';
import { ENTER_ICONS } from './anim-icons/enter';
import { EMPHASIS_ICONS } from './anim-icons/emphasis';
import { EXIT_ICONS } from './anim-icons/exit';

export type { AnimIconPrim } from './anim-icons/prims';

/** 图库分组（顺序即渲染顺序）。 */
export type AnimGroupId = 'enter' | 'emphasis' | 'exit';

export const ANIM_GROUPS: { id: AnimGroupId; labelKey: MessageKey }[] = [
  { id: 'enter', labelKey: 'anim.groupEnter' },
  { id: 'emphasis', labelKey: 'anim.groupEmphasis' },
  { id: 'exit', labelKey: 'anim.groupExit' },
];

/**
 * 预设 → 分组。
 *
 * 顺序与 `ANIM_PRESETS`（`typography/animation.ts` 的 id 清单）一致：常驻条按
 * 那张表的顺序平铺，所以这里写乱的后果是「条里进入组后面又冒出个进入动画」。
 */
export const ANIM_PRESET_GROUP: Record<AnimPreset, AnimGroupId> = {
  /* ---- 进入 ---- */
  'fade-in': 'enter',
  'slide-in-left': 'enter',
  'slide-in-right': 'enter',
  'slide-in-up': 'enter',
  'slide-in-down': 'enter',
  'zoom-in': 'enter',
  'zoom-out': 'enter',
  pop: 'enter',
  'blur-in': 'enter',
  'flip-in-x': 'enter',
  'flip-in-y': 'enter',
  'swivel-in': 'enter',
  'stretch-in-x': 'enter',
  'stretch-in-y': 'enter',
  'sweep-in': 'enter',
  'iris-in': 'enter',
  'skew-in': 'enter',
  'bounce-in': 'enter',
  'drop-in': 'enter',
  'tracking-in': 'enter',
  'roll-in': 'enter',

  /* ---- 强调 ---- */
  'fade-in-out': 'emphasis',
  pulse: 'emphasis',
  spin: 'emphasis',
  shake: 'emphasis',
  contract: 'emphasis',
  beat: 'emphasis',
  flash: 'emphasis',
  swing: 'emphasis',
  wobble: 'emphasis',
  jello: 'emphasis',
  float: 'emphasis',
  circulate: 'emphasis',
  swirl: 'emphasis',
  flip: 'emphasis',
  'hue-cycle': 'emphasis',
  'brightness-pulse': 'emphasis',
  glow: 'emphasis',
  'blur-pulse': 'emphasis',
  'tracking-out': 'emphasis',
  jitter: 'emphasis',
  squash: 'emphasis',
  hop: 'emphasis',

  /* ---- 退出 ---- */
  'fade-out': 'exit',
  'slide-out-left': 'exit',
  'slide-out-right': 'exit',
  'slide-out-up': 'exit',
  'slide-out-down': 'exit',
  'shrink-out': 'exit',
  'grow-out': 'exit',
  'flip-out-x': 'exit',
  'flip-out-y': 'exit',
  'sweep-out': 'exit',
  'iris-out': 'exit',
  'blur-out': 'exit',
  'roll-out': 'exit',
};

/**
 * 预设 → 图元列表（三个分组文件拼起来）。
 *
 * 类型故意是 `Record<string, …>` 而不是 `Record<AnimPreset, …>`：**缺一条不该
 * 让整个应用编译不过**（加预设的中间状态就是缺图标的），缺口由
 * `tests/unit/anim-catalog.test.ts` 点名报到具体 id 上。
 */
export const ANIM_PRESET_ICONS: Record<string, AnimIconPrim[]> = {
  ...ENTER_ICONS,
  ...EMPHASIS_ICONS,
  ...EXIT_ICONS,
};

/** 某个预设的图标（未知 id 给空数组：卡片退化成只有名字，不抛错）。 */
export function animIconOf(preset: string): AnimIconPrim[] {
  return ANIM_PRESET_ICONS[preset] ?? [];
}

/** 某个预设的分组（未知 id 归到「进入」，图库的孤儿条目不会消失）。 */
export function animGroupOf(preset: string): AnimGroupId {
  return ANIM_PRESET_GROUP[preset as AnimPreset] ?? 'enter';
}

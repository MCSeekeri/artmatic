/**
 * anim-catalog.ts — 动画预设的**展示信息**：分组 + 图标（纯数据 + 纯函数）。
 *
 * 为什么不放进 `typography/animation.ts` 的 `ANIM_PRESETS`：那张表是**模型**
 * （预设 id → 时长 / 缓动 / 参数），会被渲染层、schema 迁移、agent 一起读；
 * 而分组名与示意图形是**界面**的事，改一个图标不该动模型。与特效目录
 * （`effects/catalog.ts` 而不是各 `defs/`）同一条理由，代价同样是「新增预设要
 * 两处登记」—— 由 `tests/unit/anim-catalog.test.ts` 把这件事变成明确的失败。
 *
 * 图形语言（与 PPT 的动画图库同构，只是把五角星换成**圆角方形**）：
 *   `sq`   = 示意图形（实心 = 终态，暗色 = 起始态，虚线 = 「将要变化」的框）
 *   `path` = 运动提示（箭头 / 圆弧 / 抖动线），一律描边
 * 坐标在 `0 0 32 32` 的 viewBox 里。蓝色只来自 `currentColor`，所以图标跟着
 * 按钮文字的颜色走（普通态次级文字色、hover 主题色），不另建一套配色。
 */

import type { MessageKey } from '../../i18n/locales';
import type { AnimPreset } from '../../typography/animation';

/** 图元：圆角方形（示意图形）或描边路径（运动提示）。 */
export type AnimIconPrim =
  | {
      k: 'sq';
      x: number;
      y: number;
      w: number;
      h: number;
      r: number;
      /** 0..1，缺省 1。 */
      o?: number;
      /** 虚线描边（= 「起始 / 将要变化」的那一态）。 */
      dashed?: boolean;
    }
  | {
      k: 'path';
      d: string;
      /** 线宽（viewBox 单位），缺省 1.6。 */
      sw?: number;
      o?: number;
    };

/** 图库分组（顺序即渲染顺序）。 */
export type AnimGroupId = 'enter' | 'emphasis' | 'exit';

export const ANIM_GROUPS: { id: AnimGroupId; labelKey: MessageKey }[] = [
  { id: 'enter', labelKey: 'anim.groupEnter' },
  { id: 'emphasis', labelKey: 'anim.groupEmphasis' },
  { id: 'exit', labelKey: 'anim.groupExit' },
];

/** 预设 → 分组。 */
export const ANIM_PRESET_GROUP: Record<AnimPreset, AnimGroupId> = {
  'fade-in': 'enter',
  'slide-in-left': 'enter',
  'slide-in-right': 'enter',
  'slide-in-up': 'enter',
  'slide-in-down': 'enter',
  'zoom-in': 'enter',
  'zoom-out': 'enter',
  pop: 'enter',
  'blur-in': 'enter',
  'fade-in-out': 'emphasis',
  pulse: 'emphasis',
  spin: 'emphasis',
  shake: 'emphasis',
  'fade-out': 'exit',
};

/* ------------------------------------------------------------ 图元构造 */

const r1 = (v: number): number => Math.round(v * 10) / 10;

function sq(x: number, y: number, w: number, o = 1, dashed = false, h = w): AnimIconPrim {
  return { k: 'sq', x: r1(x), y: r1(y), w: r1(w), h: r1(h), r: r1(Math.max(1.2, w * 0.18)), o, dashed };
}

function path(d: string, o = 0.9, sw = 1.9): AnimIconPrim {
  return { k: 'path', d, o, sw };
}

/** 直线箭头（含箭头两翼）。 */
function arrow(x1: number, y1: number, x2: number, y2: number, o = 0.9): AnimIconPrim {
  const a = Math.atan2(y2 - y1, x2 - x1);
  const wing = 3.2;
  const spread = 0.7;
  const ax = r1(x2 - wing * Math.cos(a - spread));
  const ay = r1(y2 - wing * Math.sin(a - spread));
  const bx = r1(x2 - wing * Math.cos(a + spread));
  const by = r1(y2 - wing * Math.sin(a + spread));
  return path(`M${r1(x1)} ${r1(y1)}L${r1(x2)} ${r1(y2)}M${ax} ${ay}L${r1(x2)} ${r1(y2)}L${bx} ${by}`, o);
}

/** 顺时针圆弧 + 末端箭头（旋转类）。角度单位是度，0 = 正右、顺时针为正。 */
function arcArrow(cx: number, cy: number, r: number, fromDeg: number, toDeg: number, o = 0.9): AnimIconPrim {
  const rad = Math.PI / 180;
  const at = (deg: number): { x: number; y: number } => ({
    x: cx + r * Math.cos(deg * rad),
    y: cy + r * Math.sin(deg * rad),
  });
  const a = at(fromDeg);
  const b = at(toDeg);
  const large = (toDeg - fromDeg + 360) % 360 > 180 ? 1 : 0;
  const tan = (toDeg + 90) * rad;
  const wing = 3;
  const h1 = { x: b.x - wing * Math.cos(tan - 0.7), y: b.y - wing * Math.sin(tan - 0.7) };
  const h2 = { x: b.x - wing * Math.cos(tan + 0.7), y: b.y - wing * Math.sin(tan + 0.7) };
  return path(
    `M${r1(a.x)} ${r1(a.y)}A${r} ${r} 0 ${large} 1 ${r1(b.x)} ${r1(b.y)}` +
      `M${r1(h1.x)} ${r1(h1.y)}L${r1(b.x)} ${r1(b.y)}L${r1(h2.x)} ${r1(h2.y)}`,
    o,
  );
}

/** 整圆（虚线环，脉冲用）。 */
function ring(r: number, o: number): AnimIconPrim {
  const c = 16;
  return path(`M${c - r} ${c}A${r} ${r} 0 1 0 ${c + r} ${c}A${r} ${r} 0 1 0 ${c - r} ${c}`, o, 1.5);
}

/**
 * 中心那块示意图形（17×17，圆角）。**占满视野的一半以上**：卡片上的图标只有
 * 二十几像素，13px 的方形缩下去就是一小粒，读不出「这是什么」。
 */
const center = (o = 1, dashed = false): AnimIconPrim => sq(7.5, 7.5, 17, o, dashed);

/* ------------------------------------------------------------ 图标表 */

/**
 * 预设 → 图元列表。
 *
 * 每种动效只差**运动提示**，示意图形始终是同一个圆角方形：一眼看到的应当是
 * 「这个动画怎么动」，而不是十三种不同的装饰图案。
 */
export const ANIM_PRESET_ICONS: Record<AnimPreset, AnimIconPrim[]> = {
  /*
   * 淡入：实心 + 右上角一个「出现」的闪光（PPT 的出现也是这颗星）。
   * 不用「实心 + 内部虚线框」：那两样同色叠在一起，缩到 30px 就是一块纯实心方块，
   * 与「模糊进入 / 缩放」都分不开。
   */
  'fade-in': [center(1), path('M27.5 1.5V6.5M25 4H30', 0.85)],

  // 淡出：起始态半透明 + 外部虚线框（向外消散）
  'fade-out': [sq(7.5, 7.5, 17, 0.35), sq(5.5, 5.5, 21, 0.85, true)],

  // 淡入淡出：上下两态夹着实心（一进一出）
  'fade-in-out': [sq(9.5, 1.5, 13, 0.22), sq(9.5, 17.5, 13, 0.22), center(1)],

  // 滑入四向：虚线框在**来向**，箭头指向落点
  'slide-in-left': [sq(0.5, 10.5, 11, 0.5, true), sq(20.5, 10.5, 11, 1), arrow(13, 16, 19.5, 16)],
  'slide-in-right': [sq(20.5, 10.5, 11, 0.5, true), sq(0.5, 10.5, 11, 1), arrow(19, 16, 12.5, 16)],
  'slide-in-up': [sq(10.5, 20.5, 11, 0.5, true), sq(10.5, 0.5, 11, 1), arrow(16, 19, 16, 12.5)],
  'slide-in-down': [sq(10.5, 0.5, 11, 0.5, true), sq(10.5, 20.5, 11, 1), arrow(16, 13, 16, 19.5)],

  // 缩放：小虚线框在里面、两角向外 → 放大；反过来是缩小
  'zoom-in': [center(1), sq(10.5, 10.5, 11, 0.5, true), arrow(25.5, 9, 30, 4.5), arrow(9, 25.5, 4.5, 30)],
  'zoom-out': [sq(5.5, 5.5, 21, 0.6, true), sq(10, 10, 12, 1), arrow(30, 4.5, 25.5, 9), arrow(4.5, 30, 9, 25.5)],

  // 弹一下：终态 + 外部虚线框 + 下方回弹折线
  pop: [center(1), sq(5.5, 5.5, 21, 0.3, true), path('M10 30L16 26L22 30', 0.8)],

  // 旋转：一圈带箭头的弧
  spin: [center(1), arcArrow(16, 16, 14.5, -60, 200)],

  // 脉冲：两圈虚线环（半径在方圆形的对角之外，才不会被方形吃掉）
  pulse: [center(1), ring(13, 0.42), ring(15.2, 0.2)],

  // 抖动：左右两个反向箭头
  shake: [center(1), arrow(6.5, 16, 1.5, 16), arrow(25.5, 16, 30.5, 16)],

  // 模糊进入：三层由实到虚的光晕
  'blur-in': [sq(5.5, 5.5, 21, 0.08), sq(6.5, 6.5, 19, 0.16), center(1)],
};

/** 某个预设的图标（未知 id 给空数组：卡片退化成只有名字，不抛错）。 */
export function animIconOf(preset: string): AnimIconPrim[] {
  return ANIM_PRESET_ICONS[preset as AnimPreset] ?? [];
}

/** 某个预设的分组（未知 id 归到「进入」，图库的孤儿条目不会消失）。 */
export function animGroupOf(preset: string): AnimGroupId {
  return ANIM_PRESET_GROUP[preset as AnimPreset] ?? 'enter';
}

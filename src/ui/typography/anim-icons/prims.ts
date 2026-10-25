/**
 * anim-icons/prims.ts — 动画图标的**图形语言**（图元类型 + 构造器）。
 *
 * 三个分组文件（enter / emphasis / exit）共用这一份，所以「示意图形长什么样」
 * 只有一个答案：如果每组自己写一套 `sq()` / `arrow()`，同一个意思会出现三种
 * 手感（圆角半径不同、箭头大小不同），而它们在图库里是并排显示的。
 *
 * 图形语言（与 PPT 的动画图库同构，只是把五角星换成**圆角方形**）：
 *  - `sq`   = 示意图形。实心 = 终态；低透明度 = 起始态 / 变化中；虚线 = 「将要
 *             变化」的框。宽度与高度可以不等（`w` / `h`），用来画「压扁 / 展开」。
 *  - `path` = 运动提示（箭头 / 圆弧 / 折线 / 括号），一律描边。
 * 坐标在 `0 0 32 32` 的 viewBox 里，**不许画到框外**（会被卡片裁掉，守卫测试会报）。
 * 颜色只来自 `currentColor`，不另建一套图标配色。
 */

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
      /** 线宽（viewBox 单位），缺省 1.9。 */
      sw?: number;
      o?: number;
    };

const r1 = (v: number): number => Math.round(v * 10) / 10;

/** 圆角方形。`w` 与 `h` 分开给：压扁 / 展开 / 细条都靠它。 */
export function sq(x: number, y: number, w: number, o = 1, dashed = false, h = w): AnimIconPrim {
  return { k: 'sq', x: r1(x), y: r1(y), w: r1(w), h: r1(h), r: r1(Math.max(1.2, Math.min(w, h) * 0.18)), o, dashed };
}

/** 描边路径（`d` 里只写绝对坐标命令，避免相对坐标叠出看不见的位移）。 */
export function path(d: string, o = 0.9, sw = 1.9): AnimIconPrim {
  return { k: 'path', d, o, sw };
}

/** 直线箭头（含箭头两翼）。 */
export function arrow(x1: number, y1: number, x2: number, y2: number, o = 0.9): AnimIconPrim {
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
export function arcArrow(cx: number, cy: number, r: number, fromDeg: number, toDeg: number, o = 0.9): AnimIconPrim {
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

/** 整圆（虚线环，脉冲 / 圆形展开用）。 */
export function ring(r: number, o: number): AnimIconPrim {
  const c = 16;
  return path(`M${c - r} ${c}A${r} ${r} 0 1 0 ${c + r} ${c}A${r} ${r} 0 1 0 ${c - r} ${c}`, o, 1.5);
}

/**
 * 中心那块示意图形（17×17，圆角）。**占满视野的一半以上**：卡片上的图标只有
 * 二十几像素，13px 的方形缩下去就是一小粒，读不出「这是什么」。
 */
export const center = (o = 1, dashed = false): AnimIconPrim => sq(7.5, 7.5, 17, o, dashed);

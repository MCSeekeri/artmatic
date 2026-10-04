/**
 * lsystem.ts — L-system，bake 型（揭示方式是 `'value'`）。
 *
 * 移植自 angel-echo `js/automata.js::lsystem()`（同作者内部移植，见 CREDITS.md）。
 *
 * ## 关键：纹理不是植株的画像，是**离根距离场**
 *
 * 海龟沿着展开后的字符串走，每经过一个像素就记下「它在结构上离根有多远」，
 * 归一化到 1..255。于是**生长顺序被编在像素值里** —— 一个阈值就能把整株
 * 按它自己长出来的顺序揭示出来。这与「一张图被擦出来」是两回事，也是这个
 * 生成器唯一的意义。
 *
 * 两条不能动的细节：
 * 1. **值域从 1 开始，绝不写 0。** 0 表示「海龟没来过这里」；写 0 会让阈值
 *    把它读成「比所有东西都老」，整幅画先变成一片白、植株成了黑剪影。
 * 2. **两趟。** 先抽象地走一遍收 bbox，再按 bbox 缩放到画幅栅格化。只有长完了
 *    才知道它长多大；按错误的比例栅格化再缩放，会把这里赖以成立的细线糊掉。
 *
 * ## 扩展（这一族的可扩展点最多，所以这里做得最厚）
 *
 * - **预设** 从 3 个扩到 12 个：经典曲线（Koch / Hilbert / Dragon / Gosper /
 *   Sierpinski）、灌木、海草、环纹。预设自带 `draw`（哪些字符让海龟前进）——
 *   Hilbert 用 A/B 当重写符号、Sierpinski 与 Gosper 用 A/B 当**绘图**符号，
 *   这个区别不写下来就没法同时支持它们。
 * - **随机**（`stochastic` / `jitter`，走 `mulberry32(seed)`）：跳过某次重写、
 *   给转角加抖动 —— 同一套规则从「几何图形」变成「有机植株」。
 * - **向性**（`tropism`）：每走一步把航向朝下（重力）偏一点。正负即背地/向地。
 * - **线宽**：`seg` 从单像素变成方形笔刷，细线在低分辨率下不再是虚线。
 * - **揭示顺序**（`colorMode`）：`arc` = 沿枝条的弧长（原来那套），
 *   `depth` = 按分叉层级（同一级枝条同时亮起）。两者是明显不同的动画。
 *
 * 纯确定性：同一组参数永远长成同一张纹理。
 */

import { hashSeed, mulberry32 } from '../core/prng';
import type { MessageKey } from '../i18n/locales';
import type { GeneratorDef } from './types';

export interface LSystemPreset {
  axiom: string;
  rules: Record<string, string>;
  angle: number;
  iters: number;
  /** 哪些字符让海龟前进。缺省 `'F'`。 */
  draw?: string;
}

export const LS_PRESETS: Record<string, LSystemPreset> = {
  // 细长、到处分叉 —— 读起来像树突
  neuron: { axiom: 'F', rules: { F: 'F[+F]F[-F]F' }, angle: 34, iters: 5 },
  // 经典灌木：二叉茎上开三叉
  plant: { axiom: 'F', rules: { F: 'FF-[-F+F+F]+[+F-F-F]' }, angle: 22.5, iters: 4 },
  // 放射、多臂、分叉处挂水珠 —— 一记溅开的水花
  splash: {
    axiom: '[F]+[F]+[F]+[F]+[F]+[F]+[F]+[F]+[F]+[F]+[F]+[F]',
    rules: { F: 'F[-F]F[+F]F' },
    angle: 14,
    iters: 3,
  },
  // 规整的树冠：一节三叉，越往上越密
  tree: { axiom: 'F', rules: { F: 'F[+F]F[-F][F]' }, angle: 20, iters: 5 },
  // 矮而密的灌木丛
  bush: { axiom: 'F', rules: { F: 'F[+FF][-FF]F[-F][+F]F' }, angle: 22.5, iters: 4 },
  // 经典 Koch 曲线的边
  koch: { axiom: 'F', rules: { F: 'F+F-F-F+F' }, angle: 90, iters: 4 },
  // Koch 岛：四条边围成一个带尖刺的雪片
  kochIsland: { axiom: 'F+F+F+F', rules: { F: 'F+F-F-FF+F+F-F' }, angle: 90, iters: 3 },
  // Heighway 龙曲线：折纸一样对折出来的龙
  dragon: { axiom: 'FX', rules: { X: 'X+YF+', Y: '-FX-Y' }, angle: 90, iters: 11 },
  // Hilbert 曲线：A/B 是**重写符号**，只有 F 画线
  hilbert: { axiom: 'A', rules: { A: '-BF+AFA+FB-', B: '+AF-BFB-FA+' }, angle: 90, iters: 6 },
  // Sierpinski 三角：这里 A/B 是**绘图**符号
  sierpinski: { axiom: 'A', rules: { A: 'B-A-B', B: 'A+B+A' }, angle: 60, iters: 7, draw: 'AB' },
  // Gosper 曲线：同样 A/B 都画线
  gosper: {
    axiom: 'A',
    rules: { A: 'A-B--B+A++AA+B-', B: '+A-BB--B-A++A+B' },
    angle: 60,
    iters: 4,
    draw: 'AB',
  },
  // 环纹：正方形边上的分形折线
  rings: { axiom: 'F+F+F+F', rules: { F: 'FF+F+F+F+FF' }, angle: 90, iters: 3 },
};

/** 展开串的长度上限 —— 防止一条坏规则把页面挂住。 */
const MAX_EXPAND = 400_000;
/** 海龟栈深上限 —— 同理。 */
const MAX_STACK = 20_000;

export interface LSystemOptions {
  preset: LSystemPreset;
  w: number;
  h: number;
  /** 覆盖预设的转角（度）。 */
  angleDeg?: number;
  /** 覆盖预设的迭代次数。 */
  iters?: number;
  /** 线宽（1..5）。 */
  lineWidth?: number;
  /** 每次重写有该概率被跳过（0..1）—— 枝条长度参差，看起来更自然。 */
  stochastic?: number;
  /** 转角抖动幅度（0..1，相对转角）。 */
  jitter?: number;
  /** 向性：正 = 朝下（重力），负 = 朝上（向光）。 */
  tropism?: number;
  /** 揭示顺序：沿弧长 / 按分叉层级。 */
  colorMode?: 'arc' | 'depth';
  seed?: number;
}

export function lsystemRun(o: LSystemOptions): { data: Uint8Array; w: number; h: number } {
  const preset = o.preset;
  const iters = Math.max(1, Math.round(o.iters || preset.iters || 4));
  const angleDeg = o.angleDeg && o.angleDeg > 0 ? o.angleDeg : preset.angle || 25;
  const draw = preset.draw ?? 'F';
  const lineWidth = Math.max(1, Math.min(5, Math.round(o.lineWidth || 1)));
  const stochastic = Math.max(0, Math.min(1, o.stochastic ?? 0));
  const jitter = Math.max(0, Math.min(1, o.jitter ?? 0));
  const tropism = Math.max(-1, Math.min(1, o.tropism ?? 0));
  const rnd = mulberry32(hashSeed(o.seed ?? 1, 'lsystem'));

  /* 展开。`stochastic` 在这里生效：按概率保留原字符 = 少长一节。 */
  let str = preset.axiom;
  for (let it = 0; it < iters; it++) {
    let next = '';
    for (let i = 0; i < str.length; i++) {
      const c = str[i]!;
      if (stochastic > 0 && rnd() < stochastic) next += c;
      else next += preset.rules[c] ?? c;
    }
    str = next;
    if (str.length > MAX_EXPAND) break;
  }

  /* 第一趟：抽象单位下走一遍，收下线段与 bbox */
  const sx: number[] = [];
  const sy: number[] = [];
  const ex: number[] = [];
  const ey: number[] = [];
  const ds: number[] = [];
  let x = 0;
  let y = 0;
  let a = -Math.PI / 2;
  let d = 0;
  let dmax = 1;
  let dmaxDepth = 1;
  let minX = 0;
  let maxX = 0;
  let minY = 0;
  let maxY = 0;
  const stack: number[] = [];
  const ar = (angleDeg * Math.PI) / 180;
  const w = o.w;
  const h = o.h;

  for (let i = 0; i < str.length; i++) {
    const c = str[i]!;
    if (draw.includes(c)) {
      const nx = x + Math.cos(a);
      const ny = y + Math.sin(a);
      sx.push(x);
      sy.push(y);
      ex.push(nx);
      ey.push(ny);
      ds.push(d);
      d += 1;
      if (d > dmax) dmax = d;
      x = nx;
      y = ny;
      if (x < minX) minX = x;
      else if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      else if (y > maxY) maxY = y;
      // 向性：每走一步把航向朝重力（+π/2，即屏幕下方）偏一点。
      if (tropism !== 0) {
        let diff = Math.PI / 2 - a;
        diff = ((diff + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI;
        a += tropism * 0.06 * diff;
      }
    } else if (c === '+') a += ar * (1 + jitter * (rnd() * 2 - 1));
    else if (c === '-') a -= ar * (1 + jitter * (rnd() * 2 - 1));
    else if (c === '[') {
      stack.push(x, y, a, d);
      // 每进一层分叉就把深度抬一点：同一物理距离上，分叉点比主干的「结构年龄」大
      d += 0.25;
      if (d > dmaxDepth) dmaxDepth = d;
    } else if (c === ']') {
      a = stack.pop()!;
      d = stack.pop()!;
      y = stack.pop()!;
      x = stack.pop()!;
    }
    if (stack.length > MAX_STACK) break;
  }

  /* 第二趟：适配画幅，把「距离」当作像素值栅格化 */
  const data = new Uint8Array(w * h);
  const bw = Math.max(1e-6, maxX - minX);
  const bh = Math.max(1e-6, maxY - minY);
  const sc = Math.min((w * 0.9) / bw, (h * 0.92) / bh);
  const cx = w * 0.5 - (minX + maxX) * 0.5 * sc;
  const rowTop = h * 0.04;
  const half = Math.floor((lineWidth - 1) / 2);
  const useDepth = o.colorMode === 'depth';

  const put = (px: number, py: number, v: number): void => {
    const bx = px | 0;
    const by = py | 0;
    for (let oy = -half; oy <= half; oy++) {
      const yi = by + oy;
      if (yi < 0 || yi >= h) continue;
      for (let ox = -half; ox <= half; ox++) {
        const xi = bx + ox;
        if (xi < 0 || xi >= w) continue;
        const k = yi * w + xi;
        if (data[k]! < v) data[k] = v;
      }
    }
  };

  const seg = (x0: number, y0: number, x1: number, y1: number, d0: number): void => {
    const dx = x1 - x0;
    const dy = y1 - y0;
    const steps = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dy))));
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      // 1 + 254·(量/量上限)：根是 1，最远的尖端是 255。**永不为 0**。
      const q = useDepth ? d0 / dmaxDepth : (d0 + t) / dmax;
      put(x0 + dx * t, y0 + dy * t, Math.round(1 + 254 * q));
    }
  };

  for (let i = 0; i < sx.length; i++) {
    seg(cx + sx[i]! * sc, rowTop + (maxY - sy[i]!) * sc,
        cx + ex[i]! * sc, rowTop + (maxY - ey[i]!) * sc, ds[i]!);
  }

  return { data, w, h };
}

/** 旧签名（被 `tests/unit/algos.test.ts` 钉住）：预设自己的角度/迭代/线宽 1。 */
export function lsystem(
  preset: LSystemPreset,
  w: number,
  h: number,
): { data: Uint8Array; w: number; h: number } {
  return lsystemRun({ preset, w, h });
}

const PRESET_KEYS: { key: string; labelKey: MessageKey }[] = [
  { key: 'neuron', labelKey: 'algo.lsystem.neuron' },
  { key: 'plant', labelKey: 'algo.lsystem.plant' },
  { key: 'splash', labelKey: 'algo.lsystem.splash' },
  { key: 'tree', labelKey: 'algo.lsystem.tree' },
  { key: 'bush', labelKey: 'algo.lsystem.bush' },
  { key: 'koch', labelKey: 'algo.lsystem.koch' },
  { key: 'kochIsland', labelKey: 'algo.lsystem.kochIsland' },
  { key: 'dragon', labelKey: 'algo.lsystem.dragon' },
  { key: 'hilbert', labelKey: 'algo.lsystem.hilbert' },
  { key: 'sierpinski', labelKey: 'algo.lsystem.sierpinski' },
  { key: 'gosper', labelKey: 'algo.lsystem.gosper' },
  { key: 'rings', labelKey: 'algo.lsystem.rings' },
];

export const lsystemDef: GeneratorDef = {
  id: 'lsystem',
  nameKey: 'algo.lsystem',
  kind: 'bake',
  reveal: 'value',
  volatile: ['speed', 'colorBg', 'colorLive'],
  params: [
    {
      key: 'preset',
      labelKey: 'algo.lsystem.preset',
      type: 'select',
      defaultValue: 'neuron',
      options: PRESET_KEYS.map((p) => ({ labelKey: p.labelKey, value: p.key })),
    },
    { key: 'width', labelKey: 'algo.lsystem.width', type: 'range', min: 256, max: 1600, step: 32, defaultValue: 768 },
    { key: 'height', labelKey: 'algo.lsystem.height', type: 'range', min: 144, max: 900, step: 18, defaultValue: 432 },
    // 0 = 跟随预设。做成哨兵而不是「复制预设的值」，是因为参数表是静态的：
    // 换预设时角度应当跟着走，而不是被上一次的滑杆位置钉住。
    { key: 'angleOverride', labelKey: 'algo.lsystem.angle', type: 'range', min: 0, max: 180, step: 0.5, defaultValue: 0 },
    { key: 'iterOverride', labelKey: 'algo.lsystem.iters', type: 'range', min: 0, max: 12, step: 1, defaultValue: 0 },
    { key: 'lineWidth', labelKey: 'algo.lsystem.lineWidth', type: 'range', min: 1, max: 5, step: 1, defaultValue: 1 },
    { key: 'stochastic', labelKey: 'algo.lsystem.stochastic', type: 'range', min: 0, max: 0.6, step: 0.01, defaultValue: 0 },
    { key: 'jitter', labelKey: 'algo.lsystem.jitter', type: 'range', min: 0, max: 1, step: 0.01, defaultValue: 0 },
    { key: 'tropism', labelKey: 'algo.lsystem.tropism', type: 'range', min: -1, max: 1, step: 0.01, defaultValue: 0 },
    {
      key: 'colorMode',
      labelKey: 'algo.lsystem.colorMode',
      type: 'select',
      defaultValue: 'arc',
      options: [
        { labelKey: 'algo.lsystem.modeArc', value: 'arc' },
        { labelKey: 'algo.lsystem.modeDepth', value: 'depth' },
      ],
    },
    // 'value' 模式的前沿以 0..1 走完整个 255 值域，所以速度单位是「值/秒」。
    { key: 'speed', labelKey: 'algo.lsystem.speed', type: 'range', min: 5, max: 255, step: 1, defaultValue: 42 },
    { key: 'colorBg', labelKey: 'algo.lsystem.colorBg', type: 'color', defaultValue: '#04070a' },
    { key: 'colorLive', labelKey: 'algo.lsystem.colorLive', type: 'color', defaultValue: '#9fe8ff' },
  ],
  bake(params, seed) {
    const w = Math.round(Number(params.width) || 768);
    const h = Math.round(Number(params.height) || 432);
    const preset = LS_PRESETS[String(params.preset)] ?? LS_PRESETS['neuron']!;
    const { data } = lsystemRun({
      preset,
      w,
      h,
      angleDeg: Number(params.angleOverride) || 0,
      iters: Number(params.iterOverride) || 0,
      lineWidth: Number(params.lineWidth) || 1,
      stochastic: Number(params.stochastic) || 0,
      jitter: Number(params.jitter) || 0,
      tropism: Number(params.tropism) || 0,
      colorMode: params.colorMode === 'depth' ? 'depth' : 'arc',
      seed,
    });
    // 前沿走的是像素值 0..255 → 归一化用 255。
    return { data, w, h, frontMax: 255 };
  },
};

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
 * 纯确定性：同一预设永远长成同一张纹理。
 */

import type { GeneratorDef } from './types';

export interface LSystemPreset {
  axiom: string;
  rules: Record<string, string>;
  angle: number;
  iters: number;
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
};

/** 展开串的长度上限 —— 防止一条坏规则把页面挂住。 */
const MAX_EXPAND = 400_000;
/** 海龟栈深上限 —— 同理。 */
const MAX_STACK = 20_000;

export function lsystem(
  preset: LSystemPreset,
  w: number,
  h: number,
): { data: Uint8Array; w: number; h: number } {
  let str = preset.axiom;
  for (let it = 0; it < (preset.iters || 4); it++) {
    let next = '';
    for (let i = 0; i < str.length; i++) {
      const c = str[i]!;
      next += preset.rules[c] ?? c;
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
  let minX = 0;
  let maxX = 0;
  let minY = 0;
  let maxY = 0;
  const stack: number[] = [];
  const ar = ((preset.angle || 25) * Math.PI) / 180;

  for (let i = 0; i < str.length; i++) {
    const c = str[i]!;
    if (c === 'F') {
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
    } else if (c === '+') a += ar;
    else if (c === '-') a -= ar;
    else if (c === '[') {
      stack.push(x, y, a, d);
      // 每进一层分叉就把深度抬一点：同一物理距离上，分叉点比主干的「结构年龄」大
      d += 0.25;
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

  const put = (px: number, py: number, v: number): void => {
    const xi = px | 0;
    const yi = py | 0;
    if (xi < 0 || yi < 0 || xi >= w || yi >= h) return;
    const k = yi * w + xi;
    if (data[k]! < v) data[k] = v;
  };

  const seg = (x0: number, y0: number, x1: number, y1: number, d0: number): void => {
    const dx = x1 - x0;
    const dy = y1 - y0;
    const steps = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dy))));
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      // 1 + 254·(d0+t)/dmax：根是 1，最远的尖端是 255。**永不为 0**。
      put(x0 + dx * t, y0 + dy * t, Math.round(1 + (254 * (d0 + t)) / dmax));
    }
  };

  for (let i = 0; i < sx.length; i++) {
    seg(cx + sx[i]! * sc, rowTop + (maxY - sy[i]!) * sc,
        cx + ex[i]! * sc, rowTop + (maxY - ey[i]!) * sc, ds[i]!);
  }

  return { data, w, h };
}

export const lsystemDef: GeneratorDef = {
  id: 'lsystem',
  nameKey: 'algo.lsystem',
  kind: 'bake',
  reveal: 'value',
  params: [
    {
      key: 'preset',
      labelKey: 'algo.lsystem.preset',
      type: 'select',
      defaultValue: 'neuron',
      options: [
        { labelKey: 'algo.lsystem.neuron', value: 'neuron' },
        { labelKey: 'algo.lsystem.plant', value: 'plant' },
        { labelKey: 'algo.lsystem.splash', value: 'splash' },
      ],
    },
    { key: 'width', labelKey: 'algo.lsystem.width', type: 'range', min: 256, max: 1600, step: 32, defaultValue: 768 },
    { key: 'height', labelKey: 'algo.lsystem.height', type: 'range', min: 144, max: 900, step: 18, defaultValue: 432 },
    // 'value' 模式的前沿以 0..1 走完整个 255 值域，所以速度单位是「值/秒」。
    { key: 'speed', labelKey: 'algo.lsystem.speed', type: 'range', min: 5, max: 255, step: 1, defaultValue: 42 },
    { key: 'colorBg', labelKey: 'algo.lsystem.colorBg', type: 'color', defaultValue: '#04070a' },
    { key: 'colorLive', labelKey: 'algo.lsystem.colorLive', type: 'color', defaultValue: '#9fe8ff' },
  ],
  bake(params) {
    const w = Math.round(Number(params.width) || 768);
    const h = Math.round(Number(params.height) || 432);
    const preset = LS_PRESETS[String(params.preset)] ?? LS_PRESETS['neuron']!;
    const { data } = lsystem(preset, w, h);
    // 前沿走的是像素值 0..255 → 归一化用 255。
    return { data, w, h, frontMax: 255 };
  },
};

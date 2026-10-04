/**
 * rule110.ts — 基本元胞自动机（一维，任意规则 0~255），bake 型。
 *
 * 移植自 angel-echo js/automata.js 的 elementary()（同作者内部移植）。
 *
 * 血泪常量：活细胞必须写 LIVE = 255，不是 1。R8 纹理把字节归一化到
 * 0..1，写 1 得到 0.0039，着色器里任何阈值（smoothstep(0.4, 0.9, v)）
 * 都把它抹成 0——整幅图只剩抖动噪声。LIVE 是唯一定义，禁止裸写。
 *
 * ## 扩展（规则位表 / 手绘初始行 / 边界 / 代际着色）
 *
 * - `rule` 从「30/90/110 三选一」变成完整的 0~255 位表（`bitmask` 参数）。
 *   位序就是 Wolfram 的读法：111 那一行是最高位，Rule 30 = 00011110₂。
 * - `seedMode` 增加 `pattern`：初始行可以由用户手绘（一行），复用
 *   `pattern-codec` 的那套编解码与「居中裁剪」。
 * - `wrap` 关掉环面边界。固定边界下三角形会被「切平」，形态与环面
 *   完全不同 —— 这是很便宜的一个自由度。
 * - `colorMode: 'age'` 把「出生后经过了多少代」编进像素值，于是同一张
 *   时空图有了代际梯度，而不是纯二值。
 */

import { mulberry32 } from '../core/prng';
import { clampMask } from '../core/bitmask';
import { patternFromParam, stampRow, type Bitmap } from './pattern-codec';
import type { MessageKey } from '../i18n/locales';
import type { GeneratorDef } from './types';

export const LIVE = 255;

export type EcaSeedMode = 'single' | 'random' | 'pattern';

/**
 * 造初始行（长度 `w`，0/1）。
 *
 * `pattern` 模式下只取位图的**第 0 行**，居中裁剪 —— 「一维图案」的语义
 * 就是一行。`bm` 为 `null`（空串 / 坏串）时退回单点种子：全空行会让整幅图
 * 变成纯背景，看起来像「算法坏了」，而单点至少还能长出一个三角形。
 */
export function makeSeedRow(
  w: number,
  mode: EcaSeedMode,
  seed: number,
  bm: Bitmap | null,
  density = 0.5,
): Uint8Array {
  const row = new Uint8Array(w);
  if (mode === 'pattern' && bm) {
    stampRow(row, w, bm, 1);
    return row;
  }
  if (mode === 'random') {
    const rnd = mulberry32(seed);
    const d = Math.max(0, Math.min(1, density));
    for (let i = 0; i < w; i++) row[i] = rnd() < d ? 1 : 0;
    return row;
  }
  row[w >> 1] = 1;
  return row;
}

export interface EcaRunOptions {
  rule: number;
  w: number;
  h: number;
  /** 长度必须为 `w`，取值 0/1。 */
  seedRow: Uint8Array;
  /** 环面边界（默认开）。关掉时行两端之外视为 0。 */
  wrap: boolean;
  /** 把「出生后经过的代数」编进像素值（1..255）而不是恒写 LIVE。 */
  age: boolean;
}

/**
 * 逐代演化并栅格化。第 0 行是种子行，之后每代往下长一行。
 *
 * 代际着色用 AGE=1 作为新生细胞的取值（不是 0）—— 0 是「背景」的意思，
 * 一个刚出生的细胞必须可见。
 */
export function elementaryRun(o: EcaRunOptions): { data: Uint8Array; w: number; h: number } {
  const { w, h } = o;
  const out = new Uint8Array(w * h);
  const bits = clampMask(o.rule, 8);
  let row = o.seedRow.slice();
  const ageRow = new Uint8Array(w);
  const nextAge = new Uint8Array(w);

  for (let y = 0; y < h; y++) {
    const dst = y * w;
    for (let x = 0; x < w; x++) {
      if (!row[x]) continue;
      out[dst + x] = o.age ? Math.max(1, ageRow[x]!) : LIVE;
    }
    const next = new Uint8Array(w);
    nextAge.fill(0);
    for (let x = 0; x < w; x++) {
      const li = o.wrap ? (x - 1 + w) % w : x === 0 ? w : x - 1;
      const ri = o.wrap ? (x + 1) % w : x === w - 1 ? w : x + 1;
      // `w` 是一个「越界」的哨兵下标 → 取 0。用同一条路径表达两种边界，
      // 避免在循环里写分支（这是这里唯一的热循环）。
      const l = li < w ? row[li]! : 0;
      const c = row[x]!;
      const r = ri < w ? row[ri]! : 0;
      const nv = (bits >> ((l << 2) | (c << 1) | r)) & 1;
      next[x] = nv;
      if (nv) nextAge[x] = c ? Math.min(255, (ageRow[x] || 0) + 1) : 1;
    }
    row = next;
    ageRow.set(nextAge);
  }
  return { data: out, w, h };
}

/**
 * 旧签名（被 `tests/unit/algos.test.ts` 钉住，不能改）。
 * 行为与扩展前逐字节一致：环面边界、二值着色、随机密度 0.5。
 */
export function elementary(
  rule: number,
  w: number,
  h: number,
  seedMode: 'single' | 'random',
  seed: number,
): { data: Uint8Array; w: number; h: number } {
  return elementaryRun({
    rule,
    w,
    h,
    seedRow: makeSeedRow(w, seedMode, seed, null, 0.5),
    wrap: true,
    age: false,
  });
}

/** 常用规则的快捷位表。数值是 Wolfram 编号，不是「几选一」的下标。 */
const RULE_PRESETS: { labelKey: MessageKey; value: number }[] = [
  { labelKey: 'algo.rule.name30', value: 30 },
  { labelKey: 'algo.rule.name45', value: 45 },
  { labelKey: 'algo.rule.name54', value: 54 },
  { labelKey: 'algo.rule.name60', value: 60 },
  { labelKey: 'algo.rule.name90', value: 90 },
  { labelKey: 'algo.rule.name110', value: 110 },
  { labelKey: 'algo.rule.name150', value: 150 },
  { labelKey: 'algo.rule.name184', value: 184 },
  { labelKey: 'algo.rule.name250', value: 250 },
];

export const rule110Def: GeneratorDef = {
  id: 'rule110',
  nameKey: 'algo.rule110',
  kind: 'bake',
  // 揭示速度与配色只在 reveal pass 里读 —— 改它们不该重烘整张时空图。
  volatile: ['speed', 'colorBg', 'colorLive'],
  params: [
    {
      key: 'rule',
      labelKey: 'algo.rule110.rule',
      type: 'bitmask',
      bits: 8,
      defaultValue: 110,
      slider: true,
      groups: [{ labelKey: 'algo.rule110.neighbourhood', bits: 8, style: 'eca' }],
      presets: RULE_PRESETS,
    },
    { key: 'width', labelKey: 'algo.rule110.width', type: 'range', min: 128, max: 2048, step: 64, defaultValue: 1024 },
    { key: 'height', labelKey: 'algo.rule110.height', type: 'range', min: 128, max: 2048, step: 64, defaultValue: 512 },
    {
      key: 'seedMode',
      labelKey: 'algo.rule110.seedMode',
      type: 'select',
      defaultValue: 'single',
      options: [
        { labelKey: 'algo.rule110.seedSingle', value: 'single' },
        { labelKey: 'algo.rule110.seedRandom', value: 'random' },
        { labelKey: 'algo.rule110.seedPattern', value: 'pattern' },
      ],
    },
    {
      key: 'pattern',
      labelKey: 'algo.rule110.pattern',
      type: 'pattern',
      defaultValue: '',
      editorSize: 64,
      mode: '1d',
      visibleWhen: (v) => v.seedMode === 'pattern',
    },
    {
      key: 'seedDensity',
      labelKey: 'algo.rule110.seedDensity',
      type: 'range',
      min: 0.05,
      max: 0.95,
      step: 0.01,
      defaultValue: 0.5,
      visibleWhen: (v) => v.seedMode === 'random',
    },
    { key: 'wrap', labelKey: 'algo.rule110.wrap', type: 'checkbox', defaultValue: 1 },
    {
      key: 'colorMode',
      labelKey: 'algo.rule110.colorMode',
      type: 'select',
      defaultValue: 'binary',
      options: [
        { labelKey: 'algo.rule110.colorBinary', value: 'binary' },
        { labelKey: 'algo.rule110.colorAge', value: 'age' },
      ],
    },
    { key: 'speed', labelKey: 'algo.rule110.speed', type: 'range', min: 0, max: 400, step: 1, defaultValue: 96 },
    { key: 'colorBg', labelKey: 'algo.rule110.colorBg', type: 'color', defaultValue: '#05070f' },
    { key: 'colorLive', labelKey: 'algo.rule110.colorLive', type: 'color', defaultValue: '#7fd4ff' },
  ],
  bake(params, seed) {
    const w = Math.round(Number(params.width) || 1024);
    const h = Math.round(Number(params.height) || 512);
    // 规则 0 是**合法**规则（全部归零）。这里绝不能用 `|| 110` —— 那会把
    // 用户选的 0 悄悄换成 110。
    const rule = clampMask(params.rule, 8);
    const raw = String(params.seedMode ?? 'single');
    const mode: EcaSeedMode = raw === 'random' || raw === 'pattern' ? raw : 'single';
    const bm = mode === 'pattern' ? patternFromParam(params.pattern) : null;
    const seedRow = makeSeedRow(w, mode, seed, bm, Number(params.seedDensity) || 0.5);
    const { data } = elementaryRun({
      rule,
      w,
      h,
      seedRow,
      wrap: Number(params.wrap ?? 1) !== 0,
      age: params.colorMode === 'age',
    });
    return { data, w, h, frontMax: h };
  },
};

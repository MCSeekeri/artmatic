/**
 * lyapunov.ts — 李雅普诺夫分形（logistic 映射 + A/B 参数序列），realtime 型。
 *
 * ## 数学
 *
 * 取 logistic 映射 `x ← r·x·(1−x)`，让 `r` 按一个固定的 **A/B 序列**在两个
 * 值之间交替（位置 k 是 A 就用 a，是 B 就用 b），然后算这段轨道上的
 * 李雅普诺夫指数：
 *
 * ```
 * λ = (1/N) · Σ ln |r_k · (1 − 2·x_k)|
 * ```
 *
 * `λ < 0` 表示这条轨道稳定（收敛到周期解），`λ > 0` 表示混沌。把 (a, b) 平面
 * 上每个点的 λ 画出来就是 Lyapunov 分形 —— 冻结的序列是**唯一的「输入」**，
 * 所以同一个 a/b 窗口换个序列就是完全另一张图。
 *
 * ## 序列用 `pattern` 参数（1D 模式）而不是位掩码
 *
 * 这是**为了长度**：序列的身份由「位模式 **和** 长度」共同决定，而 `bitmask`
 * 只有一个整数 —— `AB` 与 `ABB` 会编码成同一个值。`pattern` 自带宽度
 * （`WxH:…`，W 就是序列长度），于是「画一行格子」这件事同时表达了内容和长度。
 * 顺带复用了 Wave 1 的图案编辑器：**亮 = A，灭 = B**。
 *
 * ## 两处 GL 细节
 *
 * 1. **序列位用浮点整数 `/ exp2(k)` 提取**，不是位运算 —— GLSL ES 3.00 没有
 *    整数位运算（`<<`/`&` 都不在核心语言里）。24 位以内的整数在 float32 里
 *    是精确的，所以 `floor(bits / 2^k) mod 2` 逐位可靠；再长就不行了
 *    （2^24 之后 float32 丢整数精度），所以长度上限钉在 24。
 * 2. **`x` 要被钳住**。r 落在 [0,4] 之外时 logistic 迭代会跑飞，`x` 变成
 *    ±Inf 之后下一步就是 NaN，整幅图静默变黑。
 *
 * fragment **不含头**：`ALGO_HEAD` 拼在前面。
 */

import { bitmapFromRows, encodePattern, patternFromParam } from './pattern-codec';
import { colorVec3 } from '../core/color';
import { intResParam, type AlgoUniformCtx } from './shader-lib';
import type { GeneratorDef } from './types';

/**
 * 序列长度的上限。
 *
 * 24 是 float32 精确整数的上界（2^24）—— 再长一位，`u_seqBits` 就无法逐位
 * 还原了。图案编辑器允许画到 64，超出部分会被截断（见 `setUniforms`）。
 */
export const MAX_SEQ_LEN = 24;

/** 默认序列 `AABAB`。`#` = A（活），`.` = B。 */
export const DEFAULT_SEQ = '##.#.';

export const LYAPUNOV_FRAG = `
uniform float u_seqBits;   // 低位 = 序列第 0 位；1 = A
uniform float u_seqLen;
uniform vec2  u_aRange;    // (下限, 上限)
uniform vec2  u_bRange;
uniform int   u_iter;      // 每点迭代数
uniform int   u_warmup;    // 预热步数（丢掉瞬态）
uniform int   u_coloring;  // 0 = 条带 · 1 = 稳定/混沌 · 2 = 连续指数
uniform int   u_palette;   // 0 = 双色 · 1 = 余弦
uniform float u_cycle;
uniform float u_scale;     // 对比（λ 的倍率）
uniform vec3  u_colorA;    // 稳定端
uniform vec3  u_colorB;    // 混沌端

/** 序列第 k 位。见文件头第 1 条：用除法与 floor，不用位运算。 */
float seqAt(float k) {
  return mod(floor(u_seqBits / exp2(k)), 2.0);
}

vec3 palette(float t) {
  if (u_palette == 1) {
    float ph = t * 6.2831853 + u_cycle * 6.2831853;
    return 0.5 + 0.5 * cos(ph + vec3(0.0, 2.094, 4.188));
  }
  return mix(u_colorA, u_colorB, sqrt(clamp(t, 0.0, 1.0)));
}

void main() {
  float a = mix(u_aRange.x, u_aRange.y, vUv.x);
  float b = mix(u_bRange.x, u_bRange.y, vUv.y);
  float x = 0.5;

  for (int i = 0; i < u_warmup; i++) {
    float r = seqAt(mod(float(i), u_seqLen)) > 0.5 ? a : b;
    x = clamp(r * x * (1.0 - x), -1.0e6, 1.0e6);
  }

  float sum = 0.0;
  for (int i = 0; i < u_iter; i++) {
    float r = seqAt(mod(float(i), u_seqLen)) > 0.5 ? a : b;
    x = clamp(r * x * (1.0 - x), -1.0e6, 1.0e6);
    // 导数的绝对值：|d/dx (r·x·(1−x))| = |r·(1−2x)|
    sum += log(max(abs(r * (1.0 - 2.0 * x)), 1e-9));
  }
  float ly = (sum / float(max(u_iter, 1))) * u_scale;

  float t;
  if (u_coloring == 1) {
    // 稳定 / 混沌：λ 的符号 —— 这是 Lyapunov 分形最经典的读法
    t = step(0.0, ly);
  } else if (u_coloring == 2) {
    // 连续：把 λ 从约 [−2, 1] 拉到 [0, 1]
    t = clamp((ly + 1.2) * 0.5, 0.0, 1.0);
  } else {
    // 条带：λ 的小数部分 → 等值线，同一稳定性等级里也读出层次
    t = fract(ly);
  }
  outColor = vec4(palette(t), 1.0);
}`;

const COLORINGS: Record<string, number> = { bands: 0, binary: 1, smooth: 2 };
const PALETTES: Record<string, number> = { duo: 0, cosine: 1 };

/**
 * 把图案串解成「位 + 长度」。
 *
 * 抽成导出的纯函数是为了**它能被单测钉住** —— 位序（低位是不是第 0 位）
 * 错了不会报错，只是画出来的图与编辑器里画的那一行次序相反。
 *
 * 三条回退规则，都回退到「AB」：
 * - 解不出图案 / 长度 < 2（单格序列退化成「只有一个 r」，是条对角线不是分形）；
 * - **一位都没点亮**。这不只是坏输入：`decodePattern` 是刻意宽容的
 *   （未知字符会被跳过），所以 `4x1:!!!` 这种垃圾会解出一张全 0 的图；
 *   而「全是 B」意味着 `a` 区间**完全不起作用**，画面退化成一条竖直渐变 ——
 *   用户拖 a 的上下限却什么都不动，是最难自查的一类状态。
 */
export function sequenceBits(value: unknown): { bits: number; len: number } {
  const bm = patternFromParam(value);
  if (!bm || bm.w < 2) return { bits: 0b10, len: 2 }; // 回退 "AB"
  const len = Math.min(MAX_SEQ_LEN, bm.w);
  let bits = 0;
  for (let k = 0; k < len; k++) if (bm.data[k]) bits += 2 ** k;
  if (bits === 0) return { bits: 0b10, len: 2 }; // 没有 A：a 区间会失去作用
  return { bits, len };
}

export const lyapunovDef: GeneratorDef = {
  id: 'lyapunov',
  nameKey: 'algo.lyapunov',
  kind: 'realtime',
  fragment: LYAPUNOV_FRAG,
  params: [
    {
      key: 'sequence',
      labelKey: 'algo.lyapunov.sequence',
      type: 'pattern',
      defaultValue: encodePattern(bitmapFromRows([DEFAULT_SEQ])),
      editorSize: 8,
      mode: '1d',
    },
    { key: 'iterations', labelKey: 'algo.lyapunov.iterations', type: 'range', min: 40, max: 800, step: 20, defaultValue: 240 },
    { key: 'warmup', labelKey: 'algo.lyapunov.warmup', type: 'range', min: 0, max: 400, step: 10, defaultValue: 120 },
    { key: 'aMin', labelKey: 'algo.lyapunov.aMin', type: 'range', min: 0, max: 4, step: 0.002, defaultValue: 2 },
    { key: 'aMax', labelKey: 'algo.lyapunov.aMax', type: 'range', min: 0, max: 4, step: 0.002, defaultValue: 4 },
    { key: 'bMin', labelKey: 'algo.lyapunov.bMin', type: 'range', min: 0, max: 4, step: 0.002, defaultValue: 2 },
    { key: 'bMax', labelKey: 'algo.lyapunov.bMax', type: 'range', min: 0, max: 4, step: 0.002, defaultValue: 4 },
    {
      key: 'coloring',
      labelKey: 'algo.lyapunov.coloring',
      type: 'select',
      defaultValue: 'bands',
      options: [
        { labelKey: 'algo.lyapunov.colorBands', value: 'bands' },
        { labelKey: 'algo.lyapunov.colorBinary', value: 'binary' },
        { labelKey: 'algo.lyapunov.colorSmooth', value: 'smooth' },
      ],
    },
    {
      key: 'palette',
      labelKey: 'algo.lyapunov.palette',
      type: 'select',
      defaultValue: 'cosine',
      options: [
        { labelKey: 'algo.lyapunov.paletteDuo', value: 'duo' },
        { labelKey: 'algo.lyapunov.paletteCosine', value: 'cosine' },
      ],
    },
    {
      key: 'cycle',
      labelKey: 'algo.lyapunov.cycle',
      type: 'range',
      min: 0,
      max: 1,
      step: 0.005,
      defaultValue: 0,
      visibleWhen: (v) => v.palette === 'cosine',
    },
    { key: 'scale', labelKey: 'algo.lyapunov.scale', type: 'range', min: 0.2, max: 6, step: 0.05, defaultValue: 1 },
    { key: 'colorStable', labelKey: 'algo.lyapunov.colorStable', type: 'color', defaultValue: '#06070d' },
    { key: 'colorChaos', labelKey: 'algo.lyapunov.colorChaos', type: 'color', defaultValue: '#ffd9a0' },
    intResParam(),
  ],
  setUniforms: (gl, l, v, _ctx: AlgoUniformCtx) => {
    const seq = sequenceBits(v.sequence);
    const f1 = (name: string, value: number): void => {
      const loc = l[name];
      if (loc) gl.uniform1f(loc, value);
    };
    const i1 = (name: string, value: number): void => {
      const loc = l[name];
      if (loc) gl.uniform1i(loc, Math.round(value));
    };
    const v2 = (name: string, a: number, b: number): void => {
      const loc = l[name];
      if (loc) gl.uniform2f(loc, a, b);
    };
    const c3 = (name: string, hex: string): void => {
      const loc = l[name];
      if (!loc) return;
      const [r, g, b] = colorVec3(hex);
      gl.uniform3f(loc, r, g, b);
    };

    f1('u_seqBits', seq.bits);
    f1('u_seqLen', seq.len);
    v2('u_aRange', Number(v.aMin ?? 2), Number(v.aMax ?? 4));
    v2('u_bRange', Number(v.bMin ?? 2), Number(v.bMax ?? 4));
    i1('u_iter', Math.max(1, Math.min(2000, Number(v.iterations ?? 240))));
    i1('u_warmup', Math.max(0, Math.min(2000, Number(v.warmup ?? 120))));
    i1('u_coloring', COLORINGS[String(v.coloring)] ?? 0);
    i1('u_palette', PALETTES[String(v.palette)] ?? 1);
    f1('u_cycle', Number(v.cycle ?? 0));
    f1('u_scale', Math.max(0.05, Number(v.scale ?? 1)));
    c3('u_colorA', String(v.colorStable ?? '#06070d'));
    c3('u_colorB', String(v.colorChaos ?? '#ffd9a0'));
  },
};

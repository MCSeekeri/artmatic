/**
 * reaction-diffusion.ts — Gray-Scott 反应扩散，`sim` 型，**2 通道**。
 *
 * 它是唯一同时用满三样新协议的东西 —— `channels: 2`、自定义
 * `tintFragment`、`setTintUniforms` —— 所以它排在第一个：跑通它等于把
 * 这三样一次性验证完。
 *
 * ## 方程与口径（必须成对，不能混）
 *
 * ```
 * ∂u/∂t = Du·∇²u − u·v² + F·(1−u)
 * ∂v/∂t = Dv·∇²v + u·v² − (F+k)·v
 * ```
 *
 * **9 点 Laplacian**（中心 −1，边 0.2，角 0.05；权重和为 0）× **Du=1.0 / Dv=0.5**，
 * 时间步 dt=1（直接折进更新式）。
 *
 * ⚠️ 别把 `Du=0.16 / Dv=0.08` 那套搬过来 —— 那套只在 **5 点模板**下与上面等价，
 * 模板与系数必须成对。混着用得到的不是「稍微不同的花纹」，是根本不成形。
 *
 * ## 状态精度
 *
 * 内部是两条 `Float32Array`（u、v 都是连续浓度），`current()` 才量化成 8 位。
 * 快照存的是**内部浮点数组的副本**，所以 `seek(f) ≡ 顺序 step f 次` 在浮点精度上
 * 成立 —— 拿量化后的输出当快照会把每一步的舍入误差累积进重放路径。
 *
 * u 与 v 的动态范围差别很大（u≈0.2..1，v≈0..0.4），所以 v 上传时乘 3 拉开对比，
 * tint 里再除回去。这是**显示**上的处理，不影响状态。
 *
 * ## 种子
 *
 * `blob`（居中一团）/ `pattern`（手绘图案，复用图案编辑器）/
 * `random`（按密度撒点）。种子区的取值是标准的 `u=0.5, v=0.25`，其余 `u=1, v=0`。
 */

import { mulberry32 } from '../core/prng';
import { patternFromParam, stampCenteredInto } from './pattern-codec';
import { gridSizeOf } from './grid-dims';
import { SnapshotRing } from './sim-util';
import { bgColorVisible, bgModeParam } from './shader-lib';
import type { MessageKey } from '../i18n/locales';
import type { GeneratorDef, SimHandle } from './types';

/* --------------------------------------------------------------- 参数表 */

/** 网格尺寸约束：与参数表里 `width` / `height` 的 min / max / default 同源。 */
const RD_GRID = { min: 32, max: 384, fallback: 160 } as const;

/** 9 点 Laplacian 的系数。改成 5 点就必须同时改 Du/Dv。 */
const LAP_EDGE = 0.2;
const LAP_CORNER = 0.05;

/** v 上传到 8 位纹理时的放大倍数（见文件头）。tint 里要除回来。 */
export const RD_V_SCALE = 3;

export interface RdFk {
  f: number;
  k: number;
}

/**
 * (F, k) 预设。
 *
 * 来源是同一页里自洽的一组（toolsflare 的 RD 模拟器；相图本身出自
 * Pearson 1993《Complex Patterns in a Simple System》）。
 *
 * ⚠️ 业界对预设的**命名**有分歧：另一个来源把 0.0367/0.0649 也标成 “spots”、
 * 把 spots 记作 0.035/0.065。整表按同一页取，别逐行混来源。
 *
 * ⚠️ **这些数字是按另一套离散化标定的**（多半是 5 点 Laplacian）。相图的
 * **拓扑分区**跨实现是稳的，但具体坐标会有偏移。所以每一项都在本实现
 * （9 点模板 / Du=1 / Dv=0.5 / dt=1）上实测过「种下去长不长」：
 *
 * | 预设 | 实测（96²，团块 r=4） |
 * |---|---|
 * | coral | 长，3000 步 3560 格 |
 * | spots | 长，**且稳定**（600→3000 步恒为 277 格 —— 孤立的斑点不生长也不消失） |
 * | maze / stripes / mitosis / holes | 长，3000+ 格 |
 * | worms | 长但稀疏（600 步 261 格） |
 *
 * **`bubbles`（0.098/0.057）被删掉了**：实测在标准种子（u=0.5/v=0.25）下、
 * 任何团块尺寸、任何密度、跑到 3000 步都是**全空白**。它需要强得多的种子
 * （u=0.2/v=0.9 之类）才起得来 —— 一个「选了什么都不长」的预设比没有这个
 * 预设更坏。要恢复它，得先给它一套专属的种子强度。
 *
 * `holes` 取自 Pearson 分类的 β 区（不是同一页），数值可用（会生长），
 * 但**它到底长不长得像「洞」需要肉眼确认** —— 代码测不出「像不像」。
 */
export const RD_PRESETS: Record<string, RdFk> = {
  coral: { f: 0.0545, k: 0.062 },
  spots: { f: 0.0367, k: 0.0649 },
  maze: { f: 0.029, k: 0.057 },
  stripes: { f: 0.022, k: 0.051 },
  mitosis: { f: 0.0282, k: 0.0541 },
  worms: { f: 0.058, k: 0.065 },
  holes: { f: 0.039, k: 0.058 },
};

const SNAPSHOT_OPTS = {
  every: 32,
  cap: 64,
  clone: (v: { u: Float32Array; v: Float32Array }): { u: Float32Array; v: Float32Array } => ({
    u: v.u.slice(),
    v: v.v.slice(),
  }),
};

/* --------------------------------------------------------------- 演化 */

/**
 * 一步 Gray-Scott（**双缓冲**：读旧态、写新态、再交换）。
 *
 * 必须是双缓冲而不是就地更新：就地更新时「先算的格子」会污染「后算的格子」的
 * 邻居，结果依赖遍历顺序 —— 那种实现换个循环方向就得到不同的图，
 * `seek ≡ 顺序 step` 也就无从谈起。
 *
 * 它同时是**质量守恒的**：Laplacian 的权重和为 0（4×0.2 + 4×0.05 − 1 = 0），
 * 而反应项 −uv² 与 +uv² 相消。于是 `F = k = 0` 时 Σ(u+v) 逐帧不变 ——
 * 这条是能真正证明「step 写对了」的解析不变量，单测钉着它。
 */
export function rdStep(
  u: Float32Array,
  v: Float32Array,
  tmpU: Float32Array,
  tmpV: Float32Array,
  w: number,
  h: number,
  f: number,
  k: number,
  du: number,
  dv: number,
): void {
  const fk = f + k;
  for (let y = 0; y < h; y++) {
    const yU = (y === 0 ? h - 1 : y - 1) * w;
    const yD = (y === h - 1 ? 0 : y + 1) * w;
    const yM = y * w;
    for (let x = 0; x < w; x++) {
      const xL = x === 0 ? w - 1 : x - 1;
      const xR = x === w - 1 ? 0 : x + 1;

      const uu = u[yM + x]!;
      const vv = v[yM + x]!;

      const lu =
        LAP_EDGE * (u[yU + x]! + u[yM + xL]! + u[yM + xR]! + u[yD + x]!) +
        LAP_CORNER * (u[yU + xL]! + u[yU + xR]! + u[yD + xL]! + u[yD + xR]!) -
        uu;
      const lv =
        LAP_EDGE * (v[yU + x]! + v[yM + xL]! + v[yM + xR]! + v[yD + x]!) +
        LAP_CORNER * (v[yU + xL]! + v[yU + xR]! + v[yD + xL]! + v[yD + xR]!) -
        vv;

      const uvv = uu * vv * vv;
      tmpU[yM + x] = uu + (du * lu - uvv + f * (1 - uu));
      tmpV[yM + x] = vv + (dv * lv + uvv - fk * vv);
    }
  }
  u.set(tmpU);
  v.set(tmpV);
}

/* --------------------------------------------------------------- 初值 */

/** 种子格的取值（标准口径：u 被消耗、v 被注入）。 */
const SEED_U = 0.5;
const SEED_V = 0.25;

export interface RdInitOptions {
  w: number;
  h: number;
  seedMode: 'blob' | 'pattern' | 'random';
  pattern: string;
  seedSize: number;
  seedDensity: number;
  seed: number;
}

export function initRd(o: RdInitOptions): { u: Float32Array; v: Float32Array } {
  const { w, h } = o;
  const u = new Float32Array(w * h).fill(1);
  const v = new Float32Array(w * h);
  const plant = (i: number): void => {
    u[i] = SEED_U;
    v[i] = SEED_V;
  };

  if (o.seedMode === 'pattern') {
    const bm = patternFromParam(o.pattern);
    if (bm) {
      stampCenteredInto(w, h, bm, plant);
      return { u, v };
    }
    // 图案串坏了 / 空串 → 退回落差最小的团块，不报错、不空白
  }

  if (o.seedMode === 'random') {
    const rnd = mulberry32(o.seed);
    const d = Math.max(0, Math.min(1, o.seedDensity));
    // **只在一个居中的方形区域里撒**，不是整场撒。
    //
    // 实测（96²、600 步、8 个预设各跑一遍）：
    //   · 整场 × 10% → 8 个预设**全部**为空白。稀疏点几乎全是孤立单格，
    //     而孤立单格在 Gray-Scott 里必然死掉 —— 成簇才长得起来。
    //   · 整场 × 60% → 同样全部空白。整场饱和成 u=0.5/v=0.25 之后，
    //     没有「未消耗的介质」可长，整体崩掉。
    //   · 整场 × 30% → 只有 3 个预设活得下来。
    // 留出四周的 u=1/v=0 介质、只在中间撒噪声，三个密度都能出图 ——
    // 与生命游戏「中间 3/5 区域撒种」是同一个理由。
    const loX = Math.floor(w * 0.2);
    const hiX = Math.ceil(w * 0.8);
    const loY = Math.floor(h * 0.2);
    const hiY = Math.ceil(h * 0.8);
    for (let y = loY; y < hiY; y++) {
      for (let x = loX; x < hiX; x++) {
        if (rnd() < d) plant(y * w + x);
      }
    }
    return { u, v };
  }

  const r = Math.max(1, Math.round(o.seedSize));
  const cx = w >> 1;
  const cy = h >> 1;
  const r2 = r * r;
  for (let y = 0; y < h; y++) {
    const dy = y - cy;
    for (let x = 0; x < w; x++) {
      const dx = x - cx;
      if (dx * dx + dy * dy <= r2) plant(y * w + x);
    }
  }
  return { u, v };
}

/* --------------------------------------------------------------- 句柄 */

export function createReactionDiffusion(
  params: Record<string, number | string>,
  seed: number,
): SimHandle {
  const { w, h } = gridSizeOf(params, RD_GRID);
  const total = w * h;
  const stepsPerSec = Math.max(1, Number(params.rate) || 120);
  const preset = String(params.preset ?? 'coral');
  const fk = RD_PRESETS[preset];
  const f = fk ? fk.f : Number(params.feed ?? 0.0545);
  const k = fk ? fk.k : Number(params.kill ?? 0.062);
  const du = Math.max(0, Number(params.du ?? 1));
  const dv = Math.max(0, Number(params.dv ?? 0.5));

  const state = initRd({
    w,
    h,
    seedMode: params.seedMode === 'pattern' || params.seedMode === 'random' ? params.seedMode : 'blob',
    pattern: String(params.pattern ?? ''),
    seedSize: Number(params.seedSize) || 8,
    seedDensity: Number(params.seedDensity) || 0.4,
    seed,
  });
  let u = state.u;
  let v = state.v;
  const tmpU = new Float32Array(total);
  const tmpV = new Float32Array(total);

  let frame = 0;
  const snapshots = new SnapshotRing<{ u: Float32Array; v: Float32Array }>(SNAPSHOT_OPTS, { u, v });

  const out = new Uint8Array(total * 2);

  const stepTo = (target: number): void => {
    while (frame < target) {
      rdStep(u, v, tmpU, tmpV, w, h, f, k, du, dv);
      frame++;
      if (snapshots.shouldStore(frame)) snapshots.store(frame, { u, v });
    }
  };

  return {
    gridW: w,
    gridH: h,
    stepsPerSec,
    channels: 2,
    seek(simFrame: number): void {
      const target = Math.max(0, Math.floor(simFrame));
      if (target < frame) {
        const snap = snapshots.nearestAtOrBefore(target);
        // `.set` 而不是换引用：tmp 缓冲与 handle 闭包都指着这两条数组
        u.set(snap.value.u);
        v.set(snap.value.v);
        frame = snap.frame;
      }
      stepTo(target);
    },
    current(): Uint8Array {
      // 交错 RG：r = u，g = v × RD_V_SCALE（拉开 v 的窄动态范围，见文件头）
      for (let i = 0, j = 0; i < total; i++, j += 2) {
        const a = u[i]!;
        const b = v[i]! * RD_V_SCALE;
        out[j] = a <= 0 ? 0 : a >= 1 ? 255 : Math.round(a * 255);
        out[j + 1] = b <= 0 ? 0 : b >= 1 ? 255 : Math.round(b * 255);
      }
      return out;
    },
  };
}

/* --------------------------------------------------------------- 着色 */

/**
 * 自定义 tint。**不含头** —— `TINT_HEAD` 已经声明了 `u_tex` / `u_colorBg` /
 * `u_colorLive` / contain 适配，所以这里只写自己需要的与 `main`。
 *
 * 动的是**通道语义**：`u_tex.r` 是 u（≈0.2..1），`u_tex.g` 是 v×3。
 */
export const RD_TINT_FRAG = `
uniform int u_palette;    // 0 duotone · 1 chemical · 2 thermal · 3 mono
uniform float u_contrast; // 0..1：把 v 的中间调压成硬边
uniform int u_showU;      // 1 = 画 u 场（看「被消耗的底」）而不是 v 场

float rdHard(float t) {
  float kk = mix(1.0, 8.0, clamp(u_contrast, 0.0, 1.0));
  return smoothstep(0.5 - 0.5 / kk, 0.5 + 0.5 / kk, clamp(t, 0.0, 1.0));
}

void main() {
  vec2 uv = containUv(vUv);
  vec2 c = texture(u_tex, clamp(uv, 0.0, 1.0)).rg;
  float u = c.r;
  float v = c.g * (1.0 / ${RD_V_SCALE}.0);

  /* 覆盖度：这一格有多少「墨」。四种调色板共用同一个量 ——
     chemical 里 u 只改亮度（乘子），不参与「哪里算画到了」。 */
  float ink = u_showU == 1 ? rdHard(u) : rdHard(v * 2.6);

  vec3 col;
  /* 透明底要的是**全覆度的墨色**（不含底色），直通 alpha 下 rgb 不该再掺底色。 */
  vec3 pure;
  if (u_showU == 1) {
    col = mix(u_colorBg, u_colorLive, ink);
    pure = u_colorLive;
  } else if (u_palette == 1) {
    // chemical：活性区是亮色，被消耗的底变暗
    col = mix(u_colorBg, u_colorLive, ink) * (0.55 + 0.45 * u);
    pure = u_colorLive * (0.55 + 0.45 * u);
  } else if (u_palette == 2) {
    // thermal：低端沉黑、高端过曝成暖白（自成一体的色阶，与底色无关）
    pure = mix(vec3(0.02, 0.0, 0.05), vec3(1.0, 0.86, 0.42), ink * ink);
    col = pure;
  } else if (u_palette == 3) {
    // mono：纯灰阶 —— 给下游的通道错位 / 边缘类特效当底图
    pure = vec3(ink);
    col = pure;
  } else {
    col = mix(u_colorBg, u_colorLive, ink);
    pure = u_colorLive;
  }
  // contain 之外：透明底是空的，纯色底填底色（与共享 TINT_FRAG 的观感一致）
  float inside = insideUv(uv);
  if (u_bgMode == 1) outColor = vec4(pure, ink * inside);
  else outColor = vec4(mix(u_colorBg, col, inside), 1.0);
}`;

const PALETTES: Record<string, number> = { duotone: 0, chemical: 1, thermal: 2, mono: 3 };

/**
 * 预设选项**逐条写死文案键**，不用模板拼接。
 *
 * `labelKey` 的类型是 `MessageKey`（从语言表反推出来的字面量联合），
 * 拼接出来的字符串过不了它 —— 而能过 `as never` 的写法等于把这个编译期检查
 * 关掉，那正是「加参数忘了加文案」这类事故唯一的拦截点。
 */
const PRESET_OPTIONS: { labelKey: MessageKey; value: string }[] = [
  { labelKey: 'algo.reactionDiffusion.presetCoral', value: 'coral' },
  { labelKey: 'algo.reactionDiffusion.presetSpots', value: 'spots' },
  { labelKey: 'algo.reactionDiffusion.presetMaze', value: 'maze' },
  { labelKey: 'algo.reactionDiffusion.presetStripes', value: 'stripes' },
  { labelKey: 'algo.reactionDiffusion.presetMitosis', value: 'mitosis' },
  { labelKey: 'algo.reactionDiffusion.presetWorms', value: 'worms' },
  { labelKey: 'algo.reactionDiffusion.presetHoles', value: 'holes' },
  { labelKey: 'algo.reactionDiffusion.presetCustom', value: 'custom' },
];

export const reactionDiffusionDef: GeneratorDef = {
  id: 'reaction-diffusion',
  nameKey: 'algo.reactionDiffusion',
  kind: 'sim',
  // 只影响着色与播放的键：改它们不重建模拟（否则跑了几千步的图案瞬间丢失）
  volatile: ['rate', 'colorBg', 'colorLive', 'palette', 'contrast', 'showU', 'bgMode'],
  params: [
    {
      key: 'preset',
      labelKey: 'algo.reactionDiffusion.preset',
      type: 'select',
      defaultValue: 'coral',
      options: PRESET_OPTIONS,
    },
    {
      key: 'feed',
      labelKey: 'algo.reactionDiffusion.feed',
      type: 'range',
      min: 0,
      max: 0.12,
      step: 0.0001,
      defaultValue: 0.0545,
      visibleWhen: (v) => v.preset === 'custom',
    },
    {
      key: 'kill',
      labelKey: 'algo.reactionDiffusion.kill',
      type: 'range',
      min: 0.03,
      max: 0.075,
      step: 0.0001,
      defaultValue: 0.062,
      visibleWhen: (v) => v.preset === 'custom',
    },
    { key: 'du', labelKey: 'algo.reactionDiffusion.du', type: 'range', min: 0.5, max: 1.2, step: 0.01, defaultValue: 1 },
    { key: 'dv', labelKey: 'algo.reactionDiffusion.dv', type: 'range', min: 0.2, max: 0.7, step: 0.01, defaultValue: 0.5 },
    {
      key: 'width',
      labelKey: 'algo.simGrid.width',
      type: 'range',
      min: 32,
      max: 384,
      step: 16,
      defaultValue: 160,
    },
    {
      key: 'height',
      labelKey: 'algo.simGrid.height',
      type: 'range',
      min: 32,
      max: 384,
      step: 16,
      defaultValue: 160,
    },
    {
      key: 'seedMode',
      labelKey: 'algo.reactionDiffusion.seedMode',
      type: 'select',
      defaultValue: 'blob',
      options: [
        { labelKey: 'algo.reactionDiffusion.seedBlob', value: 'blob' },
        { labelKey: 'algo.reactionDiffusion.seedPattern', value: 'pattern' },
        { labelKey: 'algo.reactionDiffusion.seedRandom', value: 'random' },
      ],
    },
    {
      key: 'pattern',
      labelKey: 'algo.reactionDiffusion.pattern',
      type: 'pattern',
      defaultValue: '',
      editorSize: 32,
      mode: '2d',
      visibleWhen: (v) => v.seedMode === 'pattern',
    },
    {
      key: 'seedSize',
      labelKey: 'algo.reactionDiffusion.seedSize',
      type: 'range',
      min: 2,
      max: 48,
      step: 1,
      // 6 而不是更大的团：实测**大多数预设要小的种子**才长得起来 ——
      // spots 在 r=4 时得到稳定的孤立斑点，r≥8 就整体崩成一片。
      defaultValue: 6,
      visibleWhen: (v) => v.seedMode === 'blob',
    },
    {
      key: 'seedDensity',
      labelKey: 'algo.reactionDiffusion.seedDensity',
      type: 'range',
      min: 0.05,
      max: 0.6,
      step: 0.01,
      // 40% 而不是「看起来更像噪声」的 15%：孤立单格在 Gray-Scott 里**必然死掉**，
      // 只有成簇的种子才长得起来。低于约 0.25 时随机会得到一张空图。
      defaultValue: 0.4,
      visibleWhen: (v) => v.seedMode === 'random',
    },
    // 上限 240：160² 下每步约 0.35 ms，240/30 ≈ 8 步/帧 ≈ 2.8 ms。
    // 网格拉到 384²（约 5.8 倍）时要自己把速度降下来 —— 静态参数表表达不了
    // 「速度与网格的乘积」，这是本生成器的已知限制。
    { key: 'rate', labelKey: 'algo.reactionDiffusion.speed', type: 'range', min: 15, max: 240, step: 5, defaultValue: 120 },
    {
      key: 'colorBg',
      labelKey: 'algo.reactionDiffusion.colorBg',
      type: 'color',
      defaultValue: '#04060a',
      visibleWhen: bgColorVisible,
    },
    { key: 'colorLive', labelKey: 'algo.reactionDiffusion.colorLive', type: 'color', defaultValue: '#ffb35c' },
    {
      key: 'palette',
      labelKey: 'algo.reactionDiffusion.palette',
      type: 'select',
      defaultValue: 'duotone',
      options: [
        { labelKey: 'algo.reactionDiffusion.palDuotone', value: 'duotone' },
        { labelKey: 'algo.reactionDiffusion.palChemical', value: 'chemical' },
        { labelKey: 'algo.reactionDiffusion.palThermal', value: 'thermal' },
        { labelKey: 'algo.reactionDiffusion.palMono', value: 'mono' },
      ],
    },
    { key: 'contrast', labelKey: 'algo.reactionDiffusion.contrast', type: 'range', min: 0, max: 1, step: 0.01, defaultValue: 0.35 },
    { key: 'showU', labelKey: 'algo.reactionDiffusion.showU', type: 'checkbox', defaultValue: 0 },
    bgModeParam(),
  ],
  create: createReactionDiffusion,
  tintFragment: RD_TINT_FRAG,
  setTintUniforms: (gl, l, v) => {
    const set1i = (name: string, value: number): void => {
      const loc = l[name];
      if (loc) gl.uniform1i(loc, Math.round(value));
    };
    const set1f = (name: string, value: number): void => {
      const loc = l[name];
      if (loc) gl.uniform1f(loc, value);
    };
    // 只派发自己的 —— u_colorBg / u_colorLive / u_srcAspect / u_outAspect
    // 由 AlgoRuntime 的 sim 分支统一写，重复写只会漂。
    set1i('u_palette', PALETTES[String(v.palette)] ?? 0);
    set1f('u_contrast', Number(v.contrast ?? 0.35));
    set1i('u_showU', Number(v.showU ?? 0) !== 0 ? 1 : 0);
  },
};

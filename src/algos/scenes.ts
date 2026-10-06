/**
 * scenes.ts — 程序化场景家族（5 个 `realtime` 生成器）。
 *
 * 移植自 angel-echo `js/scenes.js`（同作者内部移植，见 CREDITS.md）。
 * 上游把它们与数学生成器一起放在一个 `SHADERS` 表里供编排层挑；artmatic 的
 * 模型是**一个生成器 = 一个 def**，所以每个场景一个 def —— 但共用同一份
 * `SCENE_GLSL`（噪声库 + 音频特征 uniform 块），因此收在一个文件里，
 * 与 `scenes.js` 的组织方式对齐。
 *
 * ## 三处**刻意的**移植差异
 *
 * 1. **id 一律带 `scene-` 前缀。** 特效注册表里已经有 `tunnel`
 *    （openmosh Phase 1c），另有 `kino-datamosh` / `audio-bars` / `flow-contours`
 *    这些近似名。两张注册表是独立的、i18n 键也不同域（`fx.*` vs `algo.*`），
 *    所以技术上不冲突 —— 但试炼场左栏（源）与右栏（特效）同时出现两个
 *    「隧道」是纯粹的误导。前缀一次性消除全部歧义。
 * 2. **编排量变成参数。** 上游的 `uDensity` / `uWarp` / `uTone` / `uCut` /
 *    `uLift` / `uProg` 来自 `plan.js` 的段落表（硬编码的一部片）。
 *    artmatic 的模型是用户自己编排 → 它们是普通 range 参数，**能打关键帧**。
 * 3. **不建 uSpec。** `bars` 场景通篇是整轨频谱图的采样，不建 uSpec 的话它
 *    只剩「当前帧的柱状图」，而那正是已有效果 `audio-bars` 已有的东西 ——
 *    所以**本轮不做 `bars`**（见 `.workbuddy/plans/angel-echo-port-plan.md`）。
 *    `datamosh` 里对 `specAt` 的单点采样已改成「当前帧频段能量 × 单元哈希」，
 *    保留了「信号强度驱动栅格亮度」这层意思。
 *
 * ## 2026-10 合并：`pulse` + `tunnel` + `dissolve` → `ripple`
 *
 * 上游这三个是三条独立的 shader，但**肉眼上它们是同一件事**：一堆同心圆
 * 涟漪。逐行看也确实如此 —— 三条的主项都是 `f(r)` 的环：
 *
 * ```
 * pulse     ridge(r - age·0.34, w)          等距环，半径由 onset 年龄给
 * tunnel    pow(sin((-log r)·freq·π), 10)   对数环距（外圈不混叠）
 * dissolve  pow(sin(r·34 - t·1.6), 26)      等距环 + 噪声啃噬
 * ```
 *
 * 差别只在**环距是线性还是对数**、**环由什么驱动**、**有没有辐条 / 噪点**。
 * 所以合并成一条 `scene-ripple`，把这些差别做成参数：`spacing`（线性↔对数）
 * × `drive`（持续↔击发）× `sharp` / `spokes` / `grain` / `falloff`。
 * 三个原来的观感都在参数空间里，而且中间地带是新的。
 *
 * ## 噪声库的命名
 *
 * 复用 `effects/shader-def.ts` 里**已登记**的 `FBM6_GLSL` / `MATH_GLSL`
 * （就是上游的 `LIB`），所以场景体里写 `fbm6(...)` 而不是上游的 `fbm(...)`。
 * 同一个函数、同一份实现，只是那个文件里叫这个名字。
 */

import {
  SCENE_GLSL,
  arrangementParam,
  intResParam,
  sceneUniforms,
} from './shader-lib';
import type { MessageKey } from '../i18n/locales';
import type { GeneratorDef } from './types';

/* ---------------------------------------------------------------- ripple */

/**
 * 同心涟漪。合并了上游的 `pulse` / `tunnel` / `dissolve` 三条（见文件头）。
 *
 * `u_spacing` 只在**持续环**那一支上生效：击发环是「波前从中心以恒定速度
 * 推开」，在二维里天然等距，硬套对数坐标只会让它朝内收缩。两支在
 * `u_drive` 中间叠加 —— 那是有意的「持续底纹 + 击发高光」，不是需要消除的
 * 过渡态。
 */
const RIPPLE_BODY = `
uniform float u_spacing;   // 0 等距环 .. 1 对数环距
uniform float u_drive;     // 0 持续环 .. 1 击发环
uniform float u_sharp;     // 环的锐度
uniform float u_spokes;    // 角向辐条数（0 = 关）
uniform float u_grain;     // 噪声溶解量
uniform float u_falloff;   // 径向衰减

void main() {
  vec2 uv = vUv;
  vec2 p = (uv - 0.5) * vec2(u_aspect, 1.0);
  float r = max(length(p), 1e-4);
  float a = atan(p.y, p.x);

  /* 径向坐标。「r 的 p 次幂」：p = 1 时环距等分（水面涟漪），p < 1 时坐标在
     圆心附近变陡 ⇒ **同样的 z 间隔对应的半径间隔更小** ⇒ 环往圆心挤（隧道透视）。

     ⚠️ 这里**不能**写成「把两种坐标线性混合」的形式（例如
     mix(r, 1.0 - log(r)*0.32, spacing)）—— 第一版就是那么写的，于是 z(r) 在
     r ≈ 0.18 处有个极小值（线性项 r 递增、对数项 −log r 递减，两者方向相反），
     **坐标非单调**，圆心附近整片被折回去 ⇒ 默认参数下整幅画只剩两圈。
     实测就是这么发现的：批量导出的缩略图里只有 2 根粗环，而不是涟漪。
     幂次族天然单调、两端都钉在 0 与 1，是这里唯一不需要额外论证的选择。 */
  float z = pow(max(r, 1e-4), mix(1.0, 0.35, u_spacing));
  float travel = u_travel + u_time * 0.15;

  /* --- 持续环 --------------------------------------------------------- */
  float freq = mix(4.0, 34.0, u_density);
  float s = sin((z * freq - travel) * 3.14159);
  float rings = pow(max(s, 0.0), mix(3.0, 60.0, u_sharp));

  /* --- 击发环：每个 onset 放出一圈，越老越大越淡 ----------------------- */
  float pulses = 0.0;
  for (int i = 0; i < 4; i++) {
    float age = u_ages[i];
    float live = exp(-age * 0.85);
    float rad = age * 0.34;
    float w = 0.006 + age * 0.010;
    pulses += live * ridge(r - rad, w) * (1.0 - float(i) * 0.18);
  }

  float col = rings * (1.0 - u_drive) + pulses * u_drive * (1.5 + u_kick * 2.0);

  /* --- 角向辐条：把同心圆切成有方向的轨道 ------------------------------
     指数给到 60 才够细。22（上游 tunnel 的取值）在 480 高下每根条约有
     10 个像素宽，六根合起来读成一片光晕而不是「轨道」—— 上游之所以看着
     还行，是因为它把辐条乘了 wall * depth，条在中段本来就被压得很暗。 */
  if (u_spokes >= 0.5) {
    float wob = sin(z * 0.30 + travel * 0.10) * 1.4 * u_warp;
    float rails = sin(a * u_spokes + wob);
    col += pow(max(rails, 0.0), 60.0) * 0.34 * (0.5 + u_tone);
  }

  /* --- 径向衰减：隧道该向远处打开，不是朝观众打开 ---------------------- */
  col *= mix(1.3, 0.30, u_falloff) * exp(-max(z, 0.0) * mix(0.25, 1.2, u_falloff));

  /* --- 噪声溶解 --------------------------------------------------------
     必须是**成块的斑点**，绝不是一片灰。两个陷阱：高频采样的 fbm 会退化成
     逐像素噪声，而逐像素噪声一旦进了回声反馈环，它不会读成静电，会平均成
     一片平灰。场保持粗、阈值切得硬，它才一直是可读的。 */
  if (u_grain > 0.001) {
    float n = fbm6(uv * 30.0 + floor(u_time * 6.0) * 3.7);
    float speck = smoothstep(0.90 - u_grain * 0.55, 1.06 - u_grain * 0.45, n);
    col *= 1.0 - u_grain * speck * 0.9;
    col += speck * u_grain * 0.5;
  }

  col *= (0.85 + u_rms * 0.9) * (0.6 + u_tone * 0.9);
  col += u_hit * 0.15 * (1.0 - u_drive);
  col += u_cut * 0.35;
  col *= edge(uv, 0.05);
  outColor = vec4(vec3(max(col, 0.0)), 1.0);
}`;

/* ------------------------------------------------------------------ field */

const FIELD_BODY = `
float dotLayer(vec2 uv, float depth, float scale) {
  vec2 g = uv * scale * vec2(u_aspect, 1.0);
  g.y += u_travel * 0.12 * depth;
  vec2 id = floor(g);
  vec2 f = fract(g) - 0.5;
  float h = hash21(id + depth * 17.0);
  vec2 off = (vec2(hash21(id + 3.1), hash21(id + 7.7)) - 0.5) * 0.7;
  float d = length(f - off);
  float size = 0.02 + 0.05 * hash21(id + 11.3) + u_kick * 0.05;
  float dot_ = ridge(d, size) * step(0.62, h);
  return dot_ * (0.4 + 0.6 * hash21(id + 23.0));
}

void main() {
  vec2 uv = vUv;
  float col = 0.0;
  col += dotLayer(uv, 0.25, 14.0) * 0.55;
  col += dotLayer(uv, 0.60, 22.0) * 0.75;
  col += dotLayer(uv, 1.00, 34.0) * 1.00;

  /* 只有低频砸下来时才出现的一条地平线 */
  float horizon = exp(-abs(uv.y - 0.5) * 140.0) * u_sub * 0.75;
  col += horizon;

  col *= (0.30 + u_rms * 1.1);
  col += u_hit * 0.04;
  col *= edge(uv, 0.10);
  outColor = vec4(vec3(max(col, 0.0)), 1.0);
}`;

/* --------------------------------------------------------------- datamosh */

const DATAMOSH_BODY = `
void main() {
  vec2 uv = vUv;
  float t = u_time;

  /* --- 块位移 --- */
  float blocks = mix(24.0, 64.0, u_density);
  vec2 g = vec2(blocks * u_aspect, blocks);
  vec2 cell = floor(uv * g);
  vec2 h = vec2(hash21(cell + 1.7), hash21(cell + 9.3));

  float trigger = step(1.0 - (0.25 + u_hit * 1.4 + u_flux * 0.9),
                       hash21(cell + floor(t * 5.0) * 0.71));
  vec2 shift = (h - 0.5) * vec2(0.14, 0.05) * trigger * u_warp;
  uv += shift;

  /* --- 横扫画面的水平撕线 ---
     注意全程很低的**重播种率**。每帧重播（floor(t*30)）就是 30 Hz 全屏频闪：
     既毁掉可读性，看着也真的难受。随机一律 5–10 Hz 重播、并且被包络门控，
     于是它**跟着音乐**变，而不是与音乐各跑各的。 */
  float tear = sin(uv.y * 3.0 + t * 0.6);
  float band = step(0.985, hash11(floor(uv.y * 90.0) + floor(t * 9.0)));
  uv.x += band * (hash11(floor(uv.y * 90.0)) - 0.5) * 0.25 * (u_hit + u_flux);

  /* --- 栅格 ---
     两条踩出来的规矩。

     覆盖率必须**低**。故障只有对着**没坏**的东西才读得出是故障；把整幅画
     均匀弄坏，它就不再表达任何东西，只是平均成一片白墙。

     损伤必须**区域相干**。逐格随机明暗与静电噪声无从分辨 —— 那是死频道
     发出的同一种白噪。把亮的格子用一个大尺度场门控，才能同时得到「完好的
     区域」与「被摧毁的区域」并存，那才是读取失败的样子。 */
  vec2 rg = vec2(46.0 * u_aspect, 26.0);
  vec2 rid = floor(uv * rg);
  vec2 rf = fract(uv * rg);
  /* 区域掩码是**漂移**的，不是重播种的。重播种的大尺度掩码会以重播率
     （这里 2 Hz）整块开关，读起来像画面在眨眼。漂移的场一整个小节里变化
     同样多，但从不突变。 */
  float region = fbm6(uv * 2.6 + vec2(t * 0.055, -t * 0.038));
  float hh = hash21(rid * 1.37 + floor(t * 2.5) * 0.211);
  float live = step(0.90 - u_hit * 0.30, hh) * smoothstep(0.44, 0.70, region);
  /* 上游在这里采整轨频谱图（uSpec）任意时刻的真实频谱。本项目不建 uSpec
     （见文件头），改成「当前帧的高频 / 通量能量 × 单元自身哈希」——
     「信号强度驱动栅格亮度」保留，丢掉的是「每格读的是历史上某一刻的频谱」。 */
  float amp = pow(clamp(u_high * 0.75 + u_flux * 0.55, 0.0, 1.0), 0.70)
            * (0.35 + 0.65 * hash21(rid * 0.0413 + rid.y * 0.0091));
  float hot = step(0.40, amp);
  float inset = step(0.10, rf.x) * step(rf.x, 0.90) * step(0.12, rf.y) * step(rf.y, 0.88);
  float raster = live * hot * inset * 1.6;

  /* 少数块整块炸白 —— 但只在音乐砸下来时，于是它是标点，不是闪烁 */
  float white = step(0.992, hash21(rid + floor(t * 4.0) * 0.37)) *
                smoothstep(0.06, 0.30, u_hit + u_bar * 0.5);

  float col = raster + white * 1.3;

  /* 扫描压低：整行丢失信息的行 */
  col *= 1.0 - band * 0.62;
  col += band * 0.35;

  col *= (0.55 + u_rms * 1.0) * (0.55 + u_tone * 0.7);
  col += u_hit * 0.10;
  col *= edge(uv, 0.04);
  outColor = vec4(vec3(max(col, 0.0)), 1.0);
}`;

/* ------------------------------------------------------------------- flow */

const FLOW_BODY = `
void main() {
  vec2 uv = vUv;
  vec2 p = (uv - 0.5) * vec2(u_aspect, 1.0) * 2.2;

  float t = u_time * 0.16;
  float warp = 0.35 + u_warp * 0.85 + u_hit * 0.5;

  vec2 q = vec2(fbm6(p + t * 0.7), fbm6(p + vec2(5.2, 1.3) - t * 0.5));
  vec2 r = vec2(fbm6(p + 3.0 * q + vec2(1.7, 9.2) + t * 1.3),
                fbm6(p + 3.0 * q + vec2(8.3, 2.8) - t * 1.1));
  float v = fbm6(p + warp * 3.4 * r);

  /* 两族等值线：粗的载质量，细的载细节。两者都是**线**，都不是填充 ——
     画面保持黑，所有亮度都活在墨里。改成填充会得到一片灰墙，
     再多的调色也救不回来。 */
  float b1 = mix(4.0, 7.0, u_density);
  float b2 = mix(11.0, 22.0, u_density);
  float l1 = abs(fract(v * b1 + u_travel * 0.030) - 0.5) * 2.0;
  float l2 = abs(fract(v * b2 + u_travel * 0.055) - 0.5) * 2.0;
  float ink1 = pow(1.0 - smoothstep(0.0, 0.26, l1), 3.0);
  float ink2 = pow(1.0 - smoothstep(0.0, 0.13, l2), 2.2);

  float col = ink1 * 0.95 + ink2 * 0.28 * (0.30 + u_rms);
  col += ink1 * (u_hit * 0.55 + u_bar * 0.20);
  col *= (0.60 + u_rms * 0.85) * (0.55 + u_tone * 0.75);

  /* 旋律显示成一条竖着的脉络，不是一片雾 */
  col += exp(-abs(uv.x - 0.5) * 15.0) * u_high * 0.22;
  col *= edge(uv, 0.07);
  outColor = vec4(vec3(max(col, 0.0)), 1.0);
}`;

/* ---------------------------------------------------------------- strands */

const STRANDS_BODY = `
void main() {
  vec2 uv = vUv;
  float t = u_time;

  float col = 0.0;
  const int N = 14;

  for (int i = 0; i < N; i++) {
    float fi = float(i);
    float h = hash11(fi * 7.13 + u_seed);
    float h2 = hash11(fi * 3.77 + 4.0);

    /* 每根丝按自己缓慢的漂移横向滑动 */
    float cx = 0.5 + (hash11(fi * 1.31) - 0.5) * 1.5
             + sin(t * (0.08 + h * 0.12) + fi) * 0.12 * u_warp;

    /* 它的位移画在竖直方向上 */
    float y = (uv.y - 0.5) * 2.0;
    float amp = (0.006 + 0.05 * h2) * (0.4 + u_high * 2.2 + u_hit * 1.4);
    float wave = sin(y * (6.0 + fi * 0.7) + t * (1.1 + h * 2.0)) * amp;
    wave += sin(y * (13.0 + fi) - t * 2.3) * amp * 0.4;

    float d = abs((uv.x - cx) * u_aspect - wave);
    float w = 0.0016 + 0.004 * h2;

    /* 弦在「即将被重新拨响」的地方最亮 */
    float life = 0.5 + 0.5 * sin(t * 0.5 + fi * 2.1);
    col += ridge(d, w) * (0.35 + life * 0.9) * (1.0 - 0.5 * abs(y));
  }

  col *= (0.4 + u_rms * 1.5) * (0.45 + u_tone);
  col += u_lift * 0.35;
  col += exp(-abs(uv.x - 0.5) * 6.0) * 0.12 * u_high;
  col *= edge(uv, 0.06);
  outColor = vec4(vec3(max(col, 0.0)), 1.0);
}`;

/* ------------------------------------------------------------------ 注册 */

interface SceneSpec {
  id: string;
  nameKey: MessageKey;
  body: string;
  params: GeneratorDef['params'];
  /** 该场景私有的 range 参数键（共享那套之外还要派发的）。 */
  extra?: readonly string[];
}

const SCENES: SceneSpec[] = [
  {
    id: 'scene-ripple',
    nameKey: 'algo.scene.ripple',
    body: RIPPLE_BODY,
    extra: ['spacing', 'drive', 'sharp', 'spokes', 'grain', 'falloff'],
    params: [
      arrangementParam('density', 0.5),
      arrangementParam('warp', 0.3),
      arrangementParam('tone', 0.5),
      { key: 'spacing', labelKey: 'algo.ripple.spacing', type: 'range', min: 0, max: 1, step: 0.01, defaultValue: 0.25 },
      { key: 'drive', labelKey: 'algo.ripple.drive', type: 'range', min: 0, max: 1, step: 0.01, defaultValue: 0 },
      { key: 'sharp', labelKey: 'algo.ripple.sharp', type: 'range', min: 0, max: 1, step: 0.01, defaultValue: 0.62 },
      { key: 'spokes', labelKey: 'algo.ripple.spokes', type: 'range', min: 0, max: 12, step: 1, defaultValue: 0 },
      { key: 'grain', labelKey: 'algo.ripple.grain', type: 'range', min: 0, max: 1, step: 0.01, defaultValue: 0.12 },
      { key: 'falloff', labelKey: 'algo.ripple.falloff', type: 'range', min: 0, max: 1, step: 0.01, defaultValue: 0.4 },
      intResParam(),
    ],
  },
  {
    id: 'scene-field',
    nameKey: 'algo.scene.field',
    body: FIELD_BODY,
    params: [
      arrangementParam('density', 0.5),
      arrangementParam('warp', 0.4),
      arrangementParam('tone', 0.5),
      intResParam(),
    ],
  },
  {
    id: 'scene-datamosh',
    nameKey: 'algo.scene.datamosh',
    body: DATAMOSH_BODY,
    params: [
      arrangementParam('density', 0.5),
      arrangementParam('warp', 0.4),
      arrangementParam('tone', 0.5),
      intResParam(),
    ],
  },
  {
    id: 'scene-flow',
    nameKey: 'algo.scene.flow',
    body: FLOW_BODY,
    params: [
      arrangementParam('density', 0.5),
      arrangementParam('warp', 0.4),
      arrangementParam('tone', 0.5),
      intResParam(),
    ],
  },
  {
    id: 'scene-strands',
    nameKey: 'algo.scene.strands',
    body: STRANDS_BODY,
    params: [
      arrangementParam('density', 0.5),
      arrangementParam('warp', 0.35),
      arrangementParam('tone', 0.5),
      arrangementParam('lift', 0),
      intResParam(),
    ],
  },
];

/**
 * 五个场景 def。`setUniforms` 全部走共用的 `sceneUniforms(extra)` ——
 * 音频特征 + 闭式冲量 + 编排参数一套派发，场景之间没有别的私有 uniform 机制。
 */
export const sceneDefs: GeneratorDef[] = SCENES.map((s) => ({
  id: s.id,
  nameKey: s.nameKey,
  kind: 'realtime',
  fragment: SCENE_GLSL + s.body,
  params: s.params,
  setUniforms: sceneUniforms(s.extra ?? []),
}));

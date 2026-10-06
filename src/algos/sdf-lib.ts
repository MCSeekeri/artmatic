/**
 * sdf-lib.ts — 3D 光线步进内核：相机 + 步进 + 法线 + 光照 + 雾。
 *
 * 与 `shader-lib.ts` 的 `SCENE_GLSL` 同构：**一段共享 GLSL + 一份共用的
 * uniform 派发 + 一组共用参数**。各 3D 生成器只写自己的 SDF 与 `main`，
 * 其余全部复用 —— 四个 3D 物体各写一遍相机与光照，迟早会漂。
 *
 * ## 为什么是模板函数而不是 `#define ART_SD`
 *
 * GLSL 里没法把函数当参数传，所以「共享的步进循环」必然要知道该调哪个 SDF。
 * 两条路：文本宏（`#define ART_SD(p) sdX(p)`）或**字符串模板**（`sdfKernel('sdX')`
 * 直接把名字代进去）。选后者：宏还要配一句前向声明（`float sdX(vec3);` 必须
 * 出现在宏的**使用点**之前），两处得同步；模板只有一个真源，且拼错名字
 * 是编译期错误（函数没有声明）。
 *
 * ## 与 `sim` / `bake` 的关系
 *
 * 这个内核只管 `realtime`。3D 分形**必须是 realtime**：它们的成本全在 GPU 上，
 * 逐帧实时算与「跳帧缓存」的差别只是画质 —— 而跳帧缓存会破坏确定性（硬约束 1.1）。
 *
 * ## 性能口径（实测，见 AGENTS §5.6）
 *
 * 720p、70 步、5 级递归的 Menger 海绵测出来比纯色只贵 **约 3 ms/帧**
 * —— 3D 光线步进在这个尺度上是便宜的，**不需要为它降 intRes 默认**。
 * 真正要盯的是 `depth`/`iterations`（每步的 SDF 成本）而不是像素数。
 */

import { colorVec3 } from '../core/color';
import { intResParam, type AlgoSetUniforms, type AlgoUniformCtx } from './shader-lib';
import type { SelectParam, RangeParam, ParamDef } from '../effects/types';

/**
 * 步进循环的**编译期**上界。
 *
 * GLSL ES 的循环在不少实现上仍偏好常量界（动态界要靠驱动支持得很好），
 * 而且常量界 + `break` 与动态界的行为完全一致。`u_steps` 是运行期参数，
 * 超不过这个数（`sdfQualityParams` 的 `max` 与它对齐）。
 */
const MAX_MARCH_STEPS = 160;

/**
 * 调色板值的映射（**唯一定义**：`sdfUniforms` 与单测都读它）。
 *
 * ⚠️ **`dual` 是一个不在选项里的别名**，指向 `height`。它是 Wave 4 之前
 * `menger` 的选项名（`single` / `dual`），而参数值是按字符串存进工程 JSON 的：
 * 不留这个别名，老工程里的 `palette: 'dual'` 会落到 `?? 0` —— **静默退回单色**，
 * 不报错、只是画面变了。
 */
export const SDF_PALETTES: Record<string, number> = {
  single: 0,
  height: 1,
  normal: 2,
  dual: 1, // 旧工程别名，不是选项
};

/**
 * 造共享内核的 GLSL 代码块。`sd` 是这个生成器的 SDF 函数名。
 *
 * 提供（全部读下面的共用 uniform，生成器不必传参）：
 *   `sdfCam(eye, target)`  → mat3 相机基
 *   `sdfRay(uv, aspect, cam)` → 归一化的世界方向
 *   `sdfMarch(ro, rd)`     → 命中距离；**没命中返回负值**
 *   `sdfNormal(p, e)`      → 法线（四面体差分，4 次 SDF）
 *   `sdfAO(p, n)`          → 采样式环境遮蔽
 *   `sdfTint(p, n)`        → 调色板
 *   `sdfShade(p, n, rd, dist, albedo)` → 最终颜色（含雾与增益）
 */
export function sdfKernel(sd: string): string {
  return `
/*
 * **前向声明**。内核里的步进 / 法线 / 遮蔽都要调这个 SDF，而它的定义在
 * 生成器自己的那一半（拼在后面）—— GLSL 要求「先声明后使用」，少了这一行
 * 就是 \`no matching overloaded function found\`，而报错行号指向内核里那句调用，
 * 看起来像内核写错了。
 *
 * 这也是模板方案唯一的坑：名字代进去了，但**函数体还没见过**。
 */
float ${sd}(vec3 p);

uniform int   u_steps;     // 步进上限（编译期上界 ${MAX_MARCH_STEPS} 之内的运行期值）
uniform float u_maxDist;   // 步进的最远距离
uniform float u_stepScale; // 每步走多长（DE 的折扣系数）
uniform float u_eps;       // 命中判据的基准（随行进距离放宽，见 sdfMarch）
uniform float u_fov;       // 视场：越小越像长焦
uniform vec3  u_light;     // 主光方向（单位向量，由 az/el 两个角度换算）
uniform float u_gain;      // 总曝光
uniform float u_fog;       // 雾浓度（0 = 关）
uniform float u_ao;        // 采样式环境遮蔽的强度（0 = 关）
uniform int   u_palette;   // 0 单色 · 1 按高度双色 · 2 按法线双色
uniform vec3  u_color;
uniform vec3  u_colorB;
uniform vec3  u_bg;

/** 相机基。列 = 右 / 上 / 前，所以 \`cam * vec3(x, y, 1)\` 就是视线方向。 */
mat3 sdfCam(vec3 eye, vec3 target) {
  vec3 f = normalize(target - eye);
  // 上去向量固定用 +Y；视线与 Y 平行时右手系退化，给一个任意但合法的右向量
  // （不处理的话 \`normalize\` 传入零向量，驱动会告警说结果未定义）
  vec3 r = cross(vec3(0.0, 1.0, 0.0), f);
  r = dot(r, r) > 1e-8 ? normalize(r) : vec3(1.0, 0.0, 0.0);
  return mat3(r, cross(f, r), f);
}

/** 由 uv 与相机基造世界方向。fov 越小视野越窄。 */
vec3 sdfRay(vec2 uv, float aspect, mat3 cam) {
  vec2 sc = (uv - 0.5) * vec2(aspect, 1.0);
  return normalize(cam * vec3(sc * u_fov, 1.0));
}

/**
 * 轨道相机：绕原点公转 + 推近，看向原点。三个 3D 分形要的就是这个，
 * 所以连「eye 怎么摆」也共用一份 —— 各写一遍的话，某个分形的 pitch 符号
 * 反了就是「相机从地底下往上看」，不报错也不好查。
 */
mat3 sdfOrbitCam(float yaw, float pitch, float dist, out vec3 eye) {
  float cp = cos(pitch);
  eye = vec3(sin(yaw) * cp, sin(pitch), cos(yaw) * cp) * dist;
  return sdfCam(eye, vec3(0.0));
}

/**
 * 光线步进。**命中返回行进距离，没命中返回负值**（哨兵值而不是 out 参数：
 * 调用点 \`if (hit > 0.0)\` 比 \`if (ok > 0.5)\` 好读）。
 *
 * 判据随行进距离放宽（\`u_eps * (1 + t * 0.5)\`）：远处一个像素覆盖的
 * 物体尺度本来就大，固定阈值要么近处过松（噪点）要么远处过紧（穿透）。
 */
float sdfMarch(vec3 ro, vec3 rd) {
  float tt = 0.0;
  for (int i = 0; i < ${MAX_MARCH_STEPS}; i++) {
    if (i >= u_steps) break;
    float d = ${sd}(ro + rd * tt);
    if (d < u_eps * (1.0 + tt * 0.5)) return tt;
    // ⚠️ 折扣系数不是「1 最好」：分形的 DE 多是**过估**（Mandelbox 尤其明显），
    // 按 1.0 走会在结构内部直接穿过表面，表现为一片噪点。0.9 对 Menger 够用，
    // 而 Mandelbox 要 0.6~0.7 才读得出形体。
    tt += d * u_stepScale;
    if (tt > u_maxDist) break;
  }
  return -1.0;
}

/**
 * 法线：**四面体差分**（4 次 SDF）而不是六面（6 次）。
 *
 * 分形 SDF 的每次求值都贵（Mandelbulb 一次要迭代 8 回），法线从 6 次降到
 * 4 次是每像素实打实的 1/3。精度足够 —— 这个技巧是 Íñigo Quílez 的。
 */
vec3 sdfNormal(vec3 p, float e) {
  const vec2 k = vec2(1.0, -1.0);
  return normalize(
    k.xyy * ${sd}(p + k.xyy * e) +
    k.yyx * ${sd}(p + k.yyx * e) +
    k.yxy * ${sd}(p + k.yxy * e) +
    k.xxx * ${sd}(p + k.xxx * e));
}

/**
 * 采样式环境遮蔽：沿法线走几步，看 SDF 比「空场」低多少。
 *
 * 这是 3D 分形**读得出体积**的关键：只靠 Lambert，Mandelbulb 的千层褶皱
 * 会糊成一片；有了遮蔽，凹处自然变暗，结构就分开了。
 */
float sdfAO(vec3 p, vec3 n) {
  float occ = 0.0;
  float sca = 1.0;
  for (int i = 0; i < 5; i++) {
    float h = 0.012 + 0.16 * (float(i) + 1.0) / 5.0;
    float d = ${sd}(p + n * h);
    occ += (h - d) * sca;
    sca *= 0.90;
  }
  return clamp(1.0 - 1.6 * occ, 0.0, 1.0);
}

/** 调色板。按高度/按法线两种双色 —— 分形的高度分布差异很大，够用。 */
vec3 sdfTint(vec3 p, vec3 n) {
  if (u_palette == 1) return mix(u_color, u_colorB, clamp(p.y * 0.5 + 0.5, 0.0, 1.0));
  if (u_palette == 2) return mix(u_color, u_colorB, clamp(n.y * 0.5 + 0.5, 0.0, 1.0));
  return u_color;
}

/**
 * 着色。三个光项 + 遮蔽 + 距离衰减 + 雾，与 \`menger\` 上游那套逐字同源
 * （明暗刻意压在 1.2 以下：把面打爆白就把唯一值得看的褶皱全抹掉了）。
 */
vec3 sdfShade(vec3 p, vec3 n, vec3 rd, float dist, vec3 albedo) {
  vec3 L = u_light;
  float lam = max(dot(n, L), 0.0);
  float bak = max(dot(n, -L), 0.0) * 0.30;
  float rim = pow(1.0 - max(dot(n, -rd), 0.0), 2.2) * 0.45;
  float shade = 0.06 + lam * 0.60 + bak * 0.7 + rim * 0.8;
  shade *= mix(0.55, 1.0, mix(1.0, sdfAO(p, n), clamp(u_ao, 0.0, 1.0)));
  /* 光线爬了多远当纵深用：越深越沉 */
  shade *= mix(0.60, 1.0, clamp(1.0 - dist * 0.17, 0.0, 1.0));
  vec3 col = shade * albedo;
  col *= mix(1.0, clamp(1.0 - dist * 0.11, 0.0, 1.0), clamp(u_fog, 0.0, 1.0));
  return col * u_gain;
}
`;
}

/**
 * 3D 生成器共用的**质量**参数。
 *
 * 文案键共用一套 `algo.sdf.*`（与 `intResParam()` 同理）：四个 3D 物体各写一份
 * 「步数 / 最远距离 / 命中阈值 / 视场」就会出现名字与口径的漂移。
 */
export function sdfQualityParams(steps = 72): ParamDef[] {
  return [
    {
      key: 'steps',
      labelKey: 'algo.sdf.steps',
      type: 'range',
      min: 32,
      max: MAX_MARCH_STEPS,
      step: 8,
      defaultValue: steps,
    } satisfies RangeParam,
    {
      key: 'stepScale',
      labelKey: 'algo.sdf.stepScale',
      type: 'range',
      min: 0.25,
      max: 1,
      step: 0.01,
      defaultValue: 0.9,
    } satisfies RangeParam,
    {
      key: 'maxDist',
      labelKey: 'algo.sdf.maxDist',
      type: 'range',
      min: 4,
      max: 32,
      step: 0.5,
      defaultValue: 9,
    } satisfies RangeParam,
    {
      key: 'eps',
      labelKey: 'algo.sdf.eps',
      type: 'range',
      min: 0.0005,
      max: 0.008,
      step: 0.0001,
      defaultValue: 0.0018,
    } satisfies RangeParam,
    {
      key: 'fov',
      labelKey: 'algo.sdf.fov',
      type: 'range',
      min: 0.4,
      max: 3,
      step: 0.01,
      defaultValue: 1.3,
    } satisfies RangeParam,
  ];
}

/**
 * 3D 生成器共用的**光照 / 配色**参数。
 *
 * 光方向用**两个角度**而不是向量：`ParamDef` 没有 vec3 这一档，而
 * 「方位角 + 仰角」两个滑杆比三个数字框好用得多（`sdfUniforms` 里换算）。
 */
export function sdfLightParams(opts: { fog?: number; ao?: number } = {}): ParamDef[] {
  return [
    {
      key: 'lightAz',
      labelKey: 'algo.sdf.lightAz',
      type: 'range',
      min: -180,
      max: 180,
      step: 1,
      // 默认复现 menger 上游那个固定光向 normalize(-0.55, 0.75, 0.55)
      defaultValue: -45,
    } satisfies RangeParam,
    {
      key: 'lightEl',
      labelKey: 'algo.sdf.lightEl',
      type: 'range',
      min: -90,
      max: 90,
      step: 1,
      defaultValue: 44,
    } satisfies RangeParam,
    {
      key: 'ao',
      labelKey: 'algo.sdf.ao',
      type: 'range',
      min: 0,
      max: 1,
      step: 0.01,
      defaultValue: opts.ao ?? 0.6,
    } satisfies RangeParam,
    {
      key: 'fog',
      labelKey: 'algo.sdf.fog',
      type: 'range',
      min: 0,
      max: 1,
      step: 0.01,
      defaultValue: opts.fog ?? 0.3,
    } satisfies RangeParam,
    {
      key: 'gain',
      labelKey: 'algo.sdf.gain',
      type: 'range',
      min: 0.2,
      max: 2,
      step: 0.01,
      defaultValue: 1.0,
    } satisfies RangeParam,
    {
      key: 'palette',
      labelKey: 'algo.sdf.palette',
      type: 'select',
      defaultValue: 'single',
      options: [
        { labelKey: 'algo.sdf.paletteSingle', value: 'single' },
        { labelKey: 'algo.sdf.paletteHeight', value: 'height' },
        { labelKey: 'algo.sdf.paletteNormal', value: 'normal' },
      ],
    } satisfies SelectParam,
    { key: 'color', labelKey: 'algo.sdf.color', type: 'color', defaultValue: '#dfe9ff' },
    {
      key: 'colorB',
      labelKey: 'algo.sdf.colorB',
      type: 'color',
      defaultValue: '#3a6ea5',
      visibleWhen: (v) => v.palette !== 'single',
    },
    { key: 'bg', labelKey: 'algo.sdf.bg', type: 'color', defaultValue: '#000000' },
  ];
}

/** 3D 生成器共用的参数尾巴：质量 + 光照 + 内部分辨率。 */
export function sdfParams(
  opts: { steps?: number; stepScale?: number; fog?: number; ao?: number } = {},
): ParamDef[] {
  const quality = sdfQualityParams(opts.steps).map((p) =>
    p.key === 'stepScale' && opts.stepScale !== undefined
      ? ({ ...p, defaultValue: opts.stepScale } as ParamDef)
      : p,
  );
  return [...quality, ...sdfLightParams(opts), intResParam()];
}

/**
 * 内核那批 uniform 的派发。生成器的 `setUniforms` 先调它，再派自己的。
 *
 * ⚠️ **必须写满自己声明的那 12 个** —— `algo-uniforms.test.ts` 的判据是
 * 「fragment 里声明了的都被写到」，而内核的声明就在每个 3D def 的 fragment 里
 * （拼在前面的）。漏一个的表现是那个 uniform 恒为默认值且不报错。
 */
export function sdfUniforms(): AlgoSetUniforms {
  return (gl, l, v, _ctx: AlgoUniformCtx) => {
    const set1f = (name: string, value: number): void => {
      const loc = l[name];
      if (loc) gl.uniform1f(loc, value);
    };
    const set1i = (name: string, value: number): void => {
      const loc = l[name];
      if (loc) gl.uniform1i(loc, Math.round(value));
    };
    const set3 = (name: string, hex: string): void => {
      const loc = l[name];
      if (!loc) return;
      const [r, g, b] = colorVec3(hex);
      gl.uniform3f(loc, r, g, b);
    };

    set1i('u_steps', Number(v.steps ?? 72));
    set1f('u_maxDist', Number(v.maxDist ?? 9));
    set1f('u_stepScale', Number(v.stepScale ?? 0.9));
    set1f('u_eps', Number(v.eps ?? 0.0018));
    set1f('u_fov', Number(v.fov ?? 1.3));
    set1f('u_gain', Number(v.gain ?? 1));
    set1f('u_fog', Number(v.fog ?? 0.3));
    set1f('u_ao', Number(v.ao ?? 0.6));
    set1i('u_palette', SDF_PALETTES[String(v.palette)] ?? 0);
    set3('u_color', String(v.color ?? '#dfe9ff'));
    set3('u_colorB', String(v.colorB ?? '#3a6ea5'));
    set3('u_bg', String(v.bg ?? '#000000'));

    // 光方向：方位角 + 仰角 → 单位向量。与「先绕 y 转方位、再抬仰角」同口径。
    const az = (Number(v.lightAz ?? -45) * Math.PI) / 180;
    const el = (Number(v.lightEl ?? 44) * Math.PI) / 180;
    const ce = Math.cos(el);
    const light = l['u_light'];
    if (light) gl.uniform3f(light, Math.sin(az) * ce, Math.sin(el), Math.cos(az) * ce);
  };
}

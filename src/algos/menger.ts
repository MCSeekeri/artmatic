/**
 * menger.ts — Menger 海绵（三维光线步进），realtime 型。
 *
 * 移植自 angel-echo `js/scenes.js` 的 `mathfield` mode 6（同作者内部移植，见 CREDITS.md）。
 * 上游把它塞在一个「七模式采样器」里（`uMathMode` 分派），本项目的模型是
 * **一个生成器 = 一个 def**，所以单独成文件。
 *
 * 三维的相机、步进、法线、光照、雾在 `sdf-lib.ts`（共用的 3D 内核）——
 * 本文件只剩**自己的 SDF**与**自己的相机运动**。
 *
 * 两条保真细节：
 * - **递归深度是渲染档位，不是着色参数。** 3 层是「一个带洞的方块」，
 *   4 层自相似才开始读得出来，5 层在 640 像素宽下是白费功夫。
 * - **不要把面打爆白。** 上游第一版把光项求和到 1.65，平面糊成一片纸白，
 *   把唯一值得看的东西 —— 洞的阶梯内部 —— 全抹掉了。这条现在由 `gain = 1`
 *   加 ACES 的肩来守（`sdf-lib` 的 `sdfShade`），不再是硬编码的系数。
 *
 * ⚠️ **着色模型换过一次**（三项假光照 → 半球环境光 + GGX + 软阴影），
 * 所以上游那张参考画面**不可能再逐像素复现**。`steps / fog` 保的是几何与
 * 干净背景，那两项仍然有效；明暗值只能比「像不像」。
 *
 * `u_push` 代替上游的 `uMathGrow`：那是「镜头在这一个 shot 里走了多远」，
 * 属于**编排层**（硬编码的镜头表）。artmatic 的模型是用户自己编排，
 * 所以它变成一个**可打关键帧**的参数。
 *
 * ## 为什么相机没有换成内核的 `sdfOrbitCam`
 *
 * 这里同时旋转 `ro` 与 `rd`（上游的写法），与「把眼睛摆在球面上看向原点」
 * 数值等价但**参数化不同**（`push` 同时改 yaw 与距离）。换过去会让这一个
 * 生成器的取景与以前对不上 —— 而它是唯一有「上游参考画面」要保的对象。
 * 新的三个 3D 分形都走 `sdfOrbitCam`。
 */

import {
  SDF_CAMERAS,
  sdfCameraParams,
  sdfKernel,
  sdfParams,
  sdfShadeUniforms,
  sdfUniforms,
} from './sdf-lib';
import type { GeneratorDef } from './types';

const SD = 'sdMenger';

const BODY = `
uniform float u_push;     // 0..1：镜头推进（编排 → 参数/关键帧）
uniform float u_rate;     // 公转速度倍率
uniform int   u_depth;    // 递归深度 2..5
uniform float u_twist;    // 沿 y 轴每单位高度的扭转角（弧度）
uniform int   u_variant;  // 0 = 海绵（三维挖）· 1 = 地毯（只挖 xz 平面后挤出）
uniform int   u_extent;   // 0 = 单体 · 1 = 无限延伸（只在海绵下成立）
uniform int   u_camera;   // 0 = 环绕 · 1 = 穿梭
uniform float u_flySpeed;
uniform float u_flyShake;

/** 绕 y 轴按高度扭转 —— 让方块从「古典几何体」变成「藤蔓」。 */
vec3 twistY(vec3 p, float k) {
  float a = k * p.y;
  float c = cos(a), s = sin(a);
  return vec3(c * p.x - s * p.z, p.y, s * p.x + c * p.z);
}

/*
 * ⚠️ 扭转**写在 SDF 内部**，不是包在调用点上。
 *
 * 内核里的步进 / 法线 / 遮蔽会调它 5 次以上，包在调用点就得改 5 处 ——
 * 而第一版重构正是漏掉了这几处：u_twist 照常派发、滑杆照常能动，
 * **画面完全不变**且不报错。A/B 的几何覆盖判据（twist 档的 lit 与
 * twist=0 档逐位相同）才把它揪出来。
 *
 * ⚠️ 无限延伸下**不做扭转**：下面的折叠把坐标压回一个 cell，扭转是随高度
 * 转的，相邻 cell 的扭角差整整一档 ⇒ 距离场在 cell 边界上断裂（表面会撕开
 * 一道缝）。所以「无限延伸」时 twist 滑杆在参数表里直接藏起来 —— 藏起来
 * 比留一个拖了没反应的滑杆好。
 */
float ${SD}(vec3 p) {
  bool inf = u_extent == 1 && u_variant == 0;
  if (inf) {
    /*
     * 折叠到 [-1,1]³：海绵的八度图案本来就以 2 为周期（每个八度的孔洞由
     * mod(p * 3^i, 2) 挖出来），所以把这个 cell 复制出去就是同一套生成逻辑
     * —— 不是另一种几何，是同一个海绵铺满整个空间。
     *
     * 折叠的代价：cell 边界附近的距离是**低估**（最近的构件可能在隔壁 cell），
     * 步进因此偏保守、多走几步。安全方向，不会穿面。
     */
    p = mod(p + 1.0, 2.0) - 1.0;
  } else {
    p = twistY(p, u_twist);
  }
  /*
   * ⚠️ 无限模式**必须去掉外框约束**。
   *
   * max(|p|) - 1 在折叠坐标里恒 ≤ 0，看起来「无害」，但它在 |p| = 1 那一圈
   * 恰好等于 0 —— 于是整张 cell 边界都满足 d < eps，步进在任意位置都立刻判成
   * 命中：镜头一旦靠近边界，整幅画面就变成一块纯色；镜头正好落在边界上时
   * 命中距离是 0，而调用点是 hit <= 0.0，直接被当成「没命中」渲染成底色
   * （整屏全黑，不报错）。踩过一次，表现是「某些时刻整帧全黑、换个时刻又好了」。
   */
  float d = -1.0e6;
  if (!inf) {
    d = u_variant == 1
      ? max(abs(p.x), abs(p.z)) - 1.0
      : max(abs(p.x), max(abs(p.y), abs(p.z))) - 1.0;
  }
  float s = 1.0;
  for (int m = 0; m < 5; m++) {
    if (m >= u_depth) break;
    vec3 a = mod(p * s, 2.0) - 1.0;
    s *= 3.0;
    vec3 r = abs(1.0 - 3.0 * abs(a));
    float c = u_variant == 1
      ? (max(r.x, r.z) - 1.0) / s
      : (min(max(r.x, r.y), min(max(r.y, r.z), max(r.z, r.x))) - 1.0) / s;
    d = max(d, c);
  }
  return d;
}

void main() {
  vec3 ro;
  vec3 rd;
  if (u_camera == 1) {
    /*
     * 穿梭：镜头沿正弦叠加路径游走，视线朝切线，再沿距离场梯度推出实体。
     * 没有「推出」这一步的话，镜头一进墙整幅画面就变成一块纯色（第一段步进
     * 立刻以 d 接近 0 判成命中），看起来像渲染坏了。
     */
    vec3 fwd;
    /* head = (0,0,0)：Menger 的八度 1 十字孔是三条互相垂直的贯通隧道，
       它们的交点就是原点。六个方向的走廊都从这一点出发，所以「飞一个周期
       再换轴」永远不会撞墙，sdfCameraClear 只是兜底。 */
    sdfFlyCam(u_time, u_seed, u_flySpeed, u_flyShake, vec3(0.0), ro, fwd);
    ro = sdfCameraClear(ro, 0.08);
    rd = sdfRay(vUv, u_aspect, sdfCam(ro, ro + fwd));
  } else {
    // 相机：上游那套「同时转 ro 与 rd」的轨道 + 推进（见文件头）
    float tm = u_time * 0.10 * u_rate;
    float yaw = tm + u_push * 1.9;
    float pit = 0.44 + 0.13 * sin(u_time * 0.063 * u_rate);
    ro = vec3(0.0, 0.0, 3.05 - u_push * 1.20);
    vec2 sc = (vUv - 0.5) * vec2(u_aspect, 1.0) * u_fov;
    rd = normalize(vec3(sc, -1.0));

    float cy = cos(yaw), sy = sin(yaw);
    rd.xz = mat2(cy, -sy, sy, cy) * rd.xz;
    ro.xz = mat2(cy, -sy, sy, cy) * ro.xz;
    float cp = cos(pit), sp = sin(pit);
    rd.yz = mat2(cp, -sp, sp, cp) * rd.yz;
    ro.yz = mat2(cp, -sp, sp, cp) * ro.yz;
  }

  /*
   * hit < 0.0 而不是 hit <= 0.0：sdfMarch 的**未命中哨兵是 -1**，而 0 是一个
   * 合法命中（镜头正好贴在表面上）。写成小于等于会把这种命中当成没打中，整幅
   * 画面退回底色 —— 表现是「镜头贴到墙上的那几帧全黑」。
   */
  float hit = sdfMarch(ro, rd);
  if (hit < 0.0) {
    outColor = sdfBackground();
    return;
  }
  vec3 q = ro + rd * hit;
  vec3 n = sdfNormal(q, sdfNormalEps(hit));
  outColor = vec4(sdfShade(q, n, rd, hit, sdfTint(q, n)), 1.0);
}`;

export const MENGER_FRAG = sdfKernel(SD) + BODY;

export const mengerDef: GeneratorDef = {
  id: 'menger',
  nameKey: 'algo.menger',
  kind: 'realtime',
  fragment: MENGER_FRAG,
  params: [
    {
      key: 'variant',
      labelKey: 'algo.menger.variant',
      type: 'select',
      defaultValue: 'sponge',
      options: [
        { labelKey: 'algo.menger.variantSponge', value: 'sponge' },
        { labelKey: 'algo.menger.variantCarpet', value: 'carpet' },
      ],
    },
    /*
     * 无限延伸。**只对三维海绵成立** —— 地毯是二维图案挤出，把它铺满空间就是
     * 「一整块挖了洞的墙」，没有穿梭可言。所以按 variant 藏起来；着色器里也
     * 再判一次 `u_variant == 0`，因为切回地毯时存着的值仍然是 infinite。
     */
    {
      key: 'extent',
      labelKey: 'algo.menger.extent',
      type: 'select',
      defaultValue: 'bounded',
      options: [
        { labelKey: 'algo.menger.extentBounded', value: 'bounded' },
        { labelKey: 'algo.menger.extentInfinite', value: 'infinite' },
      ],
      visibleWhen: (v) => v.variant === 'sponge',
    },
    ...sdfCameraParams(),
    {
      key: 'push',
      labelKey: 'algo.menger.push',
      type: 'range',
      min: 0,
      max: 1,
      step: 0.01,
      defaultValue: 0.35,
      visibleWhen: (v) => v.camera !== 'fly',
    },
    {
      key: 'rate',
      labelKey: 'algo.menger.rate',
      type: 'range',
      min: 0,
      max: 6,
      step: 0.05,
      defaultValue: 1.6,
      visibleWhen: (v) => v.camera !== 'fly',
    },
    { key: 'depth', labelKey: 'algo.menger.depth', type: 'range', min: 2, max: 5, step: 1, defaultValue: 4 },
    {
      key: 'twist',
      labelKey: 'algo.menger.twist',
      type: 'range',
      min: -2,
      max: 2,
      step: 0.01,
      defaultValue: 0,
      // 无限延伸下不做扭转（cell 边界会撕开，见 sdMenger 的注释）
      visibleWhen: (v) => v.extent !== 'infinite',
    },
    /*
     * 光照 / 配色 / 质量 / intRes 全是 3D 内核那套（文案键共用 `algo.sdf.*`）。
     *
     * 两个值刻意与内核默认不同，为的是**保住上游那张画面**：
     * `steps = 48`（上游的硬编码上界，72 会让远处的洞多爬出几层，取景变了）、
     * `fog = 0`（上游不开雾）。
     *
     * `ao` 反向破例：上游是 0（它用「距离衰减」代替采样遮蔽），这里给 0.55。
     * 新版着色把那条「距离衰减压全部明暗」的腿拆掉了（现在只压环境光），
     * AO 归零会让深洞变成一片平灰 —— 这不是保真，是丢掉了海绵唯一值得看的内部阶梯。
     * 阴影给得比另两个分形弱一点（0.55 / 10 步）：海绵的洞本来就深，阴影一硬
     * 整块塌成黑的。
     */
    ...sdfParams({
      steps: 48,
      fog: 0,
      ao: 0.55,
      shadow: 0.55,
      shadowSteps: 10,
      gloss: 0.5,
      ambient: '#1b2233',
      pointPow: 0.22,
      pointDist: 3.2,
    }),
  ],
  setUniforms: (gl, l, v, ctx) => {
    sdfUniforms()(gl, l, v, ctx);
    sdfShadeUniforms()(gl, l, v, ctx);
    const set1f = (name: string, value: number): void => {
      const loc = l[name];
      if (loc) gl.uniform1f(loc, value);
    };
    set1f('u_push', Number(v.push ?? 0.35));
    set1f('u_rate', Number(v.rate ?? 1.6));
    set1f('u_twist', Number(v.twist ?? 0));
    set1f('u_flySpeed', Number(v.flySpeed ?? 0.6));
    set1f('u_flyShake', Number(v.flyShake ?? 0.3));
    const depth = l['u_depth'];
    if (depth) gl.uniform1i(depth, Math.round(Number(v.depth ?? 4)));
    const variant = l['u_variant'];
    if (variant) gl.uniform1i(variant, v.variant === 'carpet' ? 1 : 0);
    const extent = l['u_extent'];
    if (extent) gl.uniform1i(extent, v.extent === 'infinite' ? 1 : 0);
    const camera = l['u_camera'];
    if (camera) gl.uniform1i(camera, SDF_CAMERAS[String(v.camera)] ?? 0);
  },
};

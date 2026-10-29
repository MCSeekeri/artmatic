/**
 * apollonian.ts — 阿波罗尼奥斯球堆叠（球反演 IFS），realtime 型。
 *
 * 结构是「**折叠 + 反演**」：把空间折回 `[-1,1]³`，再对单位球做一次反演
 * （半径越靠近球心缩放越猛），迭代十几次。极限集就是那个所有球两两相切的
 * 球堆 —— 每个球里又嵌着一整套自相似的球。
 *
 *     p ← fold(p)                // 折回 [-1,1]³
 *     k ← scale₀ / |p|²           // 反演倍率
 *     p ← p · k,  s ← s · k       // s 累积雅可比
 *     DE = ¼ · |p.y| / s
 *
 * ⚠️ **这条 DE 出自 Íñigo Quílez 的 Apollonian 光线步进**（ShaderToy
 * `4ds3zn`），本项目照同一份数学重写（见 CREDITS.md）。
 *
 * ⚠️ **`k` 的分子是固定参数，不是累积量。** 第一版我把 `k` 写成了「用累积的
 * `s` 除以 r²」—— 那会让 s 每次迭代再乘一次 `k`、指数发散，DE 一路趋零，
 * 于是**整片空间都判定为命中**：画面外围出现一大块平坦的灰「墙」（那是
 * y=0 平面被误当成表面）。核对参考实现才看出分子是不动的 `s`。这是个
 * 一眼能看出、但只看单帧截图不会怀疑到公式上的错误 —— 所以 `scale₀`
 * 现在是个**参数**（默认 1.0 = 参考实现），扫它就能看出 DE 是否健康。
 *
 * `iter` 的形态很敏感：不够时球面还没长出来（一片噪点），过多会把远处细节
 * 抹成灰雾。默认 8。
 *
 * 相机 / 步进 / 法线 / 光照 / 雾全在 `sdf-lib.ts`。
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

const SD = 'sdApollonian';

const BODY = `
uniform int   u_iter;      // 折叠-反演的迭代次数
uniform float u_scale;     // 反演的基本缩放（1.0 = 参考实现）
uniform float u_push;
uniform float u_rate;
uniform float u_dist;
uniform int   u_camera;    // 0 = 环绕 · 1 = 穿梭
uniform float u_flySpeed;
uniform float u_flyRange;

/** 折回 [-1,1]³：\`fract\` 把小数部分映射到 [0,1)，再线性拉回来。 */
vec3 apollFold(vec3 p) {
  return -1.0 + 2.0 * fract(0.5 * p + 0.5);
}

float ${SD}(vec3 p) {
  float s = 1.0;
  for (int i = 0; i < 16; i++) {
    if (i >= u_iter) break;
    p = apollFold(p);
    float r2 = dot(p, p);
    // ⚠️ 分子是**固定参数** u_scale，不是累积的 s（见文件头那次错误）
    float k = u_scale / max(r2, 1e-6);
    p *= k;
    s *= k;
  }
  // 折叠把 y=0 平面卷成密集的层 —— 它的零集就是那个球堆，不是一块平面
  return 0.25 * abs(p.y) / max(s, 1e-6);
}

/*
 * 穿梭在这里是**免费**的：fold 用 fract，整个距离场本来就以 2 为周期
 * —— 画面里那一团只是其中一个周期，隔壁还有无穷多团同样的球堆。
 * 所以只需要移动镜头，不需要像 menger 那样先折叠坐标。
 */
void main() {
  vec3 eye;
  vec3 rd;
  if (u_camera == 1) {
    vec3 fwd;
    sdfFlyCam(u_time, u_seed, u_flySpeed, u_flyRange, vec3(1.0), eye, fwd);
    /* 推出实体：球堆之间全是相切的缝，镜头正好落在球面上时整幅画面会变成
       一块纯色（第一段步进立刻判成 d 接近 0 的命中）。 */
    eye = sdfCameraClear(eye, 0.15);
    /*
     * 视线往原点偏 25%。纯看切线时球堆会整个滑出画面（只剩空背景），
     * 全偏向原点又变成盯着最近那颗球 —— 两种都只剩一片平色。25% 是让
     * 「位置在飞、结构始终在画面里」的那一档。
     */
    float el = length(eye);
    if (el > 1e-3) fwd = normalize(mix(fwd, -eye / el, 0.25));
    rd = sdfRay(vUv, u_aspect, sdfCam(eye, eye + fwd));
  } else {
    float yaw = u_time * 0.06 * u_rate + u_push * 1.6;
    float pitch = 0.20 + 0.14 * sin(u_time * 0.04 * u_rate);
    mat3 cam = sdfOrbitCam(yaw, pitch, u_dist * (1.0 - 0.25 * u_push), eye);
    rd = sdfRay(vUv, u_aspect, cam);
  }

  /* hit < 0.0：未命中哨兵是 -1，而 0 是合法命中（镜头贴住表面）。见 menger 同处注释。 */
  float hit = sdfMarch(eye, rd);
  if (hit < 0.0) {
    outColor = sdfBackground();
    return;
  }
  vec3 q = eye + rd * hit;
  vec3 n = sdfNormal(q, sdfNormalEps(hit));
  outColor = vec4(sdfShade(q, n, rd, hit, sdfTint(q, n)), 1.0);
}`;

export const APOLLONIAN_FRAG = sdfKernel(SD) + BODY;

export const apollonianDef: GeneratorDef = {
  id: 'apollonian',
  nameKey: 'algo.apollonian',
  kind: 'realtime',
  fragment: APOLLONIAN_FRAG,
  params: [
    { key: 'iter', labelKey: 'algo.apollonian.iter', type: 'range', min: 3, max: 16, step: 1, defaultValue: 8 },
    { key: 'scale', labelKey: 'algo.apollonian.scale', type: 'range', min: 0.6, max: 1.6, step: 0.01, defaultValue: 1 },
    ...sdfCameraParams(),
    {
      key: 'dist',
      labelKey: 'algo.sdf.dist',
      type: 'range',
      min: 1,
      max: 6,
      step: 0.02,
      defaultValue: 2.6,
      visibleWhen: (v) => v.camera !== 'fly',
    },
    {
      key: 'push',
      labelKey: 'algo.sdf.push',
      type: 'range',
      min: 0,
      max: 1,
      step: 0.01,
      defaultValue: 0,
      visibleWhen: (v) => v.camera !== 'fly',
    },
    {
      key: 'rate',
      labelKey: 'algo.sdf.rate',
      type: 'range',
      min: 0,
      max: 6,
      step: 0.05,
      defaultValue: 1,
      visibleWhen: (v) => v.camera !== 'fly',
    },
    ...sdfParams({ fog: 0.25, ao: 0.5, gloss: 0.45, ambient: '#182338', pointPow: 0.3, pointDist: 2.4 }),
  ],
  setUniforms: (gl, l, v, ctx) => {
    sdfUniforms()(gl, l, v, ctx);
    sdfShadeUniforms()(gl, l, v, ctx);
    const set1f = (name: string, value: number): void => {
      const loc = l[name];
      if (loc) gl.uniform1f(loc, value);
    };
    set1f('u_scale', Number(v.scale ?? 1));
    set1f('u_push', Number(v.push ?? 0));
    set1f('u_rate', Number(v.rate ?? 1));
    set1f('u_dist', Number(v.dist ?? 2.6));
    set1f('u_flySpeed', Number(v.flySpeed ?? 0.6));
    set1f('u_flyRange', Number(v.flyRange ?? 1.2));
    const iter = l['u_iter'];
    if (iter) gl.uniform1i(iter, Math.round(Number(v.iter ?? 8)));
    const camera = l['u_camera'];
    if (camera) gl.uniform1i(camera, SDF_CAMERAS[String(v.camera)] ?? 0);
  },
};

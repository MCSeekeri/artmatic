/**
 * mandelbulb.ts — 三维 Mandelbulb（幂次球体分形），realtime 型。
 *
 * White & Nylander 2009 那套：把复平面的 `z ← z^p + c` 用**球坐标**推广到
 * 三维（`(r, θ, φ) → (r^p, p·θ, p·φ)`）。`p = 8` 是论文里那个最出名的形状。
 *
 * 距离估计器用标准的导数形式（每次迭代同时更新 `dr`）：
 *
 *     dr ← p · r^(p−1) · dr + 1        DE = ½ · log(r) · r / dr
 *
 * 相机 / 步进 / 法线 / 光照 / 雾全在 `sdf-lib.ts`，这里只剩 SDF 与相机运动。
 *
 * ## 三个参数各自的观感
 *
 * | 参数 | 作用 |
 * |---|---|
 * | `power` | 2 是「球面上的凸起」，8 是经典的那个多刺球，>8 越来越像海胆 |
 * | `iter`  | 迭代次数上限。**它决定细节层级**，7 与 10 是两个不同的物体 |
 * | `bail`  | 逃逸半径。取 2 是惯例；调大只是把远处那些小凸起算得更准，更贵 |
 */

import { sdfKernel, sdfParams, sdfUniforms } from './sdf-lib';
import type { GeneratorDef } from './types';

const SD = 'sdMandelbulb';

const BODY = `
uniform float u_power;   // z 的幂次（8 = 经典）
uniform int   u_iter;    // 迭代次数上限
uniform float u_bail;    // 逃逸半径
uniform float u_push;    // 0..1 编排量：推近
uniform float u_rate;    // 公转速度
uniform float u_dist;    // 相机距离

float ${SD}(vec3 p) {
  vec3 z = p;
  float dr = 1.0;
  float r = 0.0;
  for (int i = 0; i < 16; i++) {
    if (i >= u_iter) break;
    r = length(z);
    if (r > u_bail) break;
    // 球坐标幂：θ 是极角、φ 是方位角，两者都乘幂次
    float theta = acos(clamp(z.z / r, -1.0, 1.0)) * u_power;
    float phi = atan(z.y, z.x) * u_power;
    float zr = pow(r, u_power);
    // 导数：链式法则的一项，配合下面的 DE 用
    dr = pow(r, u_power - 1.0) * u_power * dr + 1.0;
    float st = sin(theta);
    z = zr * vec3(st * cos(phi), st * sin(phi), cos(theta)) + p;
  }
  // 逃逸越晚（r 越小）越靠近集合边界 → DE 越小
  return 0.5 * log(max(r, 1e-9)) * r / dr;
}

void main() {
  float yaw = u_time * 0.15 * u_rate + u_push * 2.2;
  float pitch = 0.22 + 0.16 * sin(u_time * 0.05 * u_rate);
  vec3 eye;
  mat3 cam = sdfOrbitCam(yaw, pitch, u_dist * (1.0 - 0.18 * u_push), eye);
  vec3 rd = sdfRay(vUv, u_aspect, cam);

  float hit = sdfMarch(eye, rd);
  if (hit <= 0.0) {
    outColor = vec4(u_bg, 1.0);
    return;
  }
  vec3 q = eye + rd * hit;
  vec3 n = sdfNormal(q, 0.0009);
  outColor = vec4(sdfShade(q, n, rd, hit, sdfTint(q, n)), 1.0);
}`;

export const MANDELBULB_FRAG = sdfKernel(SD) + BODY;

export const mandelbulbDef: GeneratorDef = {
  id: 'mandelbulb',
  nameKey: 'algo.mandelbulb',
  kind: 'realtime',
  fragment: MANDELBULB_FRAG,
  params: [
    { key: 'power', labelKey: 'algo.mandelbulb.power', type: 'range', min: 2, max: 12, step: 1, defaultValue: 8 },
    { key: 'iter', labelKey: 'algo.mandelbulb.iter', type: 'range', min: 2, max: 16, step: 1, defaultValue: 8 },
    { key: 'bail', labelKey: 'algo.mandelbulb.bail', type: 'range', min: 1, max: 4, step: 0.05, defaultValue: 2 },
    { key: 'dist', labelKey: 'algo.sdf.dist', type: 'range', min: 1.2, max: 5, step: 0.01, defaultValue: 2.4 },
    { key: 'push', labelKey: 'algo.sdf.push', type: 'range', min: 0, max: 1, step: 0.01, defaultValue: 0 },
    { key: 'rate', labelKey: 'algo.sdf.rate', type: 'range', min: 0, max: 6, step: 0.05, defaultValue: 1 },
    ...sdfParams(),
  ],
  setUniforms: (gl, l, v, ctx) => {
    sdfUniforms()(gl, l, v, ctx);
    const set1f = (name: string, value: number): void => {
      const loc = l[name];
      if (loc) gl.uniform1f(loc, value);
    };
    set1f('u_power', Number(v.power ?? 8));
    set1f('u_bail', Number(v.bail ?? 2));
    set1f('u_push', Number(v.push ?? 0));
    set1f('u_rate', Number(v.rate ?? 1));
    set1f('u_dist', Number(v.dist ?? 2.4));
    const iter = l['u_iter'];
    if (iter) gl.uniform1i(iter, Math.round(Number(v.iter ?? 8)));
  },
};

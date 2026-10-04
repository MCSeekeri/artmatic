/**
 * menger.ts — Menger 海绵（三维光线步进），realtime 型。
 *
 * 移植自 angel-echo `js/scenes.js` 的 `mathfield` mode 6（同作者内部移植，见 CREDITS.md）。
 * 上游把它塞在一个「七模式采样器」里（`uMathMode` 分派），本项目的模型是
 * **一个生成器 = 一个 def**，所以单独成文件。
 *
 * 这是全片唯一的三维物体：相机绕着它转、同时推近，所以没有两次取景是一样的。
 *
 * 两条保真细节：
 * - **递归深度是渲染档位，不是着色参数。** 3 层是「一个带洞的方块」，
 *   4 层自相似才开始读得出来，5 层在 640 像素宽下是白费功夫。
 * - **明暗压在 1.2 以下。** 上游第一版求和到 1.65，平面对着一片纸白，
 *   把唯一值得看的东西 —— 洞的阶梯内部 —— 全抹掉了。
 *
 * `u_push` 代替上游的 `uMathGrow`：那是「镜头在这一个 shot 里走了多远」，
 * 属于**编排层**（硬编码的镜头表）。artmatic 的模型是用户自己编排，
 * 所以它变成一个**可打关键帧**的参数。
 */

import { intResParam } from './shader-lib';
import { colorVec3 } from '../core/color';
import type { GeneratorDef } from './types';

export const MENGER_FRAG = `
uniform float u_push;     // 0..1：镜头推进（编排 → 参数/关键帧）
uniform float u_rate;     // 公转速度倍率
uniform int   u_depth;    // 递归深度 2..5
uniform float u_gain;
uniform vec3  u_color;

/* signed distance to a Menger sponge occupying [-1,1]^3 */
float sdMenger(vec3 p) {
  float d = max(abs(p.x), max(abs(p.y), abs(p.z))) - 1.0;
  float s = 1.0;
  for (int m = 0; m < 5; m++) {
    if (m >= u_depth) break;
    vec3 a = mod(p * s, 2.0) - 1.0;
    s *= 3.0;
    vec3 r = abs(1.0 - 3.0 * abs(a));
    float da = max(r.x, r.y);
    float db = max(r.y, r.z);
    float dc = max(r.z, r.x);
    float c = (min(da, min(db, dc)) - 1.0) / s;
    d = max(d, c);
  }
  return d;
}

void main() {
  float tm = u_time * 0.10 * u_rate;
  float yaw = tm + u_push * 1.9;
  float pit = 0.44 + 0.13 * sin(u_time * 0.063 * u_rate);
  vec3 ro = vec3(0.0, 0.0, 3.05 - u_push * 1.20);
  vec2 sc = (vUv - 0.5) * vec2(u_aspect, 1.0) * 1.30;
  vec3 rd = normalize(vec3(sc, -1.0));
  float cy = cos(yaw), sy = sin(yaw);
  rd.xz = mat2(cy, -sy, sy, cy) * rd.xz;
  ro.xz = mat2(cy, -sy, sy, cy) * ro.xz;
  float cp = cos(pit), sp = sin(pit);
  rd.yz = mat2(cp, -sp, sp, cp) * rd.yz;
  ro.yz = mat2(cp, -sp, sp, cp) * ro.yz;

  float tt = 0.0;
  float hit = -1.0;
  for (int i = 0; i < 48; i++) {
    float d = sdMenger(ro + rd * tt);
    if (d < 0.0018 * (1.0 + tt * 0.5)) { hit = tt; break; }
    tt += d * 0.9;
    if (tt > 9.0) break;
  }

  vec3 col = vec3(0.0);
  if (hit > 0.0) {
    vec3 q = ro + rd * hit;
    float e = 0.0016;
    vec3 n = normalize(vec3(
      sdMenger(q + vec3(e, 0.0, 0.0)) - sdMenger(q - vec3(e, 0.0, 0.0)),
      sdMenger(q + vec3(0.0, e, 0.0)) - sdMenger(q - vec3(0.0, e, 0.0)),
      sdMenger(q + vec3(0.0, 0.0, e)) - sdMenger(q - vec3(0.0, 0.0, e))));
    float lam = max(dot(n, normalize(vec3(-0.55, 0.75, 0.55))), 0.0);
    float bak = max(dot(n, normalize(vec3(0.4, -0.2, -0.9))), 0.0) * 0.30;
    float rim = pow(1.0 - max(dot(n, -rd), 0.0), 2.2) * 0.45;
    /* 压在 1.2 以下 —— 见文件头。 */
    col = vec3(0.06 + lam * 0.60 + bak * 0.7 + rim * 0.8);
    /* 光线爬了多远当环境遮蔽用：洞比面暗，这才读得出体积 */
    col *= mix(0.60, 1.0, clamp(1.0 - hit * 0.17, 0.0, 1.0));
    col *= u_color;
  }
  outColor = vec4(col * u_gain, 1.0);
}`;

export const mengerDef: GeneratorDef = {
  id: 'menger',
  nameKey: 'algo.menger',
  kind: 'realtime',
  fragment: MENGER_FRAG,
  params: [
    { key: 'push', labelKey: 'algo.menger.push', type: 'range', min: 0, max: 1, step: 0.01, defaultValue: 0.35 },
    { key: 'rate', labelKey: 'algo.menger.rate', type: 'range', min: 0, max: 6, step: 0.05, defaultValue: 1.6 },
    { key: 'depth', labelKey: 'algo.menger.depth', type: 'range', min: 2, max: 5, step: 1, defaultValue: 4 },
    { key: 'gain', labelKey: 'algo.menger.gain', type: 'range', min: 0.2, max: 2, step: 0.01, defaultValue: 1.0 },
    { key: 'color', labelKey: 'algo.menger.color', type: 'color', defaultValue: '#dfe9ff' },
    intResParam(),
  ],
  setUniforms: (gl, l, v) => {
    const set1f = (name: string, value: number): void => {
      const loc = l[name];
      if (loc) gl.uniform1f(loc, value);
    };
    set1f('u_push', Number(v.push ?? 0.35));
    set1f('u_rate', Number(v.rate ?? 1.6));
    set1f('u_gain', Number(v.gain ?? 1));
    const depth = l['u_depth'];
    if (depth) gl.uniform1i(depth, Math.round(Number(v.depth ?? 4)));
    const color = l['u_color'];
    if (color) {
      const [r, g, b] = colorVec3(String(v.color ?? '#dfe9ff'));
      gl.uniform3f(color, r, g, b);
    }
  },
};

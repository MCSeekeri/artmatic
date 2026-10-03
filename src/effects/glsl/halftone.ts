import { compose, floats, selectInt, type EffectShaderDef } from '../shader-def';

/**
 * 半调网屏：旋转网点 / 刻线，**自铺纸白底**。
 *
 * 移植自 openmosh `gl/effect-shaders.ts` 的 `halftone`（MIT，见 CREDITS.md）。
 *
 * 两点要注意：
 * 1. `opaqueOutput: true` —— 它画自己的背景（纸白），因此**不保留输入的 alpha**。
 *    协议上是声明性的（runner 无需特判），但必须写上：将来接 `prePasses` 时
 *    这个语义会决定它是「铺满」还是「跟着透明区走」。
 * 2. `mode` 的着色器分支号是 **0 / 2**（没有 1）—— `lines` 不是 `dots + 1`。
 *    映射表照抄，别「顺手规整」成 0/1。
 */
export const shader: EffectShaderDef = {
  fragment: `
uniform float u_scale;
uniform float u_angle;
uniform float u_contrast;
uniform float u_invert;
uniform int u_mode;
void main() {
  vec2 res = vec2(textureSize(u_texture, 0));
  vec2 pos = vUv * res;
  vec3 src = texture(u_texture, vUv).rgb;
  float lum = dot(src, vec3(0.299, 0.587, 0.114));
  lum = clamp((lum - 0.5) * u_contrast + 0.5, 0.0, 1.0);

  float rad = u_angle * 3.14159265 / 180.0;
  float ca = cos(rad), sa = sin(rad);
  vec2 rp = vec2(ca * pos.x + sa * pos.y, -sa * pos.x + ca * pos.y);

  float ink; // 1 = 上墨
  if (u_mode == 2) {
    // 刻线；暗部再加一组垂直的
    float aa = 1.5 * 3.14159265 / u_scale;
    float w1 = 0.5 + 0.5 * sin(rp.y * 3.14159265 / u_scale);
    float w2 = 0.5 + 0.5 * sin(rp.x * 3.14159265 / u_scale);
    float l1 = 1.0 - smoothstep(w1 - aa, w1 + aa, lum);
    float l2 = 1.0 - smoothstep(w2 - aa, w2 + aa, lum * 2.0);
    ink = max(l1, l2);
  } else {
    // 经典旋转网点：越暗点越大
    vec2 cell = fract(rp / u_scale) - 0.5;
    float r = sqrt(1.0 - lum) * 0.7071;
    ink = smoothstep(r, r - 1.5 / u_scale, length(cell));
  }
  ink = mix(ink, 1.0 - ink, u_invert);
  // 墨色取自源色，压在纸白上
  vec3 col = mix(vec3(1.0), src, ink);
  outColor = vec4(col, 1.0);
}`,
  opaqueOutput: true,
  setUniforms: compose(
    floats('scale', 'angle', 'contrast', 'invert'),
    selectInt('mode', { dots: 0, lines: 2 }),
  ),
};

import { compose, floats, selectInt, type EffectShaderDef } from '../shader-def';

/**
 * 颗粒：逐像素哈希噪点，每帧重新落位，像胶片一样「沸腾」。
 *
 * 移植自 openmosh `gl/effect-shaders.ts` 的 `grain`（MIT，见 CREDITS.md）。
 *
 * - `floor(u_time * 24.0)` 是**速率无关**的自由 tick（这个特效没有 `speed` 参数），
 *   所以 `u_time = 秒`正合适，不需要相位处理。
 * - 它的 `hash` 是 Dave Hoskins 无 sin 族、且带注释说明「ANGLE/D3D 上
 *   fract(sin(x)*K) 在大 x 处会塌成常数，而像素坐标就是大 x」。
 *   保留自带实现（与 `HASH_FAST_GLSL` 同源但名字/签名不同）。
 */
export const shader: EffectShaderDef = {
  fragment: `
uniform float u_amount;
uniform float u_rgb;
uniform int u_blendMode;
float hash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
vec3 blendSoftLight(vec3 base, vec3 blend) {
  return mix(
    2.0 * base * blend + base * base * (1.0 - 2.0 * blend),
    2.0 * base * (1.0 - blend) + sqrt(base) * (2.0 * blend - 1.0),
    step(0.5, blend)
  );
}
void main() {
  vec4 c = texture(u_texture, vUv);
  float frame = floor(u_time * 24.0);

  // 硬逐像素斑点：一个像素一次哈希、不插值 —— 干脆的颗粒，每帧重新落位
  vec2 p = floor(gl_FragCoord.xy) + frame * vec2(13.7, 57.3);

  vec3 g = u_rgb > 0.5
    ? vec3(hash(p), hash(p + 19.19), hash(p + 47.47))
    : vec3(hash(p));

  vec3 result;
  if (u_blendMode == 0) {
    result = c.rgb + (g - 0.5) * u_amount * 1.2;
  } else if (u_blendMode == 1) {
    result = mix(c.rgb, blendSoftLight(c.rgb, g), u_amount * 1.5);
  } else {
    result = c.rgb * mix(vec3(1.0), g * 1.6, u_amount);
  }
  outColor = vec4(clamp(result, 0.0, 1.0), c.a);
}`,
  setUniforms: compose(
    floats('amount', 'rgb'),
    selectInt('blendMode', { additive: 0, softlight: 1, multiply: 2 }),
  ),
};

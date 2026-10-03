import { compose, floats, HUE_ROTATE_GLSL, selectInt, type EffectShaderDef } from '../shader-def';

/**
 * 二分色：沿某个角度把画面分成两半，一侧做处理（反相 / 色相偏移 / 去饱和 / 高对比）。
 *
 * 移植自 openmosh `gl/effect-shaders.ts` 的 `color-halves`（MIT，见 CREDITS.md）。
 * 分界带一小段 feather，硬切会在斜角上出现锯齿。
 */
export const shader: EffectShaderDef = {
  fragment: `
uniform float u_position;
uniform float u_angle;
uniform int u_mode;
uniform float u_amount;
${HUE_ROTATE_GLSL}
void main() {
  vec4 orig = texture(u_texture, vUv);
  float rad = u_angle * 3.14159265 / 180.0;
  vec2 center = vec2(0.5);
  vec2 uv = vUv - center;
  float c = cos(rad), s = sin(rad);
  float proj = uv.x * c + uv.y * s;
  float feather = 0.02;
  float side = smoothstep(u_position - feather, u_position + feather, proj + 0.5);
  vec3 treated = orig.rgb;
  if (u_mode == 0) {
    treated = hueRotate(treated, 180.0);
  } else if (u_mode == 1) {
    treated = hueRotate(treated, 120.0);
  } else if (u_mode == 2) {
    float luma = dot(treated, vec3(0.299, 0.587, 0.114));
    treated = mix(treated, vec3(luma), 1.0);
  } else {
    treated = clamp((orig.rgb - 0.5) * 2.0 + 0.5, 0.0, 1.0);
  }
  vec3 result = mix(orig.rgb, treated, side * u_amount);
  outColor = vec4(result, orig.a);
}`,
  setUniforms: compose(
    floats('position', 'angle', 'amount'),
    // 模式名 → 着色器里的分支号。**按 openmosh 的分支顺序**，别按选项顺序猜。
    selectInt('mode', { invert: 0, 'hue-shift': 1, desaturate: 2, 'high-contrast': 3 }),
  ),
};

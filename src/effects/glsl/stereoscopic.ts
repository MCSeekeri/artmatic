import { compose, floats, selectInt, type EffectShaderDef } from '../shader-def';

/**
 * 红青立体：按「深度」把 R 与 GB 反向位移 —— 红青眼镜看的立体图。
 *
 * 移植自 openmosh `gl/effect-shaders.ts` 的 `stereoscopic`（MIT，见 CREDITS.md）。
 * 深度来源三种：亮度 / 边缘梯度 / 平面（恒定位移）。
 * `focus` 是**反向**的：值越大位移越小（对焦处不动）。
 */
export const shader: EffectShaderDef = {
  fragment: `
uniform float u_depth;
uniform float u_angle;
uniform int u_mode;
uniform int u_depthSource;
uniform float u_focus;
void main() {
  vec2 px = 1.0 / vec2(textureSize(u_texture, 0));
  vec4 c = texture(u_texture, vUv);

  float d;
  if (u_depthSource == 0) {
    d = dot(c.rgb, vec3(0.299, 0.587, 0.114));
  } else if (u_depthSource == 1) {
    float lL = dot(texture(u_texture, vUv + vec2(-px.x, 0.0)).rgb, vec3(0.299, 0.587, 0.114));
    float lR = dot(texture(u_texture, vUv + vec2( px.x, 0.0)).rgb, vec3(0.299, 0.587, 0.114));
    float lT = dot(texture(u_texture, vUv + vec2(0.0, -px.y)).rgb, vec3(0.299, 0.587, 0.114));
    float lB = dot(texture(u_texture, vUv + vec2(0.0,  px.y)).rgb, vec3(0.299, 0.587, 0.114));
    d = clamp(length(vec2(lR - lL, lB - lT)) * 4.0, 0.0, 1.0);
  } else {
    d = 1.0;
  }

  float offset = (d - (1.0 - u_focus)) * u_depth;
  float rad = u_angle * 3.14159265 / 180.0;
  vec2 dir = vec2(cos(rad), sin(rad)) * offset * px;

  if (u_mode == 0) {
    float r = texture(u_texture, vUv + dir).r;
    vec2 gb = texture(u_texture, vUv - dir).gb;
    outColor = vec4(r, gb, c.a);
  } else {
    float r = texture(u_texture, vUv + dir).r;
    float g = texture(u_texture, vUv).g;
    float b = texture(u_texture, vUv - dir).b;
    outColor = vec4(r, g, b, c.a);
  }
}`,
  setUniforms: compose(
    floats('depth', 'angle', 'focus'),
    selectInt('mode', { anaglyph: 0, 'color-split': 1 }),
    selectInt('depthSource', { luminance: 0, edges: 1, flat: 2 }),
  ),
};

import { floats, type EffectShaderDef } from '../shader-def';

/**
 * 漩涡：核心满扭转、到半径处归零（二次衰减），并在基准扭转附近来回「呼吸」
 * 而不是无限缠绕 —— 上游注释写明了理由：无限缠绕会把整个盘面拉成同心环。
 *
 * 移植自 openmosh `gl/effect-shaders.ts` 的 `swirl`（MIT，见 CREDITS.md）。
 * `linearFilter: true`：重采样变形，NEAREST 会出块状锯齿。
 * 相位自己乘（`u_time * u_speed * 0.8`）。
 */
export const shader: EffectShaderDef = {
  fragment: `
uniform float u_angle;
uniform float u_radius;
uniform float u_speed;
void main() {
  vec2 res = vec2(textureSize(u_texture, 0));
  float aspect = res.x / res.y;
  vec2 c = vUv - 0.5;
  c.x *= aspect;
  float d = length(c);
  float infl = 1.0 - smoothstep(0.0, u_radius, d);
  infl *= infl;
  float a = (u_angle + sin(u_time * u_speed * 0.8) * 60.0) * (3.14159265 / 180.0) * infl;
  float ca = cos(a), sa = sin(a);
  vec2 r = vec2(ca * c.x - sa * c.y, sa * c.x + ca * c.y);
  vec2 uv = vec2(r.x / aspect, r.y) + 0.5;
  outColor = texture(u_texture, uv);
}`,
  linearFilter: true,
  setUniforms: floats('angle', 'radius', 'speed'),
};

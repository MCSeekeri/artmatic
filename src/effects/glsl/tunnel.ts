import { floats, type EffectShaderDef } from '../shader-def';

/**
 * 隧道：把上一帧往中心稍微收一点、转一点，无限缩放下去。
 *
 * 移植自 openmosh `gl/effect-shaders.ts` 的 `tunnel`（MIT，见 CREDITS.md）。
 *
 * - 越界采样靠纹理 wrap 镜像，边缘会折回来。
 * - 所有变换都乘 `u_delta`，所以帧率变了也是同样的距离/速度。
 *   没有 `speed` 参数 → `u_delta` 就是「秒/帧」，直接用。
 * - `decay` 是**反的**（越大衰减越快），并裁在 0.90–1.00 的可用区间里。
 */
export const shader: EffectShaderDef = {
  fragment: `
uniform float u_zoom;
uniform float u_spin;
uniform float u_decay;
void main() {
  float s = 1.0 - u_zoom * u_delta * 0.8;
  float a = u_spin * (3.14159265 / 180.0) * u_delta;
  vec2 c = vUv - 0.5;
  float ca = cos(a), sa = sin(a);
  c = vec2(ca * c.x - sa * c.y, sa * c.x + ca * c.y) * s;
  float fade = 1.0 - u_decay * 0.1;
  vec4 prev = texture(u_feedback, c + 0.5) * pow(fade, u_delta * 60.0);
  vec4 fresh = texture(u_texture, vUv);
  outColor = vec4(clamp(max(fresh.rgb, prev.rgb), 0.0, 1.0),
                  clamp(max(fresh.a, prev.a), 0.0, 1.0));
}`,
  feedback: true,
  setUniforms: floats('zoom', 'spin', 'decay'),
};

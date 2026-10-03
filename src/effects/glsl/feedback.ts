import { compose, floats, HUE_ROTATE_GLSL, NOISE_GLSL, selectInt, type EffectShaderDef } from '../shader-def';

/**
 * 反馈循环：缩放 + 旋转 + 噪声扰动 + 逐帧色相偏移的递归回路。
 *
 * 移植自 openmosh `gl/effect-shaders.ts` 的 `feedback`（MIT，见 CREDITS.md）。
 *
 * 三个设计点（上游注释写明的）：
 * - 每个变换都是「每秒」量再乘 `u_delta`，所以无论帧率多少，拖尾的衰减与
 *   行进距离都一样。这也意味着 `u_delta` 在这里**单位是秒/帧**。
 * - 色相偏移是**复利**的：每过一趟循环，活下来的拖尾就再转一点，
 *   于是老鬼影与新鬼影在颜色上分家，而不是叠成一片灰。
 * - `blend` 选 max 是有意的：screen/add 都会把回路推向白，只有 max 挨得住随机衰减。
 */
export const shader: EffectShaderDef = {
  fragment: `
uniform float u_decay;
uniform float u_scale;
uniform float u_rotate;
uniform float u_warp;
uniform float u_hue;
uniform int u_blend;
${NOISE_GLSL}
${HUE_ROTATE_GLSL}
void main() {
  float s = 1.0 - u_scale * u_delta;
  float a = u_rotate * (3.14159265 / 180.0) * u_delta;
  float ca = cos(a), sa = sin(a);
  vec2 c = vUv - 0.5;
  vec2 from = vec2(ca * c.x - sa * c.y, sa * c.x + ca * c.y) * s + 0.5;

  // 噪声漂移：拖尾会卷开，而不是沿缩放/旋转路径硬滑。
  if (u_warp > 0.0) {
    float nx = fbm(vUv * 3.0 + u_time * 0.15);
    float ny = fbm(vUv * 3.0 - u_time * 0.12 + 17.0);
    from += (vec2(nx, ny) - 0.5) * u_warp * 0.5 * u_delta;
  }

  vec4 prev = texture(u_feedback, clamp(from, 0.0, 1.0));
  if (u_hue != 0.0) prev.rgb = hueRotate(prev.rgb, u_hue * u_delta);
  prev *= pow(1.0 - u_decay * 0.06, u_delta * 60.0);

  vec4 fresh = texture(u_texture, vUv);
  vec3 col = u_blend == 1
      ? 1.0 - (1.0 - fresh.rgb) * (1.0 - prev.rgb)
      : u_blend == 2 ? fresh.rgb + prev.rgb : max(fresh.rgb, prev.rgb);
  outColor = vec4(clamp(col, 0.0, 1.0), clamp(max(fresh.a, prev.a), 0.0, 1.0));
}`,
  feedback: true,
  setUniforms: compose(
    floats('decay', 'scale', 'rotate', 'warp', 'hue'),
    selectInt('blend', { max: 0, screen: 1, add: 2 }),
  ),
};

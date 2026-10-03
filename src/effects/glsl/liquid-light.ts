import { floats, HUE_ROTATE_GLSL, NOISE_GLSL, type EffectShaderDef } from '../shader-def';

/**
 * 液体光：域扭曲的胞元场 + 折射 + 薄膜虹彩 + 染料沿场漂移。
 *
 * 移植自 openmosh `gl/effect-shaders.ts` 的 `liquid-light`（MIT，见 CREDITS.md）。
 *
 * - **源文件又声明了一次 `uniform vec2 u_resolution;` → 删掉**（第 7 次）。
 * - `linearFilter: true`：重采样变形，NEAREST 会出块状锯齿。
 * - 法线用**同一个** warp 的偏移样本算，所以只多两次噪声查询而不是六次。
 * - 折射按通道给不同强度，每个胞元边缘会开出一圈湿的色边。
 */
export const shader: EffectShaderDef = {
  fragment: `
uniform float u_scale;
uniform float u_flow;
uniform float u_refraction;
uniform float u_dispersion;
${NOISE_GLSL}
${HUE_ROTATE_GLSL}
void main() {
  vec2 aspect = vec2(u_resolution.x / max(u_resolution.y, 1.0), 1.0);
  float t = u_time * (0.04 + u_flow * 0.5);
  float freq = 1.0 + (1.0 - u_scale) * 11.0;
  vec2 p = vUv * aspect * freq;

  // 域扭曲：慢速向量场带着胞元场走，于是斑块是「爬行、合并」，
  // 像水面上的油，而不是原地沸腾。
  vec2 w = 2.2 * vec2(fbm(p + vec2(0.0, t)), fbm(p + vec2(5.2, 1.3) - t * 0.6));

  vec2 e = (2.0 / u_resolution) * aspect * freq;
  float f = fbm(p + w);
  vec2 grad = vec2(fbm(p + w + vec2(e.x, 0.0)) - f, fbm(p + w + vec2(0.0, e.y)) - f);
  float slope = length(grad);
  vec2 n = grad / max(slope, 1e-4);

  vec2 dir = n * min(slope * 16.0, 1.0) * u_refraction * 0.3;
  float d = u_dispersion * 0.7;
  vec3 fresh;
  fresh.r = texture(u_texture, clamp(vUv - dir * (1.0 + d), vec2(0.0), vec2(1.0))).r;
  fresh.g = texture(u_texture, clamp(vUv - dir, vec2(0.0), vec2(1.0))).g;
  fresh.b = texture(u_texture, clamp(vUv - dir * (1.0 - d), vec2(0.0), vec2(1.0))).b;
  float freshA = max(texture(u_texture, clamp(vUv - dir * (1.0 + d), vec2(0.0), vec2(1.0))).a,
                     texture(u_texture, clamp(vUv - dir * (1.0 - d), vec2(0.0), vec2(1.0))).a);

  // 薄膜虹彩骑在场值上，边缘最强。
  float rim = min(slope * 24.0, 1.0);
  fresh = mix(fresh, hueRotate(fresh, f * 220.0 + t * 40.0), rim * u_dispersion);

  // 染料沿场漂移（垂直于梯度），并愈合回实时输入，所以这层水洗永远埋不掉源。
  vec2 from = clamp(vUv - vec2(-n.y, n.x) * u_delta * u_flow * 0.05, vec2(0.0), vec2(1.0));
  vec4 prevS = texture(u_feedback, from);
  float heal = 1.0 - exp(-mix(6.0, 1.2, u_flow) * u_delta);
  outColor = vec4(clamp(mix(prevS.rgb, fresh, heal), 0.0, 1.0),
                  clamp(mix(prevS.a, freshA, heal), 0.0, 1.0));
}`,
  feedback: true,
  linearFilter: true,
  setUniforms: floats('scale', 'flow', 'refraction', 'dispersion'),
};

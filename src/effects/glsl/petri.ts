import { floats, HASH_PLAIN_GLSL, type EffectShaderDef } from '../shader-def';

/**
 * 培养皿：三种试剂装在 RGB 里做循环反应（红吃绿、绿吃蓝、蓝吃红），
 * 每个胞元与邻域均值反应 —— 那个空间耦合才把螺旋波卷出来。
 *
 * 移植自 openmosh `gl/effect-shaders.ts` 的 `petri`（MIT，见 CREDITS.md）。
 *
 * **这是 `hdrFeedback` 的唯一使用者**：它的逐帧增量（`next - avg` 那一项）
 * 在 8bit 下会被量化步长抹平，反应直接 stall 成色块，所以历史缓冲必须是
 * RGBA16F（`hdrFeedback: true` → `Target({ float: true })`）。缺
 * `EXT_color_buffer_float` 时会安静回落到 RGBA8，那种情况下它会退化 —— 这是
 * 已知的、有意的降级路径。
 *
 * 三个设计点（上游注释写明的）：
 * - 三个增量**精确求和为零**，总浓度守恒，所以没有任何一种试剂能全局胜出 ——
 *   旋钮推到底也不会漂成一片单色。
 * - 漂移是**纯输运**（不产生试剂），所以它只卷波、不会染色。
 * - 一点点噪声用来给螺旋「起核」，否则平坦区会锁死在一个死状态里。
 *
 * hash 用 `HASH_PLAIN_GLSL`（上游那份就是不掺 seed 的），时间变化由 `fract(u_time)` 给。
 */
export const shader: EffectShaderDef = {
  fragment: `
uniform float u_reaction;
uniform float u_drift;
uniform float u_scale;
uniform float u_takeover;
${HASH_PLAIN_GLSL}
void main() {
  vec2 px = (1.0 + u_scale * 3.0) / u_resolution;
  vec3 avg = vec3(0.0);
  float avgA = 0.0;
  for (int y = -1; y <= 1; y++) {
    for (int x = -1; x <= 1; x++) {
      vec2 uv = clamp(vUv + vec2(float(x), float(y)) * px, vec2(0.0), vec2(1.0));
      avg += texture(u_feedback, uv).rgb;
      avgA += texture(u_feedback, uv).a;
    }
  }
  avg /= 9.0;
  avgA /= 9.0;

  // 每种试剂沿自己的航向漂移，相隔 120°、缓慢旋转，于是它们互相追逐而不是静止
  float curl = (u_drift - 0.5) * 2.0;
  float a = u_time * 0.15;
  float reach = 2.5 * curl;
  vec3 drift;
  drift.r = texture(u_feedback, clamp(vUv + vec2(cos(a), sin(a)) * px * reach, vec2(0.0), vec2(1.0))).r;
  drift.g = texture(u_feedback, clamp(vUv + vec2(cos(a + 2.0944), sin(a + 2.0944)) * px * reach, vec2(0.0), vec2(1.0))).g;
  drift.b = texture(u_feedback, clamp(vUv + vec2(cos(a + 4.1888), sin(a + 4.1888)) * px * reach, vec2(0.0), vec2(1.0))).b;
  avg = mix(avg, drift, 0.6 * abs(curl));

  // 循环反应：三个增量精确求和为零 → 总浓度守恒
  float k = clamp(u_delta * 60.0, 0.4, 2.0) * (0.4 + u_reaction * 1.6);
  vec3 next;
  next.r = avg.r + avg.r * (avg.g - avg.b) * k;
  next.g = avg.g + avg.g * (avg.b - avg.r) * k;
  next.b = avg.b + avg.b * (avg.r - avg.g) * k;

  next += (hash(vUv * u_resolution + fract(u_time)) - 0.5) * 0.004;
  next = clamp(next, 0.0, 1.0);

  // 画面作为试剂浓度喂回来，化学就从图像自己的颜色里长出来。
  // takeover 低 → 愈合快（画面可读、结构淡）；高 → 反应跑飞。
  vec4 srcS = texture(u_texture, vUv);
  vec3 src = srcS.rgb;
  float seed = 1.0 - exp(-mix(7.0, 0.22, u_takeover) * u_delta);
  outColor = vec4(clamp(mix(next, src, seed), 0.0, 1.0),
                  clamp(mix(avgA, srcS.a, seed), 0.0, 1.0));
}`,
  feedback: true,
  hdrFeedback: true,
  setUniforms: floats('reaction', 'drift', 'scale', 'takeover'),
};

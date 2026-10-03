import { colors, compose, floats, selectInt, type EffectShaderDef } from '../shader-def';

/**
 * 频谱条：把音频的频谱画成一条条竖条。
 *
 * 移植自 openmosh `gl/effect-shaders.ts` 的 `audio-bars`（MIT，见 CREDITS.md）。
 *
 * **`u_spectrum` 由 runner 绑定**（见 `engine/spectrum-texture.ts`）：数据是
 * 「已经做过滚动归一化 + 按实例包络平滑」的 0..255 linear-frequency bin，
 * 所以着色器这边只负责几何与上色，不碰归一化。
 *
 * 两个照抄会错的地方：
 * 1. **低频下标要平方**（`lo = idx²`）。低频在一段线性 FFT 里只占很小一截，
 *    线性取样会让第一个 bar 之外的所有 bar 大部分时间都是死的。
 * 2. **`punch` 传的是指数，不是原值** —— `punchExponent(p) = 0.5 + p × 2.5`。
 *    低于 1 把安静处的细节提上来，高于 1 只留大击打。
 *
 * 一根 bar 覆盖的 bin 跨距上取 8 个 tap 的**最大值**而不是均值 ——
 * 均值会糊成一团。
 */
export const shader: EffectShaderDef = {
  fragment: `
uniform sampler2D u_spectrum;
uniform float u_bars;
uniform float u_height;
uniform float u_gain;
uniform float u_punch;
uniform float u_opacity;
uniform int u_anchor;
uniform int u_style;
uniform vec3 u_color;
void main() {
  vec4 src = texture(u_texture, vUv);
  float bars = max(floor(u_bars), 1.0);
  float slot = vUv.x * bars;
  float idx = floor(slot) / bars;

  // 低频只占线性 FFT 的一小截，把下标平方是把大部分宽度让给低端
  float lo = idx * idx;
  float hi = (idx + 1.0 / bars) * (idx + 1.0 / bars);
  float level = 0.0;
  for (int i = 0; i < 8; i++) {
    float f = mix(lo, hi, (float(i) + 0.5) / 8.0);
    // 取这一根 bar 跨的 bin 的峰值，不是均值 —— 均值读起来是一坨
    level = max(level, texture(u_spectrum, vec2(f, 0.5)).r);
  }
  level = clamp(pow(level, u_punch) * u_gain, 0.0, 1.0) * u_height;

  // vUv.y 自上而下，所以锚到底部要反过来量
  float d = u_anchor == 1 ? vUv.y
          : u_anchor == 2 ? abs(vUv.y - 0.5) * 2.0
          : 1.0 - vUv.y;

  float within = fract(slot);
  float gap = smoothstep(0.0, 0.10, within) * (1.0 - smoothstep(0.90, 1.0, within));
  float fill = (1.0 - smoothstep(level - 0.004, level + 0.004, d)) * gap;
  if (u_style == 1) {
    float seg = fract(d * 26.0);
    fill *= 1.0 - smoothstep(0.55, 0.75, seg);
  }

  // 顶端提亮：一条纯色柱子读起来是一张死掉的柱状图
  float tip = 1.0 + 0.8 * (1.0 - smoothstep(0.0, 0.12, max(level - d, 0.0)));
  vec3 col = clamp(u_color * tip, 0.0, 1.0);
  outColor = vec4(mix(src.rgb, col, clamp(fill, 0.0, 1.0) * u_opacity), src.a);
}`,
  setUniforms: compose(
    floats('bars', 'height', 'gain', 'opacity'),
    // punch 传指数，不是原值
    (gl, l, v) => {
      const loc = l['u_punch'];
      if (loc) gl.uniform1f(loc, 0.5 + Math.max(0, Math.min(1, Number(v.punch) || 0)) * 2.5);
    },
    selectInt('anchor', { bottom: 0, top: 1, center: 2 }),
    selectInt('style', { solid: 0, segmented: 1 }),
    colors('color'),
  ),
};

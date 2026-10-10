import { floats, type EffectShaderDef } from '../shader-def';

/**
 * 扫描线：按屏幕行做正弦暗化。
 *
 * ## 相位必须先归约到 [0, 2π)（2026-10-10）
 *
 * `sin(大参数)` 是 GPU 近似实现的软肋：自变量到了几百弧度（这里
 * `vUv.y * u_resolution.y * π / u_spacing` 在 720p 下就是几百）之后，低位被
 * 实现精度吃掉，**同一份输入在不同驱动状态下会给出不同结果**。
 * 实测（lab，t 固定、参数固定）：启动初期的几次求值里同帧两渲会差几个像素
 * （`lab.spec.ts` 的「非反馈特效同帧可复现」就是在那里翻的车）。
 *
 * `mod` 不改变波形（sin 以 2π 为周期），只把自变量拉回小范围 ——
 * 这是数值稳定性的修复，不是视觉改动。
 *
 * ⚠️ **但实测它并不是 `lab.spec.ts` 那条 diff 的来源**：相位归约之后
 * 「mandelbrot + scanlines」在启动窗口内仍会出两个稳定态（n=177、delta ≤ 5）。
 * 那条 diff 来自别处 —— 见 `engine/compositor.ts::placeLayer` 附近的说明
 * （源尺寸与帧尺寸成**非整数比**时的纹理采样精度）。保留这次归约是因为
 * 大参数 sin 本身确实是隐患，且这里数学等价、零风险。
 *
 * ⚠️ 模板字符串里不能出现反引号（GLSL 注释里也不行）：它会提前结束字符串，
 * 报成「Expected "}" but found ...」这种与真实原因无关的构建错误。
 */
export const shader: EffectShaderDef = {
  fragment: `
uniform float u_intensity;
uniform float u_spacing;
void main() {
  vec4 c = texture(u_texture, vUv);
  float phase = mod(vUv.y * u_resolution.y * 3.141592653589793 / u_spacing, 6.283185307179586);
  float s = 1.0 - u_intensity * (0.5 + 0.5 * sin(phase));
  outColor = vec4(c.rgb * s, c.a);
}`,
  setUniforms: floats('intensity', 'spacing'),
};

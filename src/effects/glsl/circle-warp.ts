import { floats, type EffectShaderDef } from '../shader-def';

/**
 * 圆筒变形：把画面的高度折进一个圆里（圆外为黑）。
 *
 * 移植自 openmosh `gl/effect-shaders.ts` 的 `circle-warp`，
 * 二级来源 Vidvox/ISF-Files（MIT，见 CREDITS.md）。
 *
 * **移植期的坑**：源文件在自己的 fragment 里又声明了一次
 * `uniform vec2 u_resolution;`，而 Artmatic 的 `EFFECT_HEAD` 已经声明过 ——
 * 照抄会重复定义直接编译失败。这里删掉了那一行。
 *
 * `linearFilter: true`：它是重采样变形，默认的 NEAREST 会出块状锯齿。
 */
export const shader: EffectShaderDef = {
  fragment: `
uniform float u_radius;
uniform float u_width;
uniform float u_rotation;
void main() {
  vec2 ct = vec2(0.5);
  vec2 pt = vUv;
  pt.x = (pt.x - 0.5) / u_width + 0.5;
  // 方形坐标：短边铺满 [0,1]，长边居中
  vec2 r = u_resolution;
  pt = r.x >= r.y
    ? vec2((pt.x * r.x - r.x * 0.5 + r.y * 0.5) / r.y, pt.y)
    : vec2(pt.x, (pt.y * r.y - r.y * 0.5 + r.x * 0.5) / r.x);
  float a = u_rotation * 6.28318530718;
  vec2 d = pt - ct;
  pt = vec2(d.x * cos(a) - d.y * sin(a), d.x * sin(a) + d.y * cos(a)) + ct;
  if (distance(pt, ct) >= u_radius) {
    outColor = vec4(0.0);
    return;
  }
  float chord = 2.0 * sqrt(max(u_radius * u_radius - (pt.x - 0.5) * (pt.x - 0.5), 1e-6));
  pt.y = (pt.y - 0.5) / chord + 0.5;
  outColor = texture(u_texture, pt);
}`,
  linearFilter: true,
  setUniforms: floats('radius', 'width', 'rotation'),
};

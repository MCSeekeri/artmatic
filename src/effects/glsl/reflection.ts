import { floats, type EffectShaderDef } from '../shader-def';

/**
 * 水面倒影：分界线以下把画面镜像过来，再用行波涟漪揉开，波纹越往下越大越淡。
 *
 * 移植自 openmosh `lab/shaders/pixi/Reflection.fs`，
 * 上游是 PixiJS 的 `ReflectionFilter` 的 ISF 端口（MIT，见 CREDITS.md）。
 *
 * 三处口径：
 * - `TIME * speed` → `u_time * u_speed`（ISF 的 `TIME` 就是秒，不走相位折算）。
 * - `amp` 与 `wl` 都除以分辨率：振幅按**宽度**归一、波长按**高度**归一 ——
 *   这样竖条的波纹在宽画幅上仍然是几何自洽的（照抄即可，别"统一"成同一个轴）。
 * - 上游把反射区的 alpha 写死 1.0；这里**保留链输入的覆盖**（项目惯例）——
 *   不透明素材上完全一致，但文字层上不会把整帧填满。
 *   `alphaMin` / `alphaMax` 是**亮度**衰减，不是透明度（上游就是这么用的）。
 */
export const shader: EffectShaderDef = {
  fragment: `
uniform float u_boundary;
uniform float u_mirror;
uniform float u_ampMin;
uniform float u_ampMax;
uniform float u_waveMin;
uniform float u_waveMax;
uniform float u_alphaMin;
uniform float u_alphaMax;
uniform float u_speed;
void main() {
  vec4 src = texture(u_texture, vUv);
  if (vUv.y < u_boundary) {
    outColor = src;
    return;
  }

  // 0 → 分界处，1 → 画面底部
  float k = (vUv.y - u_boundary) / (1.0 - u_boundary + 0.0001);
  // 镜像：把 y 折回去
  float v = u_boundary + u_boundary - vUv.y;
  float y = u_mirror > 0.5 ? v : vUv.y;

  float amp = mix(u_ampMin, u_ampMax, k) / u_resolution.x;
  float wl = mix(u_waveMin, u_waveMax, k) / u_resolution.y;
  float al = mix(u_alphaMin, u_alphaMax, k);

  float x = vUv.x + cos(v * 6.2831853 / wl - u_time * u_speed) * amp;
  x = clamp(x, 0.0, 1.0);

  vec4 color = texture(u_texture, vec2(x, y));
  outColor = vec4(color.rgb * al, src.a);
}`,
  setUniforms: floats(
    'boundary',
    'mirror',
    'ampMin',
    'ampMax',
    'waveMin',
    'waveMax',
    'alphaMin',
    'alphaMax',
    'speed',
  ),
};

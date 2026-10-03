import { floats, HASH_PLAIN_GLSL, type EffectShaderDef } from '../shader-def';

/**
 * 行列偏移：列按所在行做正弦/线性错位，行再按**错位后的**列错位（上游如此）。
 *
 * 移植自 openmosh `gl/effect-shaders.ts` 的 `pixel-shifter`，
 * 二级来源 Vidvox/ISF-Files（MIT，见 CREDITS.md）。
 *
 * **这个特效没有 `speed` 参数**，所以 openmosh 侧 `u_time` 就是秒 ——
 * 这边同样传秒，不需要相位处理。
 * hash 用 `HASH_PLAIN_GLSL`：图案要随时间平滑爬行，掺 seed 会变成逐帧闪烁。
 */
export const shader: EffectShaderDef = {
  fragment: `
uniform float u_hPhase;
uniform float u_hFrequency;
uniform float u_hRandom;
uniform float u_vPhase;
uniform float u_vFrequency;
uniform float u_vRandom;
uniform float u_sinusoidal;
uniform float u_mirror;
const float PI = 3.14159265359;
${HASH_PLAIN_GLSL}
void main() {
  vec2 loc = vUv;
  float modVal = u_mirror > 0.5 ? 2.0 : 1.0;
  if (u_sinusoidal > 0.5) {
    loc.x = mod(u_hRandom * hash(vec2(u_time * 0.127, loc.x)) + loc.x
      + sign(u_hFrequency) * 0.5 * (1.0 + cos(2.0 * PI * (u_hPhase + u_hFrequency * loc.y))), modVal);
  } else {
    loc.x = mod(u_hRandom * hash(vec2(u_time * 0.129, loc.x)) + loc.x
      + u_hFrequency * loc.y + u_hPhase, modVal);
  }
  if (u_sinusoidal > 0.5) {
    loc.y = mod(u_vRandom * hash(vec2(u_time * 0.273, loc.y)) + loc.y
      + sign(u_vFrequency) * 0.5 * (1.0 + cos(2.0 * PI * (u_vPhase + u_vFrequency * loc.x))), modVal);
  } else {
    loc.y = mod(u_vRandom * hash(vec2(u_time * 0.341, loc.y)) + loc.y
      + u_vFrequency * loc.x + u_vPhase, modVal);
  }
  if (loc.x > 1.0) loc.x = 2.0 - loc.x;
  if (loc.y > 1.0) loc.y = 2.0 - loc.y;
  outColor = texture(u_texture, loc);
}`,
  setUniforms: floats(
    'hPhase',
    'hFrequency',
    'hRandom',
    'vPhase',
    'vFrequency',
    'vRandom',
    'sinusoidal',
    'mirror',
  ),
};

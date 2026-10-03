import { BLUR_H_PASS, BLUR_V_PASS, floats, type EffectShaderDef } from '../shader-def';

/**
 * 高斯模糊：横向 + 纵向两环 pre-pass，主 pass 只是把结果搬出来。
 *
 * 移植自 openmosh `gl/effect-shaders.ts` 的 `blur`（MIT，见 CREDITS.md）。
 *
 * **`radius` 只活在 pre-pass 里** —— 主 pass 一个 uniform 都不声明。
 * 这正好验证了「参数要派发到每个 pass」这条：只给主 pass 派发的话，
 * 这个特效的半径滑杆是完全无效的（而主 pass 看上去「没有参数」，很容易漏）。
 */
export const shader: EffectShaderDef = {
  prePasses: [
    { fragment: BLUR_H_PASS, linearFilter: true },
    { fragment: BLUR_V_PASS, linearFilter: true },
  ],
  fragment: `
void main() {
  outColor = texture(u_texture, vUv);
}`,
  setUniforms: floats('radius'),
};

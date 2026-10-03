import { floats, MATH_GLSL, type EffectShaderDef } from '../shader-def';

/**
 * 涂抹：把图像自身的红/绿通道当向量场，沿它走像素 —— 内容跟着**自己的颜色**
 * 流动，而不是被规定一个方向。`angle` 旋转这个场。
 *
 * 移植自 openmosh `gl/effect-shaders.ts` 的 `smear`（MIT，见 CREDITS.md）。
 * `trail` 从「只保留路径末端」（一次干净位移）渐变到「整条路径等权」（这才是涂抹）。
 */
export const shader: EffectShaderDef = {
  fragment: `
uniform float u_amount;
uniform float u_angle;
uniform float u_trail;

const int SMEAR_STEPS = 8;
${MATH_GLSL}
void main() {
  float rad = u_angle * 3.14159265 / 180.0;
  float ca = cos(rad);
  float sa = sin(rad);
  mat2 rot = mat2(ca, -sa, sa, ca);
  float stride = u_amount * 0.2 / float(SMEAR_STEPS);

  vec2 p = vUv;
  vec4 acc = vec4(0.0);
  float total = 0.0;
  for (int i = 0; i < SMEAR_STEPS; i++) {
    vec4 s = texture(u_texture, vec2(bounce(p.x), bounce(p.y)));
    float t = float(i) / float(SMEAR_STEPS - 1);
    float w = mix(pow(t, 16.0), 1.0, u_trail);
    acc += s * w;
    total += w;
    // 每步重新读一次场，走位就随图像弯曲而不是走直线，条纹会顺着轮廓从边缘拉出来
    p += rot * (s.rg - 0.5) * stride;
  }
  outColor = acc / max(total, 1e-4);
}`,
  setUniforms: floats('amount', 'angle', 'trail'),
};

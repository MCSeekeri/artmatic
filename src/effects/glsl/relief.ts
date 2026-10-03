import { floats, type EffectShaderDef } from '../shader-def';

/**
 * 视差浮雕：把亮度当高度场，沿光照方向做视差遮蔽步进（64 步）。
 *
 * 移植自 openmosh `gl/effect-shaders.ts` 的 `relief`（MIT，见 CREDITS.md）。
 *
 * **本批最重的一个**：每个像素 64 次纹理采样。`N` 是编译期常量，所以循环可展开，
 * 但代价仍然真实 —— 目视验收时要确认它不卡。
 * 记录上一格与当前格的交点并线性插值，脊线才是平滑的而不是阶梯。
 */
export const shader: EffectShaderDef = {
  fragment: `
uniform float u_amount;
uniform float u_angle;

void main() {
  vec3 lum = vec3(0.299, 0.587, 0.114);

  float rad = u_angle * 3.14159265 / 180.0;
  vec2 dir = vec2(cos(rad), sin(rad));

  const int N = 64;
  vec2  stepUV = dir * u_amount / float(N);
  float stepH  = 1.0 / float(N);

  vec2  pos      = vUv;
  float rayH     = 1.0;
  vec2  prevPos  = vUv;
  float prevSurfH = dot(texture(u_texture, vUv).rgb, lum);
  vec2  hitPos   = vUv;
  bool  found    = false;

  for (int i = 0; i < N; i++) {
    float surfH = dot(texture(u_texture, pos).rgb, lum);
    if (!found && surfH >= rayH) {
      float prevRayH = rayH + stepH;
      float t = (prevRayH - prevSurfH) / max((surfH - prevSurfH) - (rayH - prevRayH), 0.0001);
      hitPos = mix(prevPos, pos, clamp(t, 0.0, 1.0));
      found  = true;
    }
    prevPos   = pos;
    prevSurfH = surfH;
    pos  += stepUV;
    rayH -= stepH;
  }

  outColor = texture(u_texture, hitPos);
}`,
  setUniforms: floats('amount', 'angle'),
};

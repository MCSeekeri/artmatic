import { compose, floats, selectInt, type EffectShaderDef } from '../shader-def';

/**
 * 通道错位·扩展：openmosh 的 `channel-split` 的**径向**与**棱镜**两个模式。
 *
 * 移植自 openmosh `gl/effect-shaders.ts` 的 `channel-split`（MIT，见 CREDITS.md）。
 * 现有 `channel-split`（线性版）保持不动 —— 上游的 `angle` 是**度**而现有实现是
 * **弧度**，直接替换会让旧工程里存的 1.5708（本意 90°）变成 1.57°，属于静默数据破坏。
 *
 * `linear` 的分支**保留在着色器里**但不在下拉里出现：未知 mode 会经
 * `selectInt` 的 fallback 落到 0，也就是这个分支。
 *
 * 相位：`float t = u_time * u_speed;` —— 上游因为 def 里有 `speed` 而给它累积相位，
 * 所以上游实际是 `speed²` 的效果（那是个 quirk）。这里按**意图**走单次相乘，
 * `speed = 1` 时与上游完全一致，其余速度下手感是线性的。
 */
export const shader: EffectShaderDef = {
  fragment: `
uniform int u_mode;
uniform float u_amount;
uniform float u_angle;
uniform float u_falloff;
uniform float u_saturation;
uniform float u_speed;
void main() {
  vec2 px = 1.0 / vec2(textureSize(u_texture, 0));

  if (u_mode == 0) {
    // 线性：沿角度做等量偏移（下拉里没有这一项，仅作未知 mode 的降级）
    float rad = u_angle * 3.14159265 / 180.0;
    vec2 d = vec2(cos(rad), sin(rad)) * u_amount * px;
    outColor = vec4(
      texture(u_texture, vUv + d).r,
      texture(u_texture, vUv).g,
      texture(u_texture, vUv - d).b,
      texture(u_texture, vUv).a
    );
  } else if (u_mode == 1) {
    // 径向：从中心往外偏移，越靠边越强
    vec2 center = vec2(0.5);
    vec2 dir = vUv - center;
    float dist = length(dir);
    float strength = u_amount * pow(dist, 1.0 + u_falloff * 3.0) * 0.002;
    vec2 offset = normalize(dir + 1e-6) * strength;
    outColor = vec4(
      texture(u_texture, vUv + offset).r,
      texture(u_texture, vUv).g,
      texture(u_texture, vUv - offset).b,
      texture(u_texture, vUv).a
    );
  } else {
    // 棱镜：位置相关的色散 + 色相旋转，带漂移
    float t = u_time * u_speed;
    float rad = u_angle * 3.14159265 / 180.0;
    vec2 dir = vec2(cos(rad), sin(rad));
    float pos = dot(vUv - 0.5, dir);
    float disp = u_amount * 0.0016;
    float drift = sin(t * 0.3) * 0.5;
    vec2 uvR = vUv - dir * disp * (pos + drift);
    vec2 uvB = vUv + dir * disp * (pos + drift);
    float r = texture(u_texture, uvR).r;
    float g = texture(u_texture, vUv).g;
    float b = texture(u_texture, uvB).b;
    // 三个 tap 里最宽的覆盖，分裂后的文字层才不会丢通道
    float a = max(texture(u_texture, uvR).a,
                  max(texture(u_texture, vUv).a, texture(u_texture, uvB).a));
    vec3 color = vec3(r, g, b);
    float hueShift = pos * u_amount * 0.1 + t * 0.2;
    float cosH = cos(hueShift);
    float sinH = sin(hueShift);
    vec3 k = vec3(0.57735);
    vec3 rotated = color * cosH + cross(k, color) * sinH + k * dot(k, color) * (1.0 - cosH);
    color = mix(color, rotated, u_saturation);
    outColor = vec4(color, a);
  }
}`,
  setUniforms: compose(
    floats('amount', 'angle', 'falloff', 'saturation', 'speed'),
    selectInt('mode', { radial: 1, prismatic: 2 }, 0),
  ),
};

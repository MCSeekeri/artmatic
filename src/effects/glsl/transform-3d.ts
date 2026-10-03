import { compose, floats, MATH_GLSL, selectInt, type EffectShaderDef } from '../shader-def';

/**
 * 3D 变换：逐像素反向投射到旋转平面上（不是光栅化一个四边形）。
 *
 * 移植自 openmosh `gl/effect-shaders.ts` 的 `transform-3d`（MIT，见 CREDITS.md）。
 *
 * 三个要点：
 * - **`u_time = t`**：它的相位来自 `spin` 参数（自转速度），不是 `speed`，
 *   所以 openmosh 没有对它做累加 —— 这边也不做。
 * - `fwidth(uv)` 要在**地平线判定之前**取：导数只有在整个四边形都到达该处时
 *   才有定义，而它有一半马上要 bail out。顺序换了会有接缝。
 * - `edge` 的 0 号是「透明 + 一像素羽化」，不是「钳制」。
 */
export const shader: EffectShaderDef = {
  fragment: `
uniform float u_rotX;
uniform float u_rotY;
uniform float u_rotZ;
uniform float u_perspective;
uniform float u_zoom;
uniform float u_spin;
uniform int u_axis;
uniform int u_edge;

const float DEG = 0.017453292;
${MATH_GLSL}
mat3 rotateX(float a) { float c = cos(a), s = sin(a);
  return mat3(1.0, 0.0, 0.0, 0.0, c, s, 0.0, -s, c); }
mat3 rotateY(float a) { float c = cos(a), s = sin(a);
  return mat3(c, 0.0, -s, 0.0, 1.0, 0.0, s, 0.0, c); }
mat3 rotateZ(float a) { float c = cos(a), s = sin(a);
  return mat3(c, s, 0.0, -s, c, 0.0, 0.0, 0.0, 1.0); }

void main() {
  vec2 res = vec2(textureSize(u_texture, 0));
  float aspect = res.x / res.y;

  float t = u_time * u_spin * DEG;
  float sx = u_axis == 0 ? t : (u_axis == 3 ? t * 0.43 : 0.0);
  float sy = u_axis == 1 ? t : (u_axis == 3 ? t : 0.0);
  float sz = u_axis == 2 ? t : (u_axis == 3 ? t * 0.17 : 0.0);
  mat3 R = rotateZ(u_rotZ * DEG + sz) * rotateY(u_rotY * DEG + sy)
         * rotateX(u_rotX * DEG + sx);

  // 焦距：低端接近正交（平推），高端是广角（近边扑向镜头）。
  // 平面正好落在 f 处，所以无论什么焦距，未倾斜的四边形都恰好铺满画幅。
  float f = mix(8.0, 0.9, u_perspective);
  vec3 center = vec3(0.0, 0.0, f / max(u_zoom, 0.001));

  vec3 dir = vec3((vUv - 0.5) * 2.0 * vec2(aspect, 1.0), f);
  vec3 n = R * vec3(0.0, 0.0, 1.0);
  float denom = dot(n, dir);
  float k = dot(n, center) / denom;
  vec3 q = transpose(R) * (k * dir - center);
  vec2 uv = vec2(q.x / aspect, q.y) * 0.5 + 0.5;
  vec2 w = clamp(fwidth(uv), vec2(1e-4), vec2(0.1));
  if (abs(denom) < 1e-5 || k <= 0.0) { outColor = vec4(0.0); return; }

  if (u_edge == 1) {
    outColor = texture(u_texture, clamp(uv, 0.0, 1.0));
  } else if (u_edge == 2) {
    outColor = texture(u_texture, fract(uv));
  } else if (u_edge == 3) {
    outColor = texture(u_texture, vec2(bounce(uv.x), bounce(uv.y)));
  } else {
    // 按**变形后**的 uv 的一像素羽化，退到远处的那条边才不会成阶梯。
    vec2 e = smoothstep(vec2(0.0), w, uv) * smoothstep(vec2(0.0), w, 1.0 - uv);
    float cov = e.x * e.y;
    if (cov <= 0.0) { outColor = vec4(0.0); return; }
    vec4 c = texture(u_texture, clamp(uv, 0.0, 1.0));
    outColor = vec4(c.rgb, c.a * cov);
  }
}`,
  linearFilter: true,
  setUniforms: compose(
    floats('rotX', 'rotY', 'rotZ', 'perspective', 'zoom', 'spin'),
    selectInt('axis', { x: 0, y: 1, z: 2, tumble: 3 }, 1),
    selectInt('edge', { none: 0, clamp: 1, tile: 2, mirror: 3 }),
  ),
};

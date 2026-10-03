import { floats, HASH_PLAIN_GLSL, type EffectShaderDef } from '../shader-def';

/**
 * 数据弯折：按宏块栅格模拟「字节流损坏」—— 连续块的游程被破坏之后，
 * 后面的内容会**持续侧移**（这是 databend 的招牌特征）。
 *
 * 移植自 openmosh `gl/effect-shaders.ts` 的 `data-bend`（MIT，见 CREDITS.md）。
 *
 * - **相位自己乘**：`floor(u_time * u_speed * 0.8)`。上游的 `floor(u_time * 0.8)`
 *   依赖引擎把 `speed` 折进 u_time；不乘的话 `speed` 完全失效。
 * - 布局要**保持**（粗粒度量化），所以是 `floor` 而不是连续 `u_time`。
 * - hash 用 `HASH_PLAIN_GLSL`（逐 tick 稳定）；`hrot` 是弧度版，保留自带。
 */
export const shader: EffectShaderDef = {
  fragment: `
uniform float u_intensity;
uniform float u_corruption;
uniform float u_channelShift;
uniform float u_speed;
${HASH_PLAIN_GLSL}
vec3 hrot(vec3 c, float a) {
  float ca = cos(a), sa = sin(a);
  vec3 k = vec3(0.57735);
  return c*ca + cross(k,c)*sa + k*dot(k,c)*(1.0-ca);
}
void main() {
  vec2 res = vec2(textureSize(u_texture, 0));
  // 损坏布局要持续存在：把相位时间粗量化
  float t = floor(u_time * u_speed * 0.8);

  // 宏块栅格（光栅序，像文件里的字节）
  float gridW = 40.0;
  float gridH = max(4.0, floor(gridW * res.y / res.x));
  vec2 grid = vec2(gridW, gridH);
  vec2 bc = floor(vUv * grid);
  vec2 local = fract(vUv * grid);
  float bIdx = bc.y * gridW + bc.x;
  float total = gridW * gridH;

  float numZones = floor(2.0 + u_corruption * 10.0);

  vec2 readBlock = bc;
  vec2 readLocal = local;
  float rasterShift = 0.0;
  float garbage = 0.0;
  float hueG = 0.0;

  for (float i = 0.0; i < 12.0; i++) {
    if (i >= numZones) break;
    // 损坏区是光栅序上**连续**的一段块，跨行折返，像损坏的字节流
    float zStart = floor(hash(vec2(i, t)) * total);
    float zLen = floor((0.01 + hash(vec2(i + 50.0, t)) * 0.06)
      * total * (0.3 + u_intensity));
    float zEnd = zStart + zLen;

    // databend 的招牌：坏字节**之后**的内容在整个区间存活期内一直侧移
    if (bIdx >= zEnd) {
      rasterShift += floor((hash(vec2(i * 3.0, t + 7.0)) - 0.5)
        * u_intensity * 7.0);
    }

    if (bIdx >= zStart && bIdx < zEnd) {
      float fate = hash(vec2(i * 11.0, t + 3.0));
      if (fate < 0.45) {
        float srcIdx = mod(bIdx + floor((hash(vec2(i * 5.0, t)) - 0.5)
          * total * 0.5) + total, total);
        readBlock = vec2(mod(srcIdx, gridW), floor(srcIdx / gridW));
      } else if (fate < 0.75) {
        // 涂抹：整块重复它自己的第一行（JPEG 拖尾）
        readLocal.y = readLocal.y * 0.08;
      } else {
        // 垃圾块：色阶量化 + 色相乱转，内容还横向错位
        garbage = 1.0;
        hueG = hash(vec2(i * 7.0, t + 9.0)) * 6.28;
        readBlock.x = mod(readBlock.x + floor(hash(vec2(i, t + 4.0)) * 8.0), gridW);
      }
    }
  }

  float rIdx = readBlock.y * gridW + readBlock.x + rasterShift;
  rIdx = clamp(rIdx, 0.0, total - 1.0);
  vec2 rb = vec2(mod(rIdx, gridW), floor(rIdx / gridW));
  vec2 uv = (rb + readLocal) / grid;

  // RGB 字节错位：通道各偏若干分之一块
  float co = u_channelShift * 2.5 / gridW;
  vec3 col;
  col.r = texture(u_texture, clamp(uv, vec2(0.0), vec2(1.0))).r;
  col.g = texture(u_texture, clamp(uv + vec2(co, 0.0), vec2(0.0), vec2(1.0))).g;
  col.b = texture(u_texture, clamp(uv + vec2(co * 2.0, 0.0), vec2(0.0), vec2(1.0))).b;
  float alpha = texture(u_texture, clamp(uv, vec2(0.0), vec2(1.0))).a;

  if (garbage > 0.5) {
    col = floor(col * 5.0) / 5.0;
    col = hrot(col, hueG);
  }
  outColor = vec4(col, alpha);
}`,
  setUniforms: floats('intensity', 'corruption', 'channelShift', 'speed'),
};

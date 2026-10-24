import { compose, floats, selectInt, type EffectShaderDef } from '../shader-def';

/**
 * 缩小居中：底图不动，正中间叠一层缩小后的整帧；再缩一次、再叠一层……
 *
 * 每一层放的**都是整帧画面**（不是上一层的结果）。所以「重复 3 次」在画面上
 * 就是 3 个同心框，看得到 3 条边 —— 而不是无限镜屋那种「每层里再套一整套」。
 * 实现上只需要：找到包含当前像素的**最内层**，把它一次映射回整帧。
 *
 * 早期版本把每命中一层都映射一次（等价于递归定义 L(i)=缩放(L(i-1))），
 * 结果是画面上多出成倍的层次，「重复次数」变得数不清 —— 已改回单次映射。
 *
 * ## 坐标空间
 *
 * 一律在「按帧高归一化、原点在帧中心」的空间里算：x ∈ [-aspect/2, aspect/2]、
 * y ∈ [-0.5, 0.5]。这样「等距步进」四边的内缩是**等像素**的（帧本身不是方的，
 * 直接在 uv 空间里减同一个数会让横竖内缩不等，画面看起来像被拉过）。
 *
 * ## 两种步进
 *
 * - 等比（ratio）：每层尺寸 ×`scale`，层层相似 —— 参考图左边那样，四角连线笔直。
 * - 等距（inset）：每层四边各内缩 `inset`（占帧高的比例），长宽每次减掉同一个
 *   像素数 ⇒ 越往里越扁，参考图右边那样。
 *
 * `decay` 作用在**步进幅度**上：第 i 步 = 基础步长 × (1-decay)^(i-1)，
 * 于是步长逐层变小、层次往中心挤（有透视感）。0 = 每步一样大。
 */
export const shader: EffectShaderDef = {
  // 缩小是重度重采样：没有 LINEAR 的话每层边界都是锯齿。
  linearFilter: true,
  fragment: `
uniform float u_scale;
uniform float u_inset;
uniform float u_count;
uniform float u_decay;
uniform float u_offsetX;
uniform float u_offsetY;
uniform int u_mode;

const int MAX_LEVELS = 12;

void main() {
  float levels = clamp(floor(u_count + 0.5), 0.0, float(MAX_LEVELS));
  if (levels < 0.5) {
    outColor = texture(u_texture, vUv);
    return;
  }

  float aspect = u_resolution.x / max(u_resolution.y, 1.0);
  vec2 halfFrame = vec2(aspect * 0.5, 0.5);
  // 与片段 transform.y 同一口径：+y 向上。
  vec2 center = vec2(u_offsetX * aspect, u_offsetY);

  float amp = 1.0;      // 当前这一层的步长倍率（逐层乘 1-decay）
  float scaleAcc = 1.0; // 等比：累计尺寸因子
  float insetAcc = 0.0; // 等距：累计内缩
  vec4 rects[MAX_LEVELS]; // xy = 中心，zw = 半宽半高

  for (int i = 0; i < MAX_LEVELS; i++) {
    if (float(i) >= levels) break;
    scaleAcc *= u_scale * amp;
    insetAcc += u_inset * amp;
    vec2 half_ = (u_mode == 0) ? halfFrame * scaleAcc : halfFrame - vec2(insetAcc);
    // 内缩过头的那一层（等距模式很容易）退化成空矩形，判定时跳过。
    rects[i] = vec4(center, max(half_, vec2(0.0)));
    amp *= 1.0 - u_decay;
  }

  // 层层包含 ⇒ 循环里**最后**命中的那个就是最内层。
  vec2 p = (vUv - 0.5) * vec2(aspect, 1.0);
  vec4 hit = vec4(0.0);
  for (int k = 0; k < MAX_LEVELS; k++) {
    if (float(k) >= levels) break;
    vec4 r = rects[k];
    if (r.z <= 1e-5 || r.w <= 1e-5) continue;
    vec2 d = p - r.xy;
    if (abs(d.x) <= r.z && abs(d.y) <= r.w) hit = r;
  }

  if (hit.z > 0.0) {
    // 这一层的局部坐标 → 整帧（把 rect 张满整帧）
    p = (p - hit.xy) * (halfFrame / hit.zw);
  }

  outColor = texture(u_texture, clamp(vec2(p.x / aspect, p.y) + 0.5, 0.0, 1.0));
}`,
  setUniforms: compose(
    floats('scale', 'inset', 'count', 'decay', 'offsetX', 'offsetY'),
    selectInt('mode', { ratio: 0, inset: 1 }),
  ),
};

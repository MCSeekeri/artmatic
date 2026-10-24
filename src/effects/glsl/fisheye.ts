import { compose, floats, ints, type EffectShaderDef } from '../shader-def';

/**
 * 鱼眼镜头：满幅桶形畸变 —— 整幅画面被压进一个「桶」，桶口正好卡住画框，
 * 黑只出现在四角。
 *
 * ## 与 `bulge` 的区别（这就是加这个特效的理由）
 *
 * `bulge` 只动**中心一团**：半径之外原样不动，边缘既没有压缩也不留黑边 ——
 * 它是「放大镜」，不是镜头。鱼眼是**整幅画面的重投影**：中心略放大、
 * 越往外压缩越狠、画框的四条边被弯成弧形。
 *
 * ## 为什么是「满幅」而不是一个圆
 *
 * 归一化到**画框**（两个方向都到 ±1），不是按短边取正方形：
 * 于是 `r = 1` 处正好是四个边的中点，它们被钉住不动，而 `r` 更大的
 * 四角被推出画面 → 黑只在四角（参考片里那种「画框本身被压弯」的形态）。
 * 按短边取正方形会得到「圆心内切 + 左右两条黑边」，那是圆形鱼眼，不是这个。
 *
 * 副作用是畸变带一点椭圆率（画幅越扁，横向的相对压缩越小）—— 这也正是
 * 「4:3 拍鱼眼」与 16:9 长得不一样的原因，不需要额外的画幅参数。
 *
 * ## 算式
 *
 * 取 `r = |p|`（四边中点是 1、四角是 √2），换成源半径 `m`：
 *
 * - 正向（鱼眼）：`m = tan(r·θ) / tan(θ)`
 * - 反向（凹陷）：`m = atan(r·tan(θ)) / θ` —— 正向的**逆函数**
 *
 * 两者在 `r = 1`（四边中点）都归一到 1，所以：
 *
 * - 中心倍率 = `1 / m'(0)`。正向是 `tan(θ)/θ > 1`（默认 θ=48° 时约 1.33×），
 *   反向是 `θ/tan(θ) < 1`（中心被推远，画面朝里凹下去）。
 * - 边缘是相反的极端：正向把边缘压缩到 `θ·sec²θ/tanθ` 倍，反向把边缘拉开。
 *   同一强度下正向接反向往回做一遍能还原原图（除了已经黑掉的四角）。
 * - `θ = 0` 时整式退化成恒等，所以强度 0 是「原样」。
 *
 * θ 上限取 80° 而不是 90°：`tan` 在 90° 发散，边缘会采样到无穷远；超过 87°
 * 的角度先夹住再取 tan，免得翻负。
 *
 * ## 「裁剪范围」
 *
 * 采样半径除以 `crop`：`> 1` 就是放大整幅鱼眼画面（把四角黑边裁出画外），
 * `< 1` 往外放（黑边更大、像贴在画框里）。它不改畸变形状，只改取景。
 */
export const shader: EffectShaderDef = {
  fragment: `
uniform float u_strength;
uniform float u_crop;
uniform int u_reverse;

/** 半径 1（四边中点）处对应的半视角上限（80°）。 */
const float MAX_HALF_FOV = 1.3962634;
/** tan 的夹子：87° 之后会发散、翻负。 */
const float MAX_ANGLE = 1.5184;

void main() {
  // 满幅归一化：两个方向都到 ±1（不按短边取正方形）
  vec2 p = (vUv - 0.5) * 2.0;
  float r = length(p);

  float th = clamp(u_strength, 0.0, 1.0) * MAX_HALF_FOV;
  float m = r;
  if (th > 0.001) {
    float tm = tan(th);
    m = u_reverse == 1 ? atan(r * tm) / th : tan(min(r * th, MAX_ANGLE)) / tm;
  }

  vec2 src = (r > 1e-6 ? p / r : vec2(0.0)) * (m / max(u_crop, 0.05));

  // 源画面的四边：出界的部分（四角）压成透明。柔边按 1.5 px 的局部导数取，
  // 边缘压缩得越狠的位置越宽 —— 固定宽度在那里会是一圈锯齿。
  float over = max(abs(src.x), abs(src.y)) - 1.0;
  float soft = clamp(1.5 * max(fwidth(src.x), fwidth(src.y)), 1e-4, 0.25);
  float mask = 1.0 - smoothstep(0.0, soft, over);

  vec4 c = texture(u_texture, clamp(src * 0.5 + 0.5, 0.0, 1.0));
  outColor = vec4(c.rgb * mask, c.a * mask);
}`,
  linearFilter: true,
  setUniforms: compose(floats('strength', 'crop'), ints('reverse')),
};

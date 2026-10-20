import { floats, HASH_FAST_GLSL, type EffectShaderDef } from '../shader-def';

/**
 * 液晶屏幕：把画面当成一块真的 LCD 面板来看。
 *
 * ## 物理模型（三个量必须一起自洽）
 *
 * 面板上每颗液晶像素的间距是 `u_pitch`（输出像素），相机距离决定放大倍率
 * `zoom = 1 / u_distance`。于是：
 *
 * - 画面内容按 `zoom` 放大（靠近 = 看到的画面更少、更大）；
 * - 一颗液晶像素在屏幕上占 `u_pitch * zoom` 个输出像素 —— **与内容同步放大**；
 * - 反过来，一颗液晶像素覆盖的**源图**范围是 `u_pitch / u_resolution`，
 *   与 zoom 无关。
 *
 * 最后这条是这个特效的关键等式：颗粒和画面一起放大，每颗颗粒里装的仍是
 * 同一小块内容。写成「网格固定、画面放大」就变成另一种东西（数码变焦），
 * 颗粒会从内容上滑过去。
 *
 * ## 相机位置（u_panX / u_panY）
 *
 * 平移改的是**屏幕中心对准内容上的哪一点**（内容坐标，0.5 是正中央），
 * 所以它与 `u_distance` 正交：拉近之后靠它取景，不必先拉远再挪。
 * 网格跟着内容走（`pgrid` 建在 `contentUv` 上），于是平移时颗粒与坏道
 * 一起移过去 —— 相机在扫一块静止的面板，不是画面在网格下面滑。
 * 挪过内容边缘时采样按 `CLAMP_TO_EDGE` 拉边、网格继续走：镜头扫出了面板
 * 显示的那块内容，但面板本身还在。
 *
 * ## 为什么要淡出（grainVis）
 *
 * 一颗液晶像素只占一两个输出像素时，R/G/B 三条竖纹本身就是摩尔纹 ——
 * 画面会整片泛彩。所以按颗粒的**屏幕尺寸**淡出：小于约 2 px 完全回到原图，
 * 大于 5 px 才让子像素结构全量出现。远看是普通画面，凑近才显出颗粒。
 *
 * ## 黑矩阵（u_gap）
 *
 * `u_pitch` 是**采样间隔**（一颗液晶像素的边长），不是发光颗粒本身的大小。
 * 真实面板的像素之间有明显的黑缝（黑矩阵），颗粒并不紧贴在一起；`u_gap`
 * 就是这条缝占一颗像素边长的**百分比**，颗粒 = 去掉四周各半条缝之后的中心区域。
 * 子像素之间另有一条固定的细缝，那是颗粒内部的分隔，不随 `u_gap` 变粗。
 *
 * ## 子像素只发自己那一通道（亮度补偿的代价）
 *
 * 一根子像素 = 一条滤光片后的发光点，滤光片把另外两段波长挡在外面，所以
 * 它的亮度只能是 `母像素的那一通道 × 面积补偿`（1/3 宽度 ⇒ ×3），三根竖条
 * 积分回来正好等于母像素的颜色。
 *
 * 代价是**八位帧缓冲装不下那 3 倍**：通道值超过 1/3 的子像素被截断。这不是
 * 实现偷懒，是真实物理 —— 面板的子像素峰值亮度本来就是整屏白的三倍，凑到
 * 子像素尺度拍照，亮部只能是饱和的竖条、整幅画面必然变暗。别用「掺白色底光」
 * 把那 3 倍摊到三根竖条上去补：那会让子像素发出滤光片根本透不过的颜色
 * （纯绿画面变成三根绿条，即 GGG）。
 *
 * ## 坏道
 *
 * 整列常亮成绿 / 蓝 / 红是液晶面板最典型的损坏形态，所以按**列**（不是子像素）
 * 掷随机。哈希是列号的纯函数、**不掺 `u_seed`** —— 坏点是面板的属性，不能
 * 逐帧重掷（那会闪成雪花）。`u_time` 只用来给坏道加一点轻微的呼吸，
 * 相位先 `mod` 归约到一圈内（大参数 sin 的精度坑见 AGENTS §1.3）。
 *
 * 没有 feedback / pre-pass / u_original：一张画面只依赖 t 与参数。
 */
export const shader: EffectShaderDef = {
  fragment: `
uniform float u_distance;
uniform float u_pitch;
uniform float u_gap;
uniform float u_glare;
uniform float u_broken;
uniform float u_panX;
uniform float u_panY;
${HASH_FAST_GLSL}
/**
 * 某一列坏掉时的颜色。返回 vec3，0 = 这一列正常。
 * 阈值 0.02：坏道占全部列的比例上限，再高就变成花屏了。
 */
vec3 brokenColumn(float col) {
  float on = step(hash21(vec2(col * 0.731 + 13.0, 7.0)), u_broken * 0.02);
  float pick = hash21(vec2(col * 1.37 + 41.0, 3.0));
  vec3 tint = pick < 0.334 ? vec3(0.10, 1.00, 0.18)
            : pick < 0.668 ? vec3(0.10, 0.35, 1.00)
                           : vec3(1.00, 0.13, 0.07);
  float amp = 0.60 + 0.40 * hash21(vec2(col * 2.11 + 5.0, 17.0));
  return tint * on * amp;
}
void main() {
  float zoom = 1.0 / max(u_distance, 0.05);
  float cellPx = max(u_pitch * zoom, 1.0);

  // 内容放大：离得越近，看到的画面越少。相机 X/Y 是「屏幕中心对准内容上的
  // 哪一点」，单位与内容同一套归一化坐标 —— 平移 0.25 就是把镜头挪过四分之一
  // 幅画面，与 zoom 无关（所以在拉近状态下微调更好用）。
  vec2 contentUv = (vUv - 0.5) / zoom + 0.5 + vec2(u_panX, u_panY);

  // 面板坐标固定在**内容**上，不是屏幕上：液晶像素是屏幕的物理属性，
  // 相机推近时它跟着画面一起放大。若按屏幕坐标摆网格，推拉时像素格会
  // 从画面上滑过去（采样相位随 zoom 漂），坏道也会跟着换位置。
  vec2 pgrid = contentUv * u_resolution / u_pitch;
  vec2 cell = floor(pgrid);
  vec2 f = pgrid - cell;

  // 未遮罩的那一路：像素自己的内容（颗粒淡出时用的就是它，保持原图锐度）。
  vec4 src = texture(u_texture, contentUv);
  vec3 base = src.rgb;

  // 这一颗液晶像素的平均色：取它的中心，再按四分之一格抽头。
  // 覆盖范围 = u_pitch / u_resolution（见头注的关键等式）。
  vec2 panelUv = (cell + 0.5) * u_pitch / u_resolution;
  vec2 tap = 0.25 * u_pitch / u_resolution;
  vec4 c0 = texture(u_texture, panelUv + vec2(-tap.x, -tap.y));
  vec4 c1 = texture(u_texture, panelUv + vec2( tap.x, -tap.y));
  vec4 c2 = texture(u_texture, panelUv + vec2(-tap.x,  tap.y));
  vec4 c3 = texture(u_texture, panelUv + vec2( tap.x,  tap.y));
  vec3 cellColor = (c0.rgb + c1.rgb + c2.rgb + c3.rgb) * 0.25;

  /*
   * 黑矩阵：颗粒之间的间隔（u_gap，占一颗像素边长的百分比）+ 颗粒内部子像素
   * 之间的细缝。真实面板的像素不是紧贴的 —— 这条缝就是「一颗颗颗粒」能
   * 读出来的原因。u_pitch 只决定采样间隔，颗粒边长 = u_pitch × (1 − u_gap)。
   */
  float gap = clamp(u_gap * 0.01, 0.0, 0.5);
  float halfGap = gap * 0.5;
  // 抗锯齿宽度 = 半个输出像素在格子坐标里的长度，以目标边界为中心。
  float aa = 0.5 / max(cellPx, 1.0);
  float activeX = smoothstep(-aa, aa, f.x - halfGap)
                * smoothstep(-aa, aa, 1.0 - halfGap - f.x);
  float activeY = smoothstep(-aa, aa, f.y - halfGap)
                * smoothstep(-aa, aa, 1.0 - halfGap - f.y);

  /*
   * 一根像素 = 三根竖条：R / G / B 子像素。
   *
   * **必须按发光区等分（ax），不能按整格等分（f.x）**：按整格等分时，左右
   * 两根各被黑矩阵切掉一截、中间那根原封不动 —— 绿的面积占比会随 u_gap
   * 变大，镜头拉近后整幅画面发绿。加间隔参数时踩过一次。
   */
  float span = max(1.0 - gap, 0.001);
  float ax = (f.x - halfGap) / span;
  float sub = floor(ax * 3.0);
  float s0 = 1.0 - step(0.5, sub);
  float s1 = step(0.5, sub) * (1.0 - step(1.5, sub));
  float s2 = step(1.5, sub);
  vec3 chan = vec3(s0, s1, s2);

  // 颗粒内部的三根子像素之间只留很细的缝，不跟 u_gap 一起变粗。
  float sx = fract(ax * 3.0);
  float slit = smoothstep(0.0, 0.055, sx) * smoothstep(0.0, 0.055, 1.0 - sx);
  float fill = activeX * activeY * slit;

  /*
   * 彩色滤光片：**一根子像素只透自己那一通道**，红子像素发不出绿光。
   *
   * 面积补偿 ×3 是必须的：一根子像素只占 1/3 宽度，三根积分回来才等于这一格
   * 的原色。别用「掺一层白底」去补那 3 倍在 8bit 里的截断 —— 那等于让子像素
   * 发出滤光片挡掉的颜色（纯绿 → 三根绿条）。截断本身是真实代价，见头注。
   *
   * 黑矩阵吃掉的平均亮度要补回来（间隙越大补得越多）。上限 1.8：间隙再大
   * 也宁可让整体暗一点，不要为了补回来把暗部也一起推进截断。
   */
  float fillAvg = (1.0 - gap) * (1.0 - gap) * 0.94;
  float fillGain = clamp(1.0 / max(fillAvg, 0.001), 1.0, 1.8);
  vec3 mask = chan * 3.0 * (fill * fillGain);
  // 超过 1 的部分由末尾的 clamp 截断 —— 那 3 倍在 8bit 帧缓冲里装不下，
  // 所以亮部的竖条是饱和的、整幅画面凑近必然变暗（真实面板的峰值是三倍）。
  vec3 lcd = cellColor * mask;

  // 颗粒小于约两个输出像素时只会有摩尔纹 —— 淡出回原图。
  float grainVis = smoothstep(2.0, 5.0, cellPx);
  vec3 col = mix(base, lcd, grainVis);

  // 反光：两道斜向高光 + 一层很淡的整屏冷光，像玻璃面板上的环境反射。
  vec2 p = vUv - 0.5;
  float diag = p.x * 0.80 + p.y * 0.60;
  // 不要写 pow(x, 2.0)：x 为负时 GLSL 的 pow 未定义。
  float b1 = (diag - 0.17) * 6.4;
  float b2 = (diag + 0.23) * 14.0;
  float h = length(p * vec2(1.0, 1.15)) * 1.55;
  float band = exp(-b1 * b1);
  float band2 = exp(-b2 * b2) * 0.55;
  float sheen = (band + band2) * smoothstep(-0.55, 0.05, diag);
  float halo = exp(-h * h) * 0.10;
  col += (vec3(0.68, 0.80, 1.00) * sheen * 0.55
        + vec3(0.55, 0.66, 0.90) * halo) * u_glare * src.a;

  // 坏道：整列常亮的竖纹，带一点相邻列的渗光。
  vec3 br = brokenColumn(cell.x);
  br += 0.30 * (brokenColumn(cell.x - 1.0) * (1.0 - f.x)
              + brokenColumn(cell.x + 1.0) * f.x);
  float flick = 0.92 + 0.08 * sin(mod(u_time * 4.0 + cell.x * 1.7, 6.2831853));
  float bl = max(max(br.r, br.g), br.b);
  col = mix(col, br * (0.55 + 0.45 * fill) * flick, clamp(bl * 0.92, 0.0, 1.0) * src.a);

  outColor = vec4(clamp(col, 0.0, 1.0), src.a);
}`,
  setUniforms: floats('distance', 'pitch', 'gap', 'glare', 'broken', 'panX', 'panY'),
};

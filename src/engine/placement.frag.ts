/**
 * placement.frag.ts — 把一个 SourceClip 的画面放进全帧透明缓冲：
 * 居中 / 缩放 / 旋转 / fit / 四角透视 / 抠图 / 裁剪，层外 alpha = 0，
 * 合成 pass 自然不动下层。
 *
 * LAYER_BOX 数学移植自 openmosh effect-shaders.ts（MIT，见 CREDITS.md），
 * 去掉 MVP 用不到的 mask / edgeFade。抠图（chroma key）是**本项目自写**的
 * （YCbCr 色度差 + 亮度差，见下），不是 openmosh chroma-key 的移植。
 *
 * transform 的换算在 CPU 侧完成（drawSize / center / rot 作为 uniform），
 * fadeSec 在 buildStack 里折算进 opacity。
 *
 * ## 片段级图像处理（v7）：为什么都塞进这一次 placement
 *
 * `SourceClip.quad`（四角调整）与 `SourceClip.key`（简易抠图）**不是特效**：
 * 它们只处理这一层，且必须在“源纹理 → 图层矩形”这一步做完，否则下面的混合、
 * 特效链、转场都拿不到正确的 alpha。所以它们只是这一个 pass 里的两步：
 *
 *   frame uv → layerUv()（现有 affine）
 *   → [四角] 翻成左上原点 → H⁻¹ → 翻回 GL 采样坐标
 *   → 采样 → insideLayer(最终源 uv) → 键色 alpha
 *
 * **裁剪（v10）只乘 `inside`、不改采样坐标**：它收窄可见窗口，内容比例与位置
 * 都不动。所以它排在四角之后（裁的是「源的边」，透视变形之后那条边仍在同一个
 * 源 uv 上），也不需要第二遍采样。
 *
 * 两条坐标空间约定，写错时的症状都是“看起来像 bug 的偏移 / 镜像”：
 *
 * 1. **四角坐标在层空间，左上原点 `(0,0)…(1,1)`**（与数据模型 `QuadCorners`
 *    一致）：单位方 = 图层的默认矩形四角（即 fit / transform 之后、透视变形之前
 *    的那块区域），`tl` 是**视觉左上**。但着色器里的 `layerUv / vUv` 是 GL 的
 *    **v 向上**空间（`VERT_QUAD` 的 vUv=(0,0) 在帧的左下），而图片纹理上传时
 *    `UNPACK_FLIP_Y = true`（见 `sources.ts::uploadImage`）⇒ 视觉上的 top-down
 *    uv 与 GL 纹理坐标差一次 `v → 1-v`。所以这里做**两次** v 翻转的桥接：
 *    进去时把层 uv 翻成左上原点再乘 H⁻¹，得到左上原点的源 uv，采样前再翻回 GL。
 *    只翻一次或漏翻的表现都是**非恒等四角时画面上下镜像**（而恒等四角看不出，
 *    因为 CPU 侧 `isIdentityQuad` 已把它挡在 `u_quadOn = 0` 那条路上）。
 *    与 `transform` 是**复合**关系：先把图层摆好，再拉角依然成立。H⁻¹ 在
 *    `core/quad.ts` 算，UI 拖角与这里共用同一份数学。
 * 2. **`u_quadOn = 0` 时不做四角、`u_key.a = 0` 时不做键控、`u_cropOn = 0` 时
 *    不裁**：关闭状态必须与历史工程**逐位一致**（全项目确定性回归的前提），所以
 *    关闭分支里的运算与改动前逐字相同 —— 不是“看起来等价的改写”。
 *
 * 抠图数学（`keyDistance`）：色度差为主、亮度差 ×1/2。RGB 欧氏距离会被亮度主导，
 * 于是同一块绿幕在阴影和高光下判成两种颜色；剥掉亮度后“阴影绿幕”与“白灰背景”
 * 都能用同一组参数。容差 / 柔边各映射为“距离”的一半，溢色抑制把接近键色的像素
 * 往亮度靠（去饱和） —— 绿幕边缘的绿边就是这么消的。
 *
 * **已知限制（刻意不修）**：转场窗口里 gl-transitions 的着色器只读贴图 rgb、
 * 不看 alpha，所以抠掉 / 裁掉的区域在转场过程中会按黑色参与混合（普通合成路径
 * 完全正确）。这是转场协议本身的取舍，不要把抠图挪到转场之后去补 —— 那会让
 * “转场两侧各自独立生效”的语义崩掉（见 `compositor.ts::placeLayer`）。
 *
 * ## `u_opacity` 为什么存在（而不是只在 blend pass 里乘）
 *
 * 普通通路仍然把 opacity 交给 blend pass（`u_opacity` 传 1，行为与从前逐位相同）。
 * 只有**转场通路**需要把两侧各自的 opacity 烘进各自的 alpha：转场着色器做的是
 * `mix(getFromColor(uv), getToColor(uv), progress)`，它只认贴图，没有地方接收
 * 「这一侧的不透明度」。烘进 alpha 后，两侧各自的淡变/不透明度就自然参与混合。
 *
 * 注意只乘 alpha、不动 rgb：本项目的 render target 是**直通（非预乘）alpha**，
 * blend.frag 也是按直通 alpha 算的，乘 rgb 会得到错误的结果。
 */

export const PLACEMENT_FRAG = `#version 300 es
precision highp float;
uniform sampler2D u_texture;
uniform vec2 u_frameSize;   // 渲染目标像素尺寸
uniform vec2 u_drawSize;    // 摆放后的像素尺寸（fit 已算进去）
uniform vec2 u_center;      // 帧内中心 uv（0..1）
uniform float u_rot;        // 弧度
uniform float u_opacity;    // 只缩放 alpha（直通 alpha）；普通通路传 1

// 四角调整：u_quadR0..R2 = H⁻¹ 的三行（行主序，CPU 算好）。
// 坐标是「层空间（左上原点）-> 源 uv（左上原点）」。u_quadOn = 0 时不走这条分支。
uniform float u_quadOn;
uniform vec3 u_quadR0;
uniform vec3 u_quadR1;
uniform vec3 u_quadR2;

// 简易抠图：rgb = 键色（0..1），a > 0.5 = 启用。
// u_keyParams = (容差, 柔边, 溢色抑制)，三个都是 0..1。
uniform vec4 u_key;
uniform vec3 u_keyParams;

// 裁剪：u_crop = (左, 上, 右, 下)，每项是**该边被裁掉的源比例**。
// 只收紧可见窗口，不改采样坐标 —— 内容既不缩放也不位移（AE 的 Crop）。
uniform vec4 u_crop;
uniform float u_cropOn;

in vec2 vUv;
out vec4 outColor;

// 帧 uv -> 层内 uv。出 [0,1] 就是层外。
vec2 layerUv(vec2 uv) {
  vec2 p = (uv - u_center) * u_frameSize;
  float s = sin(u_rot);
  float c = cos(u_rot);
  vec2 r = vec2(c * p.x + s * p.y, c * p.y - s * p.x);
  return r / max(u_drawSize, vec2(1.0)) + 0.5;
}

/**
 * 解析覆盖率：对 [lo, hi] 这个矩形窗口做**按像素足迹展开的边缘**。
 *
 * 旧写法是 step() —— 于是旋转/缩放的层矩形、四角透视的边、裁剪边全是 1 像素
 * 硬阶梯，缩放动画里还会「爬行」。而 MSAA 在这里帮不上忙：所有绘制都是全屏
 * 三角形，不存在光栅化边缘，抗锯齿只能自己算。
 *
 * 三条实现约束：
 * - fwidth 给的是屏幕空间导数，四角透视下 uv 是非仿射的，那里依然正确。
 * - 宽度上下都夹住。下界防 drawSize 极大时坡变成 0（退化成 step）；上界防
 *   图层被缩到几个像素时整块糊成一团。
 * - **inside 精确为 1 的像素逐位不变**（smoothstep 在边界内部返回 1.0），
 *   既有的确定性回归与逐位断言因此不受影响。
 */
float coverage(vec2 uv, vec2 lo, vec2 hi) {
  vec2 w = clamp(fwidth(uv) * 0.5, vec2(1e-5), vec2(0.25));
  vec2 a = smoothstep(lo - w, lo + w, uv);
  vec2 b = smoothstep(hi + w, hi - w, uv);
  return min(a.x, a.y) * min(b.x, b.y);
}

float insideLayer(vec2 uv) {
  return coverage(uv, vec2(0.0), vec2(1.0));
}

// BT.601 色差分量。抠图以它为主：亮度被剥掉，阴影/高光下的同一背景颜色一致。
vec2 chromaOf(vec3 c) {
  return vec2(dot(c, vec3(-0.1687, -0.3313, 0.5)), dot(c, vec3(0.5, -0.4187, -0.0813)));
}

// 到键色的颜色距离：色度差为主 + 亮度差 x 0.5（后者补「白灰背景」这类色度接近
// 而只差亮度的场景）。
float keyDistance(vec3 c) {
  vec2 dc = chromaOf(c) - chromaOf(u_key.rgb);
  float dy = dot(c - u_key.rgb, vec3(0.299, 0.587, 0.114));
  return sqrt(dot(dc, dc) + 0.25 * dy * dy);
}

void main() {
  vec2 layerGl = layerUv(vUv);   // GL 空间：v 向上

  // 默认（无四角）路径：采样坐标就是 layerUv，层内判定也在它上面。
  // 这两行与改动前的算式逐字相同 —— 关闭状态逐位一致的要求落在这里。
  vec2 srcGl = layerGl;
  float inside = insideLayer(layerGl);

  // 裁剪判定用的「源 uv（左上原点）」：没有四角时就是层 uv。裁剪边是**源的边**，
  // 所以它在四角变形之前就已经确定 —— 判定放在四角之后（用 srcTd）而不是之前。
  vec2 cropUv = vec2(layerGl.x, 1.0 - layerGl.y);

  // 四角透视：数据侧是左上原点，这里拿到的是 GL（v 向上）。
  // 先翻成左上原点再乘 H⁻¹，得到的源 uv 也是左上原点，最后翻回 GL 采样坐标。
  // 两次翻转必须成对出现；只翻一次 = 非恒等四角时画面上下镜像。
  // 恒等四角不会进这个分支（CPU 侧 isIdentityQuad 已挡 ⇒ u_quadOn = 0）。
  if (u_quadOn > 0.5) {
    vec2 layerTd = vec2(layerGl.x, 1.0 - layerGl.y);
    vec3 p = vec3(
      dot(u_quadR0, vec3(layerTd, 1.0)),
      dot(u_quadR1, vec3(layerTd, 1.0)),
      dot(u_quadR2, vec3(layerTd, 1.0))
    );
    // p.z <= 0 的方向上 H⁻¹ 把无穷远映了过来：这个像素在层外，直接透明。
    if (p.z <= 1e-6) {
      outColor = vec4(0.0);
      return;
    }
    vec2 srcTd = p.xy / p.z;               // 源 uv（左上原点）
    inside = insideLayer(srcTd);
    srcGl = vec2(srcTd.x, 1.0 - srcTd.y);  // 采样用 GL 坐标（图片上传时 UNPACK_FLIP_Y = true）
    cropUv = srcTd;
  }

  // 裁剪：只把可见窗口收窄到 [左, 1-右] × [上, 1-下]（左上原点）。
  // 关闭时不进这个分支 —— u_cropOn 由 CPU 侧按「四条边全 0」决定。
  if (u_cropOn > 0.5) {
    vec2 lo = u_crop.xy;
    vec2 hi = vec2(1.0) - u_crop.zw;
    /* 裁剪边同样是层内的硬边，走同一套覆盖率（否则裁出来的长条两端还是阶梯） */
    inside *= coverage(cropUv, lo, hi);
  }

  vec4 c = texture(u_texture, clamp(srcGl, 0.0, 1.0));

  // 简易抠图。只在启用时进入：关闭时 keep 恒为 1、rgb 不变，等于没写这段。
  // t0 = 容差/2、过渡宽度 = 柔边/2：0..1 的参数各吃掉「距离」的一半。
  if (u_key.a > 0.5) {
    float t0 = u_keyParams.x * 0.5;
    float w = max(u_keyParams.y * 0.5, 1e-4);
    float keep = smoothstep(t0, t0 + w, keyDistance(c.rgb));
    c.a *= keep;
    float luma = dot(c.rgb, vec3(0.299, 0.587, 0.114));
    c.rgb = mix(c.rgb, vec3(luma), u_keyParams.z * (1.0 - keep));
  }

  outColor = vec4(c.rgb, c.a * u_opacity) * inside;
}`;

/**
 * fit → drawSize 的 CPU 换算。
 * contain：完整装入帧内；cover：铺满帧（裁掉溢出）；stretch：拉满。
 * transform.sx/sy 是额外倍率。
 */
export function drawSizeFor(
  fit: 'contain' | 'cover' | 'stretch',
  frameW: number,
  frameH: number,
  srcW: number,
  srcH: number,
  sx: number,
  sy: number,
): [number, number] {
  if (fit === 'stretch' || srcW <= 0 || srcH <= 0) {
    return [frameW * sx, frameH * sy];
  }
  const k =
    fit === 'contain'
      ? Math.min(frameW / srcW, frameH / srcH)
      : Math.max(frameW / srcW, frameH / srcH);
  return [srcW * k * sx, srcH * k * sy];
}

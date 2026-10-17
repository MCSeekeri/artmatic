/**
 * quad.ts — 四角调整（透视变形）的纯数学 + 层 uv ↔ 帧 uv 的仿射换算。
 *
 * **本文件不得有任何运行时 import**（只允许 `import type`）。这是刻意约束，
 * 不是风格偏好：E2E 直接 import 它算期望值，而任何运行时依赖都会把
 * `schema.ts` → `i18n/index.svelte.ts`（里面是 `$state`）整串拖进测试的模块图，
 * 在普通 node / Playwright 环境里炸掉。所以这里的数学必须**自洽**，不碰 schema
 * 的任何运行期值。
 *
 * ## 坐标空间（四套，别混）
 *
 * **数据 / 层 / 帧 / 源 uv 一律是左上原点**（`(0,0)` = 左上、v 向下、u 向右）——
 * 这是用户语义与数据语义，**不是 GL 裁剪空间**。`QuadCorners` 的四角、帧 uv、
 * 源 uv 都按这个约定，所以四角手柄的位置、单应数学、E2E 的像素坐标可以互相对照。
 *
 * - **层空间**（`QuadCorners` 的坐标空间）：`(0,0)` = 默认图层矩形**左上**、
 *   `(1,1)` = 右下。它就是 `placement.frag.ts` 里 `u_drawSize` / `u_center`
 *   定义的那张纹理矩形 —— `fit`、`transform.sx/sy`、`transform.rot`、
 *   `transform.x/y` **都已经算掉了**。所以四角调整与 transform 是**复合**关系。
 * - **帧 uv**：渲染目标（全帧）上的归一化坐标，左上 `(0,0)`。
 * - **源 uv**：素材纹理上的归一化坐标，左上 `(0,0)`。
 * - **GL 空间**：`placement.frag.ts` 的 `vUv` 是 WebGL 约定（`VERT_QUAD` 里
 *   `vUv.y = 1` 在屏幕顶 ⇒ v 向上）；图片上传时 `UNPACK_FLIP_Y_WEBGL = true`
 *   把源图翻成同一方向，所以着色器内部自洽。
 *   **v 翻转只发生在两处边界**：着色器自己，以及本文件 `layerUvToFrameUv` /
 *   `frameUvToLayerUv` 的公开 API 与内部 GL helper 之间。翻转绝不进数据模型。
 *
 * `QuadCorners` 描述单应 H：源图 `(u,v)` 的像素最终落在层空间 `H(u,v)`。
 * 渲染采样要反过来（给定层空间点求源 uv），所以用 H⁻¹（`quadInverseMatrix`）。
 * 单应 / 逆矩阵 / `quadSourceUv` 全部用**左上原点**，与上面四套约定一致。
 *
 * `PlacementAffine.cx/cy` 是唯一的例外：它是既有数据 `transform.x/y`，按 **GL 帧 uv**
 * 的基值解释（0.5 = 中心；改它等于改全工程的 transform 语义），在内部 GL 公式里照旧用。
 *
 * ## 为什么 UI 手柄与渲染采样必须共用这一份
 *
 * 两边各写一套容差 / 各推一遍公式，表现是「手柄看起来对、画面差半像素」这种
 * 没人会查的偏差。所以判定「恒等」只认 `isIdentityQuad()`，UI 拖角换算只认
 * `layerUvToFrameUv` / `frameUvToLayerUv`，渲染侧的数学真源就是本文件。
 */

import type { QuadCorners } from './image-fx';

/**
 * 单应的行列式近零阈值。
 *
 * H 的输入 / 输出都在层空间（坐标 O(1)），行列式也在同一量级：1e-12 比任何
 * 「人眼可用的四边形」小十几个数量级（层空间里面积 1e-6 的四边形 det 还有
 * 1e-6），又远大于 float64 的舍入噪声（~1e-16）。用绝对阈值而非相对阈值：
 * 调用方的坐标空间是固定的，绝对阈值更好预测，也不会让「极小的合法四边形」
 * 在某个不确定的位置突然变成不合法。
 */
const DET_EPS = 1e-12;

/**
 * 齐次分量 w 的阈值。`w <= 0` 表示这个点落到了消失线的另一侧（投影到无穷远），
 * 逆映射没有意义；`w` 太小则逆映射结果的量级失控。两种情况一律返回 null，
 * 让调用方按「不调整」处理。
 *
 * 取 1e-6 是为了与渲染侧**同口径**：`placement.frag.ts::squareUv` 写的是
 * `p.z <= 1e-6 → 返回层外（透明）`。层空间 uv 一个像素约为 1e-3，6 个数量级的
 * 余量足够；两边阈值不同的话，CPU 参考实现在消失线附近会与 GPU 画出不一样的
 * alpha —— 那种偏差只有 E2E 逐像素对拍才看得见。
 */
const W_EPS = 1e-6;

/**
 * 单位方 → 四边形的单应，**行主序** 3×3：`[a,b,c, d,e,f, g,h,1]`，
 *
 *   x = (a·u + b·v + c) / (g·u + h·v + 1)
 *   y = (d·u + e·v + f) / (g·u + h·v + 1)
 *
 * 角点对应关系：(0,0) → tl、(1,0) → tr、(1,1) → br、(0,1) → bl。
 * 闭式解来自 Heckbert《Fundamentals of Texture Mapping and Image Warping》：
 * 四个角给八个方程，先解 g/h 的 2×2，再回代其余六个。
 *
 * 退化（三点共线 / 四点重合 / 面积 0）→ null。判据是最终矩阵的行列式近 0，
 * 而不是某个中间量的符号 —— 中间量在「近平行四边形」时会同时趋近 0，比值仍然
 * 是有限的合法解；只有最终矩阵不可逆才是真正的退化。
 */
export function homographyFromUnitSquare(q: QuadCorners): number[] | null {
  const [x0, y0] = q.tl;
  const [x1, y1] = q.tr;
  const [x2, y2] = q.br;
  const [x3, y3] = q.bl;

  /*
   * dx3 / dy3 是「仿射偏离」：平行四边形上恒为 0，此时投影分支的分母 den 也是 0
   * （解 g/h 的 2×2 退化），会算出 0/0。所以平行四边形必须单独走仿射特例 ——
   * 否则一个完全合法的平行四边形会被判成退化。
   */
  const dx1 = x1 - x2;
  const dx2 = x3 - x2;
  const dx3 = x0 - x1 + x2 - x3;
  const dy1 = y1 - y2;
  const dy2 = y3 - y2;
  const dy3 = y0 - y1 + y2 - y3;

  let a: number;
  let b: number;
  let c: number;
  let d: number;
  let e: number;
  let f: number;
  let g: number;
  let h: number;

  if (dx3 === 0 && dy3 === 0) {
    // 仿射特例（含平行四边形）：w 恒为 1。
    g = 0;
    h = 0;
    a = x1 - x0;
    b = x3 - x0;
    c = x0;
    d = y1 - y0;
    e = y3 - y0;
    f = y0;
  } else {
    const den = dx1 * dy2 - dx2 * dy1;
    // den 近 0 时 g/h 会算出 ±Infinity / NaN；不在中间判，统一交给下面的行列式检查
    // （NaN 不满足 `>= DET_EPS`，自然走 null）。
    g = (dx3 * dy2 - dx2 * dy3) / den;
    h = (dx1 * dy3 - dx3 * dy1) / den;
    a = x1 - x0 + g * x1;
    b = x3 - x0 + h * x3;
    c = x0;
    d = y1 - y0 + g * y1;
    e = y3 - y0 + h * y3;
    f = y0;
  }

  const m = [a, b, c, d, e, f, g, h, 1];
  // 写成 `!(|det| >= eps)` 而不是 `|det| < eps`：det 为 NaN 时前者也返回 null，
  // 坏输入不会以「NaN 矩阵」的形状漏到渲染期。
  if (!(Math.abs(det3(m)) >= DET_EPS)) return null;
  return m;
}

/**
 * 行主序 3×3 的逆；`|det|` 近 0（含非有限输入）→ null。
 *
 * 与 `homographyFromUnitSquare` 共用同一个 `DET_EPS`：两者服务的是同一个
 * 坐标空间（层空间 O(1)），阈值没有理由各写一个。
 */
export function invertMat3(m: readonly number[]): number[] | null {
  if (m.length !== 9) return null;
  const a = m[0]!;
  const b = m[1]!;
  const c = m[2]!;
  const d = m[3]!;
  const e = m[4]!;
  const f = m[5]!;
  const g = m[6]!;
  const h = m[7]!;
  const i = m[8]!;
  const det = a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g);
  if (!(Math.abs(det) >= DET_EPS)) return null;
  // 伴随矩阵转置 ÷ det（行主序）。det 过了阈值，量级可控；但仍然挡一次非有限值：
  // 输入带 Infinity 时 det 可能是有限数、求逆却溢出，那种「算得出数」的假象不能传出去。
  const inv = [
    (e * i - f * h) / det,
    (c * h - b * i) / det,
    (b * f - c * e) / det,
    (f * g - d * i) / det,
    (a * i - c * g) / det,
    (c * d - a * f) / det,
    (d * h - e * g) / det,
    (b * g - a * h) / det,
    (a * e - b * d) / det,
  ];
  for (const v of inv) if (!Number.isFinite(v)) return null;
  return inv;
}

/**
 * 采样用的 H⁻¹（行主序）：**层空间 uv → 源 uv**。四角退化 / 不可逆 → null，
 * 调用方按「不调整」渲染（不丢层）。
 *
 * ⚠️ 返回的是行主序矩阵。engine 把它拆成三个 vec3 uniform / vec3 数组时
 * 行/列一旦混用，画面会沿对角线翻折，而且不会报任何错。
 */
export function quadInverseMatrix(q: QuadCorners): number[] | null {
  const h = homographyFromUnitSquare(q);
  return h ? invertMat3(h) : null;
}

/**
 * CPU 参考实现：给定**层空间**点 `(u,v)`，求它在源图上对应的 uv（= H⁻¹ 作用）。
 *
 * 它有三个用处，所以是「参考实现」而不是内部辅助：
 * 1. 渲染侧（`placement.frag.ts`）的数学真源 —— GPU 版本必须与它逐点一致；
 * 2. UI 拖角 / 手柄命中测试；
 * 3. E2E / 单测算期望值。
 *
 * 返回 null：四角退化（不可逆），或这个点落在消失线上（w ≈ 0，映射到无穷远）。
 * 恒等四角下就是原样返回 `(u,v)`；层空间里四角之外的点的返回值会落在 `[0,1]`
 * 之外（正是「层外 → 采样越界」的判据，渲染侧据此把 alpha 置 0）。
 */
export function quadSourceUv(q: QuadCorners, u: number, v: number): [number, number] | null {
  const inv = quadInverseMatrix(q);
  if (!inv) return null;
  return applyHomography(inv, u, v);
}

/**
 * 四角是否等于单位方四角（= 不调整）。
 *
 * `eps` 是**每个分量的绝对容差**，默认 1e-6：手柄拖回原位不可能精确落在 0 / 1，
 * 而层空间 1e-6 的偏差在 1080p 上约 0.001 像素，视觉上就是恒等。
 * 容差**包含边界**（`|Δ| <= eps`）：手柄吸附回原位时正好落在边界上，若用 `<`
 * 会出现「手柄显示已归位、渲染仍走四角分支」的半像素级不一致。
 */
export function isIdentityQuad(q: QuadCorners, eps = 1e-6): boolean {
  const same = (p: [number, number], x: number, y: number): boolean =>
    Math.abs(p[0] - x) <= eps && Math.abs(p[1] - y) <= eps;
  return same(q.tl, 0, 0) && same(q.tr, 1, 0) && same(q.br, 1, 1) && same(q.bl, 0, 1);
}

/**
 * 一次 placement 的仿射参数 —— 与 `placement.frag.ts` 的 uniform 一一对应，
 * 由 CPU 侧从 clip 的 `fit` / `transform` 算出来（见 `drawSizeFor`）。
 *
 * 单位：`frameW/H`、`drawW/H` 是**像素**；`rot` 是**弧度**。
 * `cx/cy` 是 `transform.x/y` 的原值，按 **GL 帧 uv**（v 向上）解释 —— 见文件头
 * 「坐标空间」那条例外；公开 helper 的入参 / 返回值仍是左上原点。
 */
export interface PlacementAffine {
  frameW: number;
  frameH: number;
  drawW: number;
  drawH: number;
  cx: number;
  cy: number;
  rot: number;
}

/**
 * GL 空间（v 向上、与 `placement.frag.ts` 的 `vUv` 同向）的层 uv → 帧 uv。
 *
 * **只在本文件内部做坐标桥接用，不要 export**：对外公开的坐标系一律左上原点。
 * 推导见下面公开的 `layerUvToFrameUv`。
 */
function layerUvToFrameUvGl(a: PlacementAffine, u: number, v: number): [number, number] {
  const c = Math.cos(a.rot);
  const s = Math.sin(a.rot);
  const rx = (u - 0.5) * Math.max(a.drawW, 1);
  const ry = (v - 0.5) * Math.max(a.drawH, 1);
  // R⁻¹ = Rᵀ（旋转矩阵的逆就是转置）—— 这里用转置而不是再算一次 sin/cos 的符号。
  const px = c * rx - s * ry;
  const py = s * rx + c * ry;
  return [a.cx + px / a.frameW, a.cy + py / a.frameH];
}

/**
 * GL 空间（v 向上）的帧 uv → 层 uv：`placement.frag.ts::layerUv()` 的逐字移植。
 * 同样**只在内部使用**，对外语义由公开的 `frameUvToLayerUv` 桥接回左上原点。
 */
function frameUvToLayerUvGl(a: PlacementAffine, x: number, y: number): [number, number] {
  const c = Math.cos(a.rot);
  const s = Math.sin(a.rot);
  const px = (x - a.cx) * a.frameW;
  const py = (y - a.cy) * a.frameH;
  const rx = c * px + s * py;
  const ry = c * py - s * px;
  return [rx / Math.max(a.drawW, 1) + 0.5, ry / Math.max(a.drawH, 1) + 0.5];
}

/**
 * 层 uv → 帧 uv。**入参与返回值都是左上原点**（u 向右、v 向下），与 UI
 * （`QuadHandles` 的 `toLocal` 直接乘 canvas 尺寸）和 E2E 的像素坐标同一套语义 ——
 * UI 拿到 quad 角后直接传进来，**不翻转**。
 *
 * 内部先桥接到 GL 空间（`v' = 1 − v`），走 `placement.frag.ts` 的仿射公式：
 *
 *   p = (frameUv - center) * frameSize
 *   r = [cos*p.x + sin*p.y, cos*p.y - sin*p.x]
 *   layerUv = r / max(drawSize, 1) + 0.5
 *
 * 正向 = 先乘 R⁻¹ = Rᵀ = `[[cos, -sin], [sin, cos]]`，再除以 frameSize、加回 center；
 * 最后把 y 再翻回左上原点。分母照抄着色器的 `max(drawSize, 1)`：正常摆放时
 * drawSize 是像素尺寸（≥1），两侧严格互逆；只有图层被压到 1px 以下时才需要兜底 ——
 * 那种摆放本来就不可逆，宁可跟 GPU 保持同一个方向，也不要两边各算一个方向。
 *
 * 于是本函数与 `placement.frag.ts::layerUv()` 在**同一次 v 翻转之后**严格互逆：
 * `frameUvToLayerUv(layerUvToFrameUv(p)) == p`。翻转只发生在这个边界上与着色器里，
 * 数据模型（quad / 帧 / 源 uv）永远左上原点。
 *
 * 公式出处：`src/engine/placement.frag.ts` 的 `layerUv()`。改动那里必须同步这里
 * （单测 `tests/unit/quad.test.ts` 把着色器公式逐字复刻出来、两端加 v 桥接对拍）。
 */
export function layerUvToFrameUv(a: PlacementAffine, u: number, v: number): [number, number] {
  // 左上原点 → GL：只翻 y。
  const [xGl, yGl] = layerUvToFrameUvGl(a, u, 1 - v);
  // GL → 左上原点：再翻回来。x 不受影响。
  return [xGl, 1 - yGl];
}

/**
 * 帧 uv → 层 uv。**入参与返回值都是左上原点**（与 `layerUvToFrameUv` 对称）；
 * 与 `placement.frag.ts::layerUv()` 的关系是「先翻 y 进 GL，算完再翻回左上」，
 * 公式出处 / 分母兜底 = 同上。
 */
export function frameUvToLayerUv(a: PlacementAffine, x: number, y: number): [number, number] {
  const [uGl, vGl] = frameUvToLayerUvGl(a, x, 1 - y);
  return [uGl, 1 - vGl];
}

/* -------------------------------------------------------------- 内部工具 */

/** 行主序 3×3 行列式。 */
function det3(m: readonly number[]): number {
  return (
    m[0]! * (m[4]! * m[8]! - m[5]! * m[7]!) -
    m[1]! * (m[3]! * m[8]! - m[5]! * m[6]!) +
    m[2]! * (m[3]! * m[7]! - m[4]! * m[6]!)
  );
}

/** 行主序 3×3 单应作用在 `(u,v)` 上；w 非正 / 近 0（消失线及另一侧）→ null。 */
function applyHomography(m: readonly number[], u: number, v: number): [number, number] | null {
  const w = m[6]! * u + m[7]! * v + m[8]!;
  if (!(w > W_EPS)) return null;
  return [(m[0]! * u + m[1]! * v + m[2]!) / w, (m[3]! * u + m[4]! * v + m[5]!) / w];
}

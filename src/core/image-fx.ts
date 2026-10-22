/**
 * image-fx.ts — 图片的**元素级**图像处理：简易抠图（色键）、四角透视、裁剪。
 *
 * 三个能力在时间轴上属于 `SourceClip`（`key` / `quad` / `crop`，走 GPU 的
 * placement pass）；而排版文档里的图片元素是 DOM，没有那条 pass，只能自己在
 * 像素上算。本文件就是那份**唯一的 CPU 实现**：
 *
 *  - 色键公式与 `engine/placement.frag.ts` 逐字对齐（YCbCr 色度差为主 +
 *    亮度差 ×1/2，容差 / 柔边各吃「距离」的一半，溢色抑制往亮度靠）；
 *  - 单应数学复用 `core/quad.ts`（`quadInverseMatrix` / 恒等判据），不另写一套；
 *  - 裁剪在这里只有**形状与钳制**（片段渲染在着色器里做行/列判定，排版元素的
 *    剪辑是 `typography/css.ts` 的「源窗铺满元素框」另一套语义，见 `CropSettings`）。
 *
 * **本文件不得有任何运行时 import**：`QuadCorners` / `KeySettings` 在这里定义
 * （schema 再 re-export），而 `typography/document.ts` 与 `core/quad.ts` 都要
 * 引用它们。任何运行期依赖都会把 `schema.ts` → `i18n`（里面有 `$state`）
 * 拖进纯数学模块，单测与 E2E 都跑不起来。
 *
 * 为什么类型定义从 `schema.ts` 搬到这里：`typography/document.ts` 需要给
 * `ImageElement` 加同样两个字段，而 `schema.ts` 已经 import 了
 * `typography/document.ts`。类型可以循环（编译期擦除），但**运行时函数**
 * （`defaultKeySettings` / `identityQuad`）不能 —— 所以把定义与默认值放在这个
 * 谁都不依赖的叶子里。
 */

/** 简易抠图（色键）参数。四项语义见 `engine/placement.frag.ts` 的文件头。 */
export interface KeySettings {
  /** 要抠掉的颜色，`#rrggbb`。 */
  color: string;
  /** 色度距离容差（0..1），距离小于它的像素完全透明。 */
  tolerance: number;
  /** 柔边宽度（0..1）。 */
  softness: number;
  /** 溢色抑制（0..1）。 */
  spill: number;
}

/**
 * 画面裁剪（`SourceClip.crop`）：四个值都是**该边被裁掉的源比例**（0..1）。
 *
 * 语义 = **只收可见窗口，不缩放内容**（AE 的 Crop）。所以它能做到一件别的手段
 * 做不到的事：把 16:9 的素材裁成一条竖带，而图层矩形与内容比例都不变。
 *
 * ⚠️ 与 `TypographyDocument` 里 `ImageElement.crop`（`{x,y,w,h}` 源窗**铺满**
 * 元素框）**不是同一件事**：那个的框是用户随便给的，所以「取一块铺进去」才是
 * 它要表达的；片段的框是由 fit 从源比例推出来的，同一套语义就退化成「放大 +
 * 偏移」（用 `transform.sx/sy` 已经能做到）。别把两者合并。
 */
export interface CropSettings {
  /** 左边被裁掉的比例。 */
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/**
 * 一对边裁完之后至少要留这么多（占源的比例）。
 *
 * 不留下限的话，`left + right = 1` 是一个「整层消失」的合法状态 ——
 * 画面上看不出发生了什么，用户只会以为渲染坏了。
 */
export const MIN_CROP_KEEP = 0.02;

/**
 * 四角调整（透视变形）：把默认矩形的四个角拖到这四个位置。
 *
 * 坐标在**层空间**：`(0,0)` = 矩形左上、`(1,1)` = 右下（左上原点、v 向下）。
 * 每个角是 `[x, y]`。渲染按「单位方 → 四角」单应的**逆映射**采样。
 */
export interface QuadCorners {
  tl: [number, number];
  tr: [number, number];
  br: [number, number];
  bl: [number, number];
}

/**
 * 抠图参数的出厂值：纯绿幕 + 适中的容差 / 柔边 / 溢色抑制。
 *
 * 选绿幕而不是「黑 / 白」：算法艺术与故障艺术里大块纯绿背景最少见，
 * 默认值误伤画面的概率最低。
 */
export function defaultKeySettings(): KeySettings {
  return { color: '#00ff00', tolerance: 0.25, softness: 0.12, spill: 0.5 };
}

/** 四角调整的恒等值：四角 = 单位方四角（= 不调整）。 */
export function identityQuad(): QuadCorners {
  return { tl: [0, 0], tr: [1, 0], br: [1, 1], bl: [0, 1] };
}

/** 裁剪的恒等值：四条边都不裁。 */
export function identityCrop(): CropSettings {
  return { left: 0, top: 0, right: 0, bottom: 0 };
}

/** 全零 = 不裁。渲染侧靠它决定 `u_cropOn`（关闭时走与改动前逐位相同的算式）。 */
export function isIdentityCrop(c: CropSettings): boolean {
  return c.left === 0 && c.top === 0 && c.right === 0 && c.bottom === 0;
}

/* --------------------------------------------------- 外部输入的校验 / 归一化
 *
 * 片段（`SourceClip`）与排版图片元素（`ImageElement`）共用同一组字段，写入端
 * 也因此共用同一份校验 —— 两处各写一遍的形态是「同一个 `{tol: 0.3}` 在时间轴上
 * 有效、在排版里被静默丢掉」。**整条返回 null = 形状不对**，由调用方在改动之前
 * 报错（这一层不抛）。
 */

const HEX_COLOR_RE = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

function isRec(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function numIn(v: unknown, min: number, max: number): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : null;
}

/**
 * 色键参数：缺省字段从 `base` 继承（局部改）。`color` 必须是 `#rgb` / `#rrggbb`。
 */
export function coerceKeySettings(raw: unknown, base?: KeySettings): KeySettings | null {
  if (!isRec(raw)) return null;
  const start = base ?? defaultKeySettings();
  let color = start.color;
  if (raw.color !== undefined) {
    if (typeof raw.color !== 'string' || !HEX_COLOR_RE.test(raw.color)) return null;
    color = raw.color;
  }
  const tolerance = raw.tolerance === undefined ? start.tolerance : numIn(raw.tolerance, 0, 1);
  const softness = raw.softness === undefined ? start.softness : numIn(raw.softness, 0, 1);
  const spill = raw.spill === undefined ? start.spill : numIn(raw.spill, 0, 1);
  if (tolerance === null || softness === null || spill === null) return null;
  return { color, tolerance, softness, spill };
}

/**
 * 四角：每个是 `[x, y]` 两个有限数，且**面积不为 0**。
 *
 * 退化四边形算不出透视矩阵，渲染结果是整层消失 —— 最难归因的一类「静默无效」。
 */
export function coerceQuadCorners(raw: unknown): QuadCorners | null {
  if (!isRec(raw)) return null;
  const corner = (v: unknown): [number, number] | null => {
    if (!Array.isArray(v) || v.length !== 2) return null;
    const x = Number(v[0]);
    const y = Number(v[1]);
    return Number.isFinite(x) && Number.isFinite(y) ? [x, y] : null;
  };
  const tl = corner(raw.tl);
  const tr = corner(raw.tr);
  const br = corner(raw.br);
  const bl = corner(raw.bl);
  if (!tl || !tr || !br || !bl) return null;
  const area =
    Math.abs(
      tl[0] * tr[1] - tr[0] * tl[1] +
        tr[0] * br[1] - br[0] * tr[1] +
        br[0] * bl[1] - bl[0] * br[1] +
        bl[0] * tl[1] - tl[0] * bl[1],
    ) / 2;
  return area > 1e-6 ? { tl, tr, br, bl } : null;
}

/**
 * 裁剪：四条边各自 0..1，走 `withCropEdge` 的**对边互斥**钳制。
 *
 * 局部对象合法（只改一条边）；是否该删字段（全零）由调用方判断。
 */
export function coerceCropEdges(raw: unknown, base: CropSettings): CropSettings | null {
  if (!isRec(raw)) return null;
  let next = { ...base };
  for (const edge of ['left', 'top', 'right', 'bottom'] as const) {
    if (raw[edge] === undefined) continue;
    const v = numIn(raw[edge], 0, 1);
    if (v === null) return null;
    next = withCropEdge(next, edge, v);
  }
  return next;
}

/**
 * 改一条边的裁剪量，并把结果钳在合法范围内（返回新对象）。
 *
 * 钳的是**这一条边的上限**：对边已经吃掉的部分不能重复吃。UI 的输入框与滑杆
 * 都走这里，于是「两个输入框都填 0.8」在写入前就被压成 0.8 + 0.18。
 */
export function withCropEdge(
  c: CropSettings,
  edge: keyof CropSettings,
  v: number,
): CropSettings {
  const opposite: Record<keyof CropSettings, keyof CropSettings> = {
    left: 'right',
    right: 'left',
    top: 'bottom',
    bottom: 'top',
  };
  const max = Math.max(0, 1 - c[opposite[edge]] - MIN_CROP_KEEP);
  const n = Number.isFinite(v) ? Math.min(Math.max(v, 0), max) : 0;
  return { ...c, [edge]: n };
}

/** 形状 / 范围校验（schema 用）。坏形状在打开工程时就挡住，不让它穿透到着色器。 */
export function isValidCrop(v: unknown): v is CropSettings {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return false;
  const c = v as Partial<CropSettings>;
  const unit = (x: unknown): x is number =>
    typeof x === 'number' && Number.isFinite(x) && x >= 0 && x < 1;
  if (!unit(c.left) || !unit(c.top) || !unit(c.right) || !unit(c.bottom)) return false;
  return c.left + c.right < 1 && c.top + c.bottom < 1;
}

/** `#rrggbb` → 0..1 的三通道。坏颜色回落黑（调用点已由 schema 挡过一遍）。 */
export function hexToRgb01(hex: string): [number, number, number] {
  const m = /^#([0-9a-fA-F]{6})$/.exec(hex);
  if (!m) return [0, 0, 0];
  const n = Number.parseInt(m[1]!, 16);
  return [((n >> 16) & 0xff) / 255, ((n >> 8) & 0xff) / 255, (n & 0xff) / 255];
}

/** GLSL 的 `smoothstep`。`edge0 === edge1` 时退化成阶跃（GLSL 未定义，这里给可预测的行为）。 */
export function smoothstep(edge0: number, edge1: number, x: number): number {
  const span = edge1 - edge0;
  if (!(span > 0)) return x < edge0 ? 0 : 1;
  const t = Math.max(0, Math.min(1, (x - edge0) / span));
  return t * t * (3 - 2 * t);
}

/**
 * 一个像素「保留多少」（0 = 完全抠掉，1 = 原样）。
 *
 * `r,g,b` 是 **0..1**。公式逐字对应 `placement.frag.ts::keyDistance` + `main`
 * 里的 `keep`（改那里必须同步这里，否则「排版里抠得干净、时间轴上边缘发绿」）。
 */
export function keyKeep(r: number, g: number, b: number, key: KeySettings): number {
  const [kr, kg, kb] = hexToRgb01(key.color);
  // BT.601 色差分量：亮度被剥掉，阴影 / 高光下的同一背景落到同一个色度上。
  const cr = -0.1687 * r - 0.3313 * g + 0.5 * b;
  const cg = 0.5 * r - 0.4187 * g - 0.0813 * b;
  const kcr = -0.1687 * kr - 0.3313 * kg + 0.5 * kb;
  const kcg = 0.5 * kr - 0.4187 * kg - 0.0813 * kb;
  const dcx = cr - kcr;
  const dcy = cg - kcg;
  const dy = 0.299 * (r - kr) + 0.587 * (g - kg) + 0.114 * (b - kb);
  const dist = Math.sqrt(dcx * dcx + dcy * dcy + 0.25 * dy * dy);
  // 与 GLSL 同口径：t0 = 容差/2、宽度 = 柔边/2（下限 1e-4 防除数 0）。
  const t0 = key.tolerance * 0.5;
  const w = Math.max(key.softness * 0.5, 1e-4);
  return smoothstep(t0, t0 + w, dist);
}

/** 亮度（BT.601），溢色抑制用。 */
export function luma(r: number, g: number, b: number): number {
  return 0.299 * r + 0.587 * g + 0.114 * b;
}

/**
 * 就地给一份 RGBA 字节（0..255，canvas `ImageData` 的布局）上色键。
 *
 * 与 GLSL 一样：`a *= keep`，rgb 按 `spill * (1 - keep)` 往亮度靠。
 * **不预乘**：`ImageData` 是非预乘的，改 alpha 不改 rgb 才是正确的边缘色
 * （预乘语义下边缘会朝黑/白偏，那正是「抠出来的边缘发脏」）。
 */
export function applyKeyToRgba(
  data: Uint8ClampedArray,
  key: KeySettings,
): void {
  const [kr, kg, kb] = hexToRgb01(key.color);
  const kcr = -0.1687 * kr - 0.3313 * kg + 0.5 * kb;
  const kcg = 0.5 * kr - 0.4187 * kg - 0.0813 * kb;
  const t0 = key.tolerance * 0.5;
  const w = Math.max(key.softness * 0.5, 1e-4);
  const spill = key.spill;
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i]! / 255;
    const g = data[i + 1]! / 255;
    const b = data[i + 2]! / 255;
    const dcx = -0.1687 * r - 0.3313 * g + 0.5 * b - kcr;
    const dcy = 0.5 * r - 0.4187 * g - 0.0813 * b - kcg;
    const dy = 0.299 * (r - kr) + 0.587 * (g - kg) + 0.114 * (b - kb);
    const dist = Math.sqrt(dcx * dcx + dcy * dcy + 0.25 * dy * dy);
    const keep = smoothstep(t0, t0 + w, dist);
    if (keep >= 1) continue;
    data[i + 3] = data[i + 3]! * keep;
    if (spill > 0 && keep < 1) {
      const l = luma(r, g, b) * 255;
      const k = spill * (1 - keep);
      data[i] = data[i]! + (l - data[i]!) * k;
      data[i + 1] = data[i + 1]! + (l - data[i + 1]!) * k;
      data[i + 2] = data[i + 2]! + (l - data[i + 2]!) * k;
    }
  }
}

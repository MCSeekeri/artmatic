/**
 * image-effects.ts — 图片元素的**色彩校正 / 重新着色 / 滤镜**（纯像素函数）。
 *
 * 与 `typography/image-fx.ts`（抠图 + 四角）同一条路：排版渲染成 DOM，没有
 * GPU 的 placement pass，所以一切都是 CPU 逐像素。本文件只做「给定 RGBA 上
 * 干什么」，**不碰 canvas、不碰 DOM**，因此可以单测（`tests/unit/image-effects.test.ts`）。
 *
 * ## 三条纪律
 *
 * 1. **确定性**：不许 `Math.random()`（AGENTS §1.2）。噪点 / 故障用的是
 *    坐标哈希，同一张图同一个参数两次渲染逐字节相同。
 * 2. **幂等的数据形状**：所有 `coerceXxx` 永不抛，形状不对返回 null ——
 *    调用方在改动**之前**报错（与 `core/image-fx.ts` 的 `coerceKeySettings`
 *    同一套约定），打开工程那条路则直接丢掉坏字段、让画面回落到「没开」。
 * 3. **顺序固定**：色彩校正 → 柔化 → 锐化 → 滤镜 → 重新着色。
 *    换顺序会改变成品（锐化后再柔化 = 白干），所以顺序写死在
 *    `image-fx.ts::renderFx` 一处，本文件只提供单步。
 */

import type { MessageKey } from '../i18n/locales';

/* ------------------------------------------------------------ 类型 */

/** 曲线上的一个控制点，坐标都是 0..1（x = 输入，y = 输出）。 */
export interface CurvePoint {
  x: number;
  y: number;
}

/**
 * 曲线通道。`master` 先作用，再叠各通道自己的曲线 —— 与 Photoshop 的
 * 「RGB 复合 + 单通道」一致。
 */
export type CurveChannel = 'master' | 'r' | 'g' | 'b';

/** 四组曲线的**稀疏**存储：没动过的通道不写键（工程文件不膨胀）。 */
export interface CurveSet {
  master?: CurvePoint[];
  r?: CurvePoint[];
  g?: CurvePoint[];
  b?: CurvePoint[];
}

/** 色彩校正。缺省值全 0 = 不改画面。 */
export interface ImageAdjust {
  /** -100..100，0 = 不变。 */
  brightness: number;
  /** -100..100，0 = 不变。 */
  contrast: number;
  /** -100..100，0 = 不变（-100 = 灰度）。 */
  saturation: number;
  /** 0..100，0 = 不锐化。 */
  sharpen: number;
  /** 0..100，0 = 不柔化。 */
  soften: number;
  /** RGB 曲线。空 / 缺省 = 不调。 */
  curves?: CurveSet;
}

/**
 * 色彩校正的**写入补丁**：`curves: null` = 全部清掉。
 *
 * 单独一个类型是为了让「清空曲线」能用一个明确的 `null` 表达 —— 写成
 * `{}` 或逐通道空数组都会漏掉其中一条，而漏掉的那条会继续压着画面。
 */
export type ImageAdjustPatch = Partial<Omit<ImageAdjust, 'curves'>> & {
  curves?: CurveSet | null;
};

/**
 * 重新着色：把**亮度**映射到一条双色渐变上（暗 → 亮）。
 *
 * 用两色而不是单色：单色映射会丢掉全部明暗层次，看起来像一整块色板盖在图上
 * （用户报过「字/图都糊成一片」）。两色至少保留体积感。
 */
export interface ImageRecolor {
  /** 亮部颜色（亮度 1 处）。 */
  color: string;
  /** 暗部颜色（亮度 0 处）。 */
  shadow: string;
  /** 0..1，与原因像混合的比例。0 = 关。 */
  amount: number;
}

/** 图片边框（画在图片内部，不撑大元素框）。`width = 0` 等于没有边框。 */
export interface ImageBorder {
  color: string;
  width: number;
}

/** 滤镜表。**只写 labelKey**，文案在 `i18n/locales/zh-CN/typography.ts`。 */
export interface ImageFilterDef {
  id: string;
  labelKey: MessageKey;
}

/**
 * 17 个滤镜。
 *
 * 顺序即面板顺序：先「颜色类」（不动邻域，便宜），再「质感类」（要卷积），
 * 最后「风格类」。用户找东西是按这个心智找的，不是按字母。
 */
export const IMAGE_FILTERS: ImageFilterDef[] = [
  { id: 'grayscale', labelKey: 'rib.imgfx.grayscale' },
  { id: 'sepia', labelKey: 'rib.imgfx.sepia' },
  { id: 'invert', labelKey: 'rib.imgfx.invert' },
  { id: 'posterize', labelKey: 'rib.imgfx.posterize' },
  { id: 'threshold', labelKey: 'rib.imgfx.threshold' },
  { id: 'duotone', labelKey: 'rib.imgfx.duotone' },
  { id: 'blur', labelKey: 'rib.imgfx.blur' },
  { id: 'sharpen', labelKey: 'rib.imgfx.sharpen' },
  { id: 'emboss', labelKey: 'rib.imgfx.emboss' },
  { id: 'sketch', labelKey: 'rib.imgfx.sketch' },
  { id: 'neon', labelKey: 'rib.imgfx.neon' },
  { id: 'mosaic', labelKey: 'rib.imgfx.mosaic' },
  { id: 'halftone', labelKey: 'rib.imgfx.halftone' },
  { id: 'vignette', labelKey: 'rib.imgfx.vignette' },
  { id: 'glitch', labelKey: 'rib.imgfx.glitch' },
  { id: 'noise', labelKey: 'rib.imgfx.noise' },
  { id: 'scanlines', labelKey: 'rib.imgfx.scanlines' },
];

export type ImageFilterId =
  | 'grayscale'
  | 'sepia'
  | 'invert'
  | 'posterize'
  | 'threshold'
  | 'duotone'
  | 'blur'
  | 'sharpen'
  | 'emboss'
  | 'sketch'
  | 'neon'
  | 'mosaic'
  | 'halftone'
  | 'vignette'
  | 'glitch'
  | 'noise'
  | 'scanlines';

const FILTER_IDS = new Set<string>(IMAGE_FILTERS.map((f) => f.id));

export function isImageFilterId(v: unknown): v is ImageFilterId {
  return typeof v === 'string' && FILTER_IDS.has(v);
}

/** 当前生效的滤镜（`id` + 强度）。 */
export interface ImageFilterState {
  id: ImageFilterId;
  /** 0..1。 */
  amount: number;
}

/* ------------------------------------------------------------ 默认值 / 判空 */

export function defaultImageAdjust(): ImageAdjust {
  return { brightness: 0, contrast: 0, saturation: 0, sharpen: 0, soften: 0 };
}

/** 重新着色的默认色：冷调深蓝 → 暖调米白（不刺眼，也不吃掉明暗）。 */
export function defaultImageRecolor(): ImageRecolor {
  return { color: '#ffd9a0', shadow: '#1b2a4a', amount: 1 };
}

export function defaultImageBorder(): ImageBorder {
  return { color: '#ffffff', width: 4 };
}

/** 没有任何一组曲线有内容。 */
export function curvesEmpty(c: CurveSet | undefined): boolean {
  if (!c) return true;
  return !c.master?.length && !c.r?.length && !c.g?.length && !c.b?.length;
}

/**
 * 色彩校正是不是「什么都不做」。
 *
 * 判空的意义不只是省一次 canvas：`imageNeedsFx()` 据它决定要不要把 `<img>`
 * 换成 `<canvas>`，多算一个全 0 的调整会让老工程凭空走进 CPU 路径（画质与
 * 性能都变，而用户什么都没改）。
 */
export function adjustIsDefault(a: ImageAdjust | undefined): boolean {
  if (!a) return true;
  return (
    !a.brightness &&
    !a.contrast &&
    !a.saturation &&
    !a.sharpen &&
    !a.soften &&
    curvesEmpty(a.curves)
  );
}

export function recolorIsDefault(r: ImageRecolor | undefined): boolean {
  return !r || !(r.amount > 0);
}

/* ------------------------------------------------------------ 校验 */

function isRec(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function numIn(v: unknown, min: number, max: number): number | null {
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return Math.min(max, Math.max(min, n));
}

const HEX_RE = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;
/**
 * 配色方案槽位引用（`@accent1` / `@accent1.l80`）。
 *
 * 只给**画在 CSS 上的**颜色用（边框）：它在渲染期经 `resolveThemeColor` 解析，
 * 所以「换配色方案 ⇒ 边框跟着变」是免费的。**重新着色 / 抠图的颜色不能收引用**
 * —— 那些颜色要在 CPU 里参与逐像素计算，`@accent1` 在那个上下文里不是颜色。
 */
const THEME_REF_RE = /^@[a-z]+\d*(?:\.[a-z]\d+)?$/i;

function isHex(v: unknown): v is string {
  return typeof v === 'string' && HEX_RE.test(v);
}

function isThemeRef(v: unknown): v is string {
  return typeof v === 'string' && THEME_REF_RE.test(v);
}

/** 单条曲线：最多 16 个点、按 x 排序、去重、两端补齐。坏输入 → null。 */
export function coerceCurvePoints(raw: unknown): CurvePoint[] | null {
  if (!Array.isArray(raw)) return null;
  const out: CurvePoint[] = [];
  for (const item of raw.slice(0, 16)) {
    if (!isRec(item)) continue;
    const x = numIn(item.x, 0, 1);
    const y = numIn(item.y, 0, 1);
    if (x === null || y === null) continue;
    out.push({ x, y });
  }
  if (!out.length) return null;
  out.sort((a, b) => a.x - b.x);
  // 同一个 x 只留最后一个：曲线函数要求 x 单增，否则插值会跳变。
  const dedup: CurvePoint[] = [];
  for (const p of out) {
    if (dedup.length && Math.abs(dedup[dedup.length - 1]!.x - p.x) < 1e-4) dedup[dedup.length - 1] = p;
    else dedup.push(p);
  }
  return dedup;
}

const CURVE_KEYS: CurveChannel[] = ['master', 'r', 'g', 'b'];

export function coerceCurveSet(raw: unknown): CurveSet | undefined {
  if (!isRec(raw)) return undefined;
  const out: CurveSet = {};
  for (const key of CURVE_KEYS) {
    if (raw[key] === undefined) continue;
    // `null` / `[]` = 清掉该通道（面板的「重置这条曲线」写的就是它）。
    if (raw[key] === null) continue;
    const pts = coerceCurvePoints(raw[key]);
    if (pts) out[key] = pts;
  }
  return curvesEmpty(out) ? undefined : out;
}

/** 色彩校正的入参校验。缺省字段从 `base` 继承（局部改）。 */
export function coerceImageAdjust(raw: unknown, base?: ImageAdjust): ImageAdjust | null {
  if (!isRec(raw)) return null;
  const start = base ?? defaultImageAdjust();
  const pick = (key: keyof Omit<ImageAdjust, 'curves'>, min: number, max: number): number => {
    const v = raw[key] === undefined ? start[key] : numIn(raw[key], min, max);
    return v === null ? start[key] : v;
  };
  const out: ImageAdjust = {
    brightness: pick('brightness', -100, 100),
    contrast: pick('contrast', -100, 100),
    saturation: pick('saturation', -100, 100),
    sharpen: pick('sharpen', 0, 100),
    soften: pick('soften', 0, 100),
  };
  /*
   * `curves: null` = 全部清掉。不这么约定的话「关掉曲线」在工具面上只能靠
   * 逐通道写空数组，模型几乎一定会漏掉其中一条。
   */
  if (raw.curves === null) {
    // 显式清空：不写键。
  } else if (raw.curves !== undefined) {
    const set = coerceCurveSet(raw.curves);
    if (set) out.curves = set;
    else if (start.curves) out.curves = start.curves;
  } else if (start.curves) {
    out.curves = start.curves;
  }
  return out;
}

export function coerceImageRecolor(raw: unknown, base?: ImageRecolor): ImageRecolor | null {
  if (!isRec(raw)) return null;
  const start = base ?? defaultImageRecolor();
  const color = raw.color === undefined ? start.color : isHex(raw.color) ? raw.color : null;
  const shadow = raw.shadow === undefined ? start.shadow : isHex(raw.shadow) ? raw.shadow : null;
  const amount = raw.amount === undefined ? start.amount : numIn(raw.amount, 0, 1);
  if (color === null || shadow === null || amount === null) return null;
  return { color, shadow, amount };
}

export function coerceImageBorder(raw: unknown, base?: ImageBorder): ImageBorder | null {
  if (!isRec(raw)) return null;
  const start = base ?? defaultImageBorder();
  const color =
    raw.color === undefined
      ? start.color
      : isHex(raw.color) || isThemeRef(raw.color)
        ? raw.color
        : null;
  // 上限 200px：再厚的边框已经不是边框了（而且会把图片整个盖掉）。
  const width = raw.width === undefined ? start.width : numIn(raw.width, 0, 200);
  if (color === null || width === null) return null;
  return { color, width };
}

export function coerceImageFilter(raw: unknown, base?: ImageFilterState): ImageFilterState | null {
  if (!isRec(raw)) return null;
  const id = raw.id === undefined ? base?.id : raw.id;
  if (!isImageFilterId(id)) return null;
  const amount = raw.amount === undefined ? (base?.amount ?? 0.6) : numIn(raw.amount, 0, 1);
  if (amount === null) return null;
  return { id, amount };
}

/* ------------------------------------------------------------ 数学 */

function clamp255(v: number): number {
  return v < 0 ? 0 : v > 255 ? 255 : v;
}

function hexToRgb255(hex: string): [number, number, number] {
  const m = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.exec(hex);
  if (!m) return [0, 0, 0];
  let s = m[1]!;
  if (s.length === 3) s = s[0]! + s[0]! + s[1]! + s[1]! + s[2]! + s[2]!;
  const n = Number.parseInt(s, 16);
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
}

/**
 * 曲线控制点 → 256 项查找表。
 *
 * 分段**线性**插值：曲线编辑器里画的就是折线，用户拖动时所见即所得。
 * 三次样条在两点之间会自己鼓出去，表现成「我只提亮中间，暗部却更暗了」。
 */
export function curveLut(points: readonly CurvePoint[]): Uint8Array {
  const out = new Uint8Array(256);
  if (!points.length) {
    for (let i = 0; i < 256; i++) out[i] = i;
    return out;
  }
  const pts = points;
  for (let i = 0; i < 256; i++) {
    const x = i / 255;
    let y: number;
    if (x <= pts[0]!.x) {
      // 首点左侧：从 (0,0) 到首点（没有这个补段的话，首点在 0.3 时暗部会被整段拉平）。
      y = pts[0]!.x > 0 ? (pts[0]!.y * x) / pts[0]!.x : pts[0]!.y;
    } else if (x >= pts[pts.length - 1]!.x) {
      const last = pts[pts.length - 1]!;
      y = last.x < 1 ? last.y + ((1 - last.y) * (x - last.x)) / (1 - last.x) : last.y;
    } else {
      let k = 0;
      while (k < pts.length - 2 && x > pts[k + 1]!.x) k++;
      const a = pts[k]!;
      const b = pts[k + 1]!;
      const span = b.x - a.x;
      y = span > 1e-6 ? a.y + ((b.y - a.y) * (x - a.x)) / span : a.y;
    }
    out[i] = clamp255(Math.round(y * 255));
  }
  return out;
}

/** 逐通道 LUT（亮度 + 对比度 + 曲线）。`master` 先查，再查通道表。 */
function buildLuts(adjust: ImageAdjust): { master: Uint8Array | null; r: Uint8Array; g: Uint8Array; b: Uint8Array } {
  const k = (100 + adjust.contrast) / 100;
  const offset = adjust.brightness * 2.55;
  const curves = adjust.curves;
  const master = curves?.master?.length ? curveLut(curves.master) : null;
  const base = (): Uint8Array => {
    const lut = new Uint8Array(256);
    for (let i = 0; i < 256; i++) lut[i] = clamp255(Math.round((i - 128) * k + 128 + offset));
    return lut;
  };
  const channel = (pts: CurvePoint[] | undefined): Uint8Array => {
    const lut = base();
    if (!pts?.length) return lut;
    const c = curveLut(pts);
    for (let i = 0; i < 256; i++) lut[i] = c[lut[i]!]!;
    return lut;
  };
  return {
    master,
    r: channel(curves?.r),
    g: channel(curves?.g),
    b: channel(curves?.b),
  };
}

/**
 * 色彩校正（亮度 / 对比度 / 饱和度 / 曲线）—— **就地**改 RGBA。
 *
 * 饱和度用 Rec.709 亮度（与 CSS `filter: saturate()` 同一组系数），所以
 * 面板上「饱和度 -100」与 CSS 的灰度观感一致。
 */
export function applyImageAdjustments(
  data: Uint8ClampedArray,
  adjust: ImageAdjust | undefined,
): void {
  if (!adjust || adjustIsDefault(adjust)) return;
  const { master, r, g, b } = buildLuts(adjust);
  const sat = 1 + Math.max(-100, Math.min(100, adjust.saturation)) / 100;
  const doSat = Math.abs(sat - 1) > 1e-6;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] === 0) continue;
    let rr = r[master ? master[data[i]!]! : data[i]!]!;
    let gg = g[master ? master[data[i + 1]!]! : data[i + 1]!]!;
    let bb = b[master ? master[data[i + 2]!]! : data[i + 2]!]!;
    if (doSat) {
      const luma = 0.2126 * rr + 0.7152 * gg + 0.0722 * bb;
      rr = clamp255(luma + (rr - luma) * sat);
      gg = clamp255(luma + (gg - luma) * sat);
      bb = clamp255(luma + (bb - luma) * sat);
    }
    data[i] = rr;
    data[i + 1] = gg;
    data[i + 2] = bb;
  }
}

/** 重新着色：亮度 → 双色渐变，再按 `amount` 与原图混合。就地。 */
export function applyImageRecolor(data: Uint8ClampedArray, recolor: ImageRecolor | undefined): void {
  if (!recolor || !(recolor.amount > 0)) return;
  const a = Math.min(1, recolor.amount);
  const [sr, sg, sb] = hexToRgb255(recolor.shadow);
  const [hr, hg, hb] = hexToRgb255(recolor.color);
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] === 0) continue;
    const l = (0.2126 * data[i]! + 0.7152 * data[i + 1]! + 0.0722 * data[i + 2]!) / 255;
    const tr = sr + (hr - sr) * l;
    const tg = sg + (hg - sg) * l;
    const tb = sb + (hb - sb) * l;
    data[i] = data[i]! + (tr - data[i]!) * a;
    data[i + 1] = data[i + 1]! + (tg - data[i + 1]!) * a;
    data[i + 2] = data[i + 2]! + (tb - data[i + 2]!) * a;
  }
}

/* ------------------------------------------------------------ 空间滤波 */

/**
 * 可分离盒式模糊（预乘 alpha）。`r` 是半径（像素），1 = 3×3。
 *
 * 预乘是必须的：图片通常带透明边（抠图之后尤其），直接对 RGB 取均值会把
 * 透明区的黑色拖进来，边缘出现一圈灰。
 */
export function boxBlur(data: Uint8ClampedArray, w: number, h: number, r: number): void {
  const radius = Math.max(1, Math.round(r));
  if (radius < 1 || w < 2 || h < 2) return;
  /*
   * 两块 scratch 都是 `Uint8ClampedArray`，不是 Float32：4096² 的 Float32 是
   * 268 MB/块，叠上 data 与调用方可能持有的副本会直接顶爆堆。预乘后的值仍落在
   * 0..255，用 8 位存只差一次取整（视觉不可见）。
   */
  const src = new Uint8ClampedArray(data.length);
  const tmp = new Uint8ClampedArray(data.length);
  for (let i = 0; i < data.length; i += 4) {
    const a = data[i + 3]! / 255;
    src[i] = data[i]! * a;
    src[i + 1] = data[i + 1]! * a;
    src[i + 2] = data[i + 2]! * a;
    src[i + 3] = data[i + 3]!;
  }
  // 横向
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) {
      let sr = 0;
      let sg = 0;
      let sb = 0;
      let sa = 0;
      let count = 0;
      const x0 = Math.max(0, x - radius);
      const x1 = Math.min(w - 1, x + radius);
      for (let xx = x0; xx <= x1; xx++) {
        const o = (row + xx) * 4;
        sr += src[o]!;
        sg += src[o + 1]!;
        sb += src[o + 2]!;
        sa += src[o + 3]!;
        count++;
      }
      const o = (row + x) * 4;
      tmp[o] = sr / count;
      tmp[o + 1] = sg / count;
      tmp[o + 2] = sb / count;
      tmp[o + 3] = sa / count;
    }
  }
  // 纵向
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) {
      let sr = 0;
      let sg = 0;
      let sb = 0;
      let sa = 0;
      let count = 0;
      const y0 = Math.max(0, y - radius);
      const y1 = Math.min(h - 1, y + radius);
      for (let yy = y0; yy <= y1; yy++) {
        const o = (yy * w + x) * 4;
        sr += tmp[o]!;
        sg += tmp[o + 1]!;
        sb += tmp[o + 2]!;
        sa += tmp[o + 3]!;
        count++;
      }
      const o = (y * w + x) * 4;
      const alpha = sa / count;
      const un = alpha > 1e-3 ? 255 / alpha : 0;
      data[o] = (sr / count) * un;
      data[o + 1] = (sg / count) * un;
      data[o + 2] = (sb / count) * un;
      data[o + 3] = alpha;
    }
  }
}

/** 柔化半径：按短边比例推，小图不会「一糊到底」。 */
function softenRadius(w: number, h: number, amount: number): number {
  return Math.max(1, Math.round((Math.min(w, h) * 0.02 * Math.min(100, amount)) / 100 * 6));
}

/** 锐化（unsharp mask）：原图 + 强度 ×（原图 − 模糊）。就地。 */
export function applySharpen(data: Uint8ClampedArray, w: number, h: number, amount: number): void {
  if (!(amount > 0)) return;
  const k = (Math.min(100, amount) / 100) * 1.6;
  const blurred = new Uint8ClampedArray(data);
  boxBlur(blurred, w, h, Math.max(1, Math.round(Math.min(w, h) / 400)));
  for (let i = 0; i < data.length; i += 4) {
    for (let c = 0; c < 3; c++) {
      const o = data[i + c]!;
      data[i + c] = clamp255(o + (o - blurred[i + c]!) * k);
    }
  }
}

function applySoften(data: Uint8ClampedArray, w: number, h: number, amount: number): void {
  if (!(amount > 0)) return;
  boxBlur(data, w, h, softenRadius(w, h, amount));
}

/** 确定性哈希（0..1）。坐标 + 盐 → 稳定的伪随机，禁止 Math.random。 */
function hash01(x: number, y: number, salt: number): number {
  let n = (x * 374761393 + y * 668265263 + salt * 2147483647) | 0;
  n = (n ^ (n >>> 13)) | 0;
  n = Math.imul(n, 1274126177) | 0;
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
}

function lumaAt(data: Uint8ClampedArray, i: number): number {
  return 0.2126 * data[i]! + 0.7152 * data[i + 1]! + 0.0722 * data[i + 2]!;
}

/** 混合系数：滤镜结果与原图的比例。 */
function mixTo(data: Uint8ClampedArray, filtered: Uint8ClampedArray, amount: number): void {
  const a = Math.min(1, Math.max(0, amount));
  for (let i = 0; i < data.length; i += 4) {
    data[i] = data[i]! + (filtered[i]! - data[i]!) * a;
    data[i + 1] = data[i + 1]! + (filtered[i + 1]! - data[i + 1]!) * a;
    data[i + 2] = data[i + 2]! + (filtered[i + 2]! - data[i + 2]!) * a;
  }
}

/* ------------------------------------------------------------ 滤镜 */

/** 单个滤镜。就地修改（内部需要邻域时自己拷贝一份）。 */
export function applyImageFilter(
  data: Uint8ClampedArray,
  w: number,
  h: number,
  filter: ImageFilterState | undefined,
): void {
  if (!filter || !isImageFilterId(filter.id)) return;
  const amount = Math.min(1, Math.max(0, filter.amount));
  if (!(amount > 0)) return;

  switch (filter.id) {
    case 'grayscale': {
      const out = new Uint8ClampedArray(data);
      for (let i = 0; i < out.length; i += 4) {
        const l = lumaAt(out, i);
        out[i] = l;
        out[i + 1] = l;
        out[i + 2] = l;
      }
      mixTo(data, out, amount);
      return;
    }
    case 'sepia': {
      const out = new Uint8ClampedArray(data);
      for (let i = 0; i < out.length; i += 4) {
        const r = out[i]!;
        const g = out[i + 1]!;
        const b = out[i + 2]!;
        out[i] = clamp255(0.393 * r + 0.769 * g + 0.189 * b);
        out[i + 1] = clamp255(0.349 * r + 0.686 * g + 0.168 * b);
        out[i + 2] = clamp255(0.272 * r + 0.534 * g + 0.131 * b);
      }
      mixTo(data, out, amount);
      return;
    }
    case 'invert': {
      const out = new Uint8ClampedArray(data);
      for (let i = 0; i < out.length; i += 4) {
        out[i] = 255 - out[i]!;
        out[i + 1] = 255 - out[i + 1]!;
        out[i + 2] = 255 - out[i + 2]!;
      }
      mixTo(data, out, amount);
      return;
    }
    case 'posterize': {
      // amount 越大颜色越少（16 级 → 2 级）。
      const levels = Math.max(2, Math.round(16 - amount * 14));
      const step = 255 / (levels - 1);
      const out = new Uint8ClampedArray(data);
      for (let i = 0; i < out.length; i += 4) {
        out[i] = Math.round(Math.round(out[i]! / step) * step);
        out[i + 1] = Math.round(Math.round(out[i + 1]! / step) * step);
        out[i + 2] = Math.round(Math.round(out[i + 2]! / step) * step);
      }
      mixTo(data, out, amount);
      return;
    }
    case 'threshold': {
      const out = new Uint8ClampedArray(data);
      // 阈值随 amount 上移：0.5 附近给中性，强档更偏「白底黑线」。
      const t = 96 + amount * 96;
      for (let i = 0; i < out.length; i += 4) {
        const v = lumaAt(out, i) >= t ? 255 : 0;
        out[i] = v;
        out[i + 1] = v;
        out[i + 2] = v;
      }
      mixTo(data, out, amount);
      return;
    }
    case 'duotone': {
      // 固定配色：深靛 → 暖橙（不开放参数，要自定义用「重新着色」）。
      const [sr, sg, sb] = [26, 35, 72];
      const [hr, hg, hb] = [255, 176, 96];
      const out = new Uint8ClampedArray(data);
      for (let i = 0; i < out.length; i += 4) {
        const l = lumaAt(out, i) / 255;
        out[i] = sr + (hr - sr) * l;
        out[i + 1] = sg + (hg - sg) * l;
        out[i + 2] = sb + (hb - sb) * l;
      }
      mixTo(data, out, amount);
      return;
    }
    case 'blur': {
      boxBlur(data, w, h, Math.max(1, Math.round((Math.min(w, h) * 0.012 * amount))));
      return;
    }
    case 'sharpen': {
      applySharpen(data, w, h, amount * 100);
      return;
    }
    case 'emboss': {
      const src = new Uint8ClampedArray(data);
      const out = new Uint8ClampedArray(data);
      for (let y = 1; y < h - 1; y++) {
        for (let x = 1; x < w - 1; x++) {
          const o = (y * w + x) * 4;
          for (let c = 0; c < 3; c++) {
            const v =
              -2 * src[o - 4 + c]! -
              src[o - w * 4 - 4 + c]! -
              src[o - w * 4 + c]! +
              src[o + w * 4 + c]! +
              src[o + w * 4 + 4 + c]! +
              2 * src[o + 4 + c]!;
            out[o + c] = clamp255(128 + v * 0.5);
          }
        }
      }
      mixTo(data, out, amount);
      return;
    }
    case 'sketch': {
      /*
       * 铅笔素描 = 「灰度 ÷ 反相模糊」（dodge blend）。
       * 分母加 1 防除零：纯白区域的反相模糊是 0，不防会得到 Infinity → 白。
       */
      const gray = new Uint8ClampedArray(w * h * 4);
      for (let i = 0; i < data.length; i += 4) {
        const l = lumaAt(data, i);
        gray[i] = l;
        gray[i + 1] = l;
        gray[i + 2] = l;
        gray[i + 3] = data[i + 3]!;
      }
      const inv = new Uint8ClampedArray(gray);
      for (let i = 0; i < inv.length; i += 4) {
        inv[i] = 255 - inv[i]!;
        inv[i + 1] = 255 - inv[i + 1]!;
        inv[i + 2] = 255 - inv[i + 2]!;
      }
      boxBlur(inv, w, h, Math.max(2, Math.round(Math.min(w, h) / 120)));
      const out = new Uint8ClampedArray(data);
      for (let i = 0; i < out.length; i += 4) {
        for (let c = 0; c < 3; c++) {
          const g = gray[i + c]!;
          const b = inv[i + c]!;
          out[i + c] = b >= 255 ? 255 : clamp255((g * 255) / (255 - b));
        }
      }
      mixTo(data, out, amount);
      return;
    }
    case 'neon': {
      // Sobel 边缘 → 青色发光，底子压暗（霓虹要暗底才亮得起来）。
      const luma = new Uint8ClampedArray(w * h);
      for (let i = 0, p = 0; i < data.length; i += 4, p++) luma[p] = lumaAt(data, i);
      const out = new Uint8ClampedArray(data);
      for (let y = 1; y < h - 1; y++) {
        for (let x = 1; x < w - 1; x++) {
          const p = y * w + x;
          const gx =
            -luma[p - w - 1]! - 2 * luma[p - 1]! - luma[p + w - 1]! +
            luma[p - w + 1]! + 2 * luma[p + 1]! + luma[p + w + 1]!;
          const gy =
            -luma[p - w - 1]! - 2 * luma[p - w]! - luma[p - w + 1]! +
            luma[p + w - 1]! + 2 * luma[p + w]! + luma[p + w + 1]!;
          const mag = Math.min(1, Math.hypot(gx, gy) / 255);
          const o = p * 4;
          out[o] = clamp255(data[o]! * 0.12 + 40 * mag);
          out[o + 1] = clamp255(data[o + 1]! * 0.16 + 235 * mag);
          out[o + 2] = clamp255(data[o + 2]! * 0.2 + 255 * mag);
        }
      }
      mixTo(data, out, amount);
      return;
    }
    case 'mosaic': {
      const block = Math.max(2, Math.round((Math.min(w, h) * (0.004 + amount * 0.05))));
      for (let by = 0; by < h; by += block) {
        for (let bx = 0; bx < w; bx += block) {
          let sr = 0;
          let sg = 0;
          let sb = 0;
          let sa = 0;
          let n = 0;
          const y1 = Math.min(h, by + block);
          const x1 = Math.min(w, bx + block);
          for (let y = by; y < y1; y++) {
            for (let x = bx; x < x1; x++) {
              const o = (y * w + x) * 4;
              sr += data[o]!;
              sg += data[o + 1]!;
              sb += data[o + 2]!;
              sa += data[o + 3]!;
              n++;
            }
          }
          if (!n) continue;
          sr /= n;
          sg /= n;
          sb /= n;
          sa /= n;
          for (let y = by; y < y1; y++) {
            for (let x = bx; x < x1; x++) {
              const o = (y * w + x) * 4;
              data[o] = sr;
              data[o + 1] = sg;
              data[o + 2] = sb;
              data[o + 3] = sa;
            }
          }
        }
      }
      return;
    }
    case 'halftone': {
      const cell = Math.max(3, Math.round(Math.min(w, h) * 0.012));
      const out = new Uint8ClampedArray(data);
      for (let by = 0; by < h; by += cell) {
        for (let bx = 0; bx < w; bx += cell) {
          let sum = 0;
          let n = 0;
          const y1 = Math.min(h, by + cell);
          const x1 = Math.min(w, bx + cell);
          for (let y = by; y < y1; y++) {
            for (let x = bx; x < x1; x++) {
              sum += lumaAt(data, (y * w + x) * 4);
              n++;
            }
          }
          const avg = n ? sum / n : 255;
          // 越暗点越大：半径与 (1 - 亮度) 成正比。
          const radius = (cell / 2) * Math.sqrt(1 - avg / 255);
          const cx = bx + cell / 2;
          const cy = by + cell / 2;
          for (let y = by; y < y1; y++) {
            for (let x = bx; x < x1; x++) {
              const o = (y * w + x) * 4;
              const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
              const v = d <= radius ? 0 : 255;
              out[o] = v;
              out[o + 1] = v;
              out[o + 2] = v;
            }
          }
        }
      }
      mixTo(data, out, amount);
      return;
    }
    case 'vignette': {
      const cx = w / 2;
      const cy = h / 2;
      const maxD = Math.hypot(cx, cy);
      const out = new Uint8ClampedArray(data);
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy) / maxD;
          // 中心 40% 不压，向外平滑加深。
          const t = Math.max(0, Math.min(1, (d - 0.4) / 0.6));
          const k = 1 - t * t * amount * 0.95;
          const o = (y * w + x) * 4;
          out[o] = out[o]! * k;
          out[o + 1] = out[o + 1]! * k;
          out[o + 2] = out[o + 2]! * k;
        }
      }
      mixTo(data, out, amount);
      return;
    }
    case 'glitch': {
      /*
       * 故障：RGB 三通道错位 + 少量横向条带位移。位移量由 `hash01` 决定，
       * 所以同一帧两次渲染完全一致（**不能用随机数**，导出会每帧变色）。
       */
      const src = new Uint8ClampedArray(data);
      const shift = Math.max(1, Math.round((w * 0.01 + w * 0.04 * amount)));
      for (let y = 0; y < h; y++) {
        const bandY = Math.floor(y / Math.max(2, Math.round(h / 24)));
        const bandShift = hash01(bandY, 0, 7) > 0.7 ? Math.round((hash01(bandY, 1, 7) - 0.5) * shift * 2) : 0;
        for (let x = 0; x < w; x++) {
          const o = (y * w + x) * 4;
          const xr = Math.min(w - 1, Math.max(0, x + shift + bandShift));
          const xb = Math.min(w - 1, Math.max(0, x - shift + bandShift));
          const or = (y * w + xr) * 4;
          const ob = (y * w + xb) * 4;
          src[o] = data[or]!;
          src[o + 1] = data[o + 1]!;
          src[o + 2] = data[ob + 2]!;
        }
      }
      mixTo(data, src, amount);
      return;
    }
    case 'noise': {
      const out = new Uint8ClampedArray(data);
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const o = (y * w + x) * 4;
          const n = (hash01(x, y, 11) - 0.5) * 120 * amount;
          out[o] = clamp255(out[o]! + n);
          out[o + 1] = clamp255(out[o + 1]! + n);
          out[o + 2] = clamp255(out[o + 2]! + n);
        }
      }
      mixTo(data, out, amount);
      return;
    }
    case 'scanlines': {
      const period = Math.max(2, Math.round(h / 240) + 2);
      const out = new Uint8ClampedArray(data);
      for (let y = 0; y < h; y++) {
        const dark = y % period === 0 ? 1 - 0.55 * amount : 1;
        for (let x = 0; x < w; x++) {
          const o = (y * w + x) * 4;
          out[o] = out[o]! * dark;
          out[o + 1] = out[o + 1]! * dark;
          out[o + 2] = out[o + 2]! * dark;
        }
      }
      mixTo(data, out, amount);
      return;
    }
    default:
      return;
  }
}

/**
 * 一次跑完「校正 → 柔化 → 锐化 → 滤镜 → 重新着色」。
 *
 * `w` / `h` 必须是**位图**尺寸（与 `data` 的 stride 一致），不是元素框尺寸：
 * `image-fx.ts` 会按 `MAX_EDGE` 缩过一次。
 */
export function applyImageEffects(
  data: Uint8ClampedArray,
  w: number,
  h: number,
  fx: {
    adjust?: ImageAdjust;
    filter?: ImageFilterState;
    recolor?: ImageRecolor;
  },
): void {
  if (fx.adjust) {
    applyImageAdjustments(data, fx.adjust);
    applySoften(data, w, h, fx.adjust.soften);
    applySharpen(data, w, h, fx.adjust.sharpen);
  }
  applyImageFilter(data, w, h, fx.filter);
  applyImageRecolor(data, fx.recolor);
}

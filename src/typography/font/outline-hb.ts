/**
 * font/outline-hb.ts — 用 HarfBuzz 取**字形轮廓**（文本转路径的唯一字体出口）。
 *
 * ## 为什么是 harfbuzzjs 而不是 html-to-svg / opentype.js
 *
 * `tooooools/html-to-svg` 用 opentype.js 做「HTML 文字 → SVG path」，
 * 思路（Range API 做布局 + 字体轮廓做路径）与本模块相同，但它要求调用方在
 * 构造时**显式列出每个字体文件**，而我们已经有 `FontRegistry` 的字节与
 * 按 face 组织的选择逻辑；再引一份字体表等于把一个真相拆成两处。
 * 依赖上也不划算：opentype.js 是新的运行时依赖，而 HarfBuzz 已经在项目里
 * （子集化用它，MIT，`deps` 只多加载一个 wasm）。
 *
 * ## 能力边界（实测）
 *
 * - **只吃 SFNT**：对 woff2 `hb_face_get_upem` 能读出 1000，但
 *   `nominalGlyph` 全是 undefined、`glyphToPath` 是空串 —— 所以调用方必须
 *   先把 woff2 挡在外面（`FontRegistry.sfntBytes` 会返回 null）。
 * - **坐标是字体单位、y 向上**：`glyphToPath` 输出的是 `M…L…Q…C…Z` 的绝对
 *   坐标，原点在字形原点（不是墨迹左上角）。转成 SVG 要 `y = baseline - y`。
 * - **wasm 是懒加载的**：`import('harfbuzzjs')` 只在第一次转路径时发生。
 *   构建后 wasm 由 Vite 作为独立资源产出（实测 `assets/harfbuzz-*.wasm`）；
 *   dev 侧在 `vite.config.ts` 里把该包排除出预打包，否则 emscripten 胶水
 *   按 `import.meta.url` 找到的是 `.vite/deps/` 目录，取不到 wasm。
 */

export interface GlyphFace {
  /** 每 em 的字体单位（通常是 1000 或 2048）。 */
  readonly upem: number;
  /** 基线以上（正数，字体单位）。 */
  readonly ascent: number;
  /** 基线以下（负数，字体单位）。 */
  readonly descent: number;
  /**
   * 删除线中心相对基线的位置（正数 = 基线上方，字体单位）。
   *
   * 下划线**不从这里取**：实测 Chrome 的 HTML 下划线不看
   * `post.underlinePosition`（Inter 是 -0.17em，Chrome 画在 -0.05em），
   * 厚度也恒为 0.1em。见 `text-outline.ts` 的装饰线注释。
   */
  readonly strikeoutOffset: number;
  /** 码点 → 字形 id；字体里没有这个字时返回 null（浏览器会回落，我们拒绝转换）。 */
  glyphFor(codePoint: number): number | null;
  /** 字形 id → 前进宽度（字体单位）。 */
  advanceOf(glyphId: number): number;
  /** 字形 id → SVG 路径数据（字体单位，y 向上）。同一个 gid 会缓存。 */
  pathOf(glyphId: number): string;
}

type HbModule = typeof import('harfbuzzjs');

let hbModule: Promise<HbModule> | null = null;

/** wasm 与 400 KB 字体解析只在第一次用到时发生。 */
function loadHb(): Promise<HbModule> {
  hbModule ??= import('harfbuzzjs');
  return hbModule;
}

/**
 * 以**字节对象身份**为键缓存：`FontRegistry` 重新注册同一族会换掉 ArrayBuffer，
 * 那时旧缓存自然失效（WeakMap 也不会把字体字节钉在内存里）。
 *
 * 第二层按 `wght` 分：变量字体的 400 与 700 是**同一个文件的两个实例**，
 * 缓存而不区分的话，先转 400 再转 700 会拿到同一个细体。
 */
const cache = new WeakMap<ArrayBuffer, Map<number, Promise<GlyphFace>>>();

/**
 * @param wght 变量字体的 `wght` 轴取值；`undefined` = 字体默认实例。
 *   静态字体传了也无害（没有 `fvar` 时 HarfBuzz 直接忽略）。
 */
export function glyphFaceFor(bytes: ArrayBuffer, wght?: number): Promise<GlyphFace> {
  const key = wght ?? 0;
  let byWeight = cache.get(bytes);
  if (!byWeight) {
    byWeight = new Map();
    cache.set(bytes, byWeight);
  }
  const hit = byWeight.get(key);
  if (hit) return hit;
  const created = createFace(bytes, wght);
  byWeight.set(key, created);
  // 失败的 promise 不留在缓存里：下一次重试应该重新实例化。
  void created.catch(() => byWeight.delete(key));
  return created;
}

async function createFace(bytes: ArrayBuffer, wght?: number): Promise<GlyphFace> {
  const hb = await loadHb();
  /*
   * `Blob` / `Face` / `Font` 三个对象必须一直被闭包引用：
   * harfbuzzjs 用 FinalizationRegistry 销毁它们，而 outline 是在事后
   * 才通过 `glyphToPath` 取用的。
   */
  const blob = new hb.Blob(bytes);
  const face = new hb.Face(blob);
  const font = new hb.Font(face);
  if (wght) {
    /*
     * 变量轴：`wght` 落在 1..1000，与 CSS 同口径。包里是静态字体时
     * `hb_font_set_variations` 什么也不做（没有 fvar），不会抛。
     */
    try {
      font.setVariations([new hb.Variation('wght', wght)]);
    } catch {
      /* 没有这个轴：保持默认实例。 */
    }
  }

  const upem = face.upem > 0 ? face.upem : 1000;
  const ext = font.hExtents();
  // 少数只带 CFF 表的字体 hhea 是空的：给一套保守比例，别把字压成一条线。
  const ascent = ext.ascender > 0 ? ext.ascender : Math.round(upem * 0.8);
  const descent = ext.descender < 0 ? ext.descender : -Math.round(upem * 0.2);

  const metric = (tag: number, fallback: number): number => {
    const v = font.getMetricPosition(tag);
    return typeof v === 'number' && Number.isFinite(v) && v !== 0 ? v : fallback;
  };

  const pathCache = new Map<number, string>();

  return {
    upem,
    ascent,
    descent,
    strikeoutOffset: metric(hb.MetricsTag.STRIKEOUT_OFFSET, Math.round(upem * 0.28)),

    glyphFor(codePoint: number): number | null {
      const gid = font.nominalGlyph(codePoint);
      return gid === undefined || gid === 0 ? null : gid;
    },

    advanceOf(glyphId: number): number {
      return font.glyphHAdvance(glyphId);
    },

    pathOf(glyphId: number): string {
      const hit = pathCache.get(glyphId);
      if (hit !== undefined) return hit;
      const d = font.glyphToPath(glyphId);
      pathCache.set(glyphId, d);
      return d;
    },
  };
}

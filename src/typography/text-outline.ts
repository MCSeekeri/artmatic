/**
 * text-outline.ts — 「文本 → 路径」的核心：把 `TextElement` 的每个字形变成
 * 真正的 SVG 轮廓，坐标落在**元素自己的像素盒**里（`pathUnit: 'px'`）。
 *
 * ## 两件事分开做，各自用最可靠的那一方
 *
 * 1. **布局交给浏览器**：逐字符 `Range.getClientRects()` 拿到的就是排版后的
 *    真实位置（换行 / 对齐 / 两端对齐 / 字距 / 行内字号全都白拿）。
 *    自己实现换行必然与预览分家 —— 那是这个功能最容易出现的「看着像但不对」。
 * 2. **轮廓交给 HarfBuzz**：`Font.glyphToPath` 给出字形轮廓，与光栅化用的是
 *    **同一份字体字节**（`FontRegistry` 的 face），所以不会「预览一套、转出来
 *    另一套」。
 *
 * 基线由 `Range` 矩形反推：实测 Chrome 的字符矩形就是字体的
 * `ascent..descent` 一段，所以 `baseline = rect.top + ascent × size / upem`。
 * （同一手法见 html-to-svg 的 text 渲染器；本模块没有复制它的代码。）
 *
 * ## 为什么不做整形（HarfBuzz shape）
 *
 * 位置全部来自浏览器，`shape` 只会用来决定连字 / 上下文替换用哪个字形。
 * 代价是「fi」这类连字会按单字绘制 —— 而 Chrome 的逐字符矩形本来就给了
 * 两个字各自的前进宽度，所以位置是对的，形状差一个连字字形。反过来，
 * 如果自己整形，就得按 cluster 把浏览器位置与 HB 前进宽度对齐，跨脚本
 * （中文 + 拉丁混排）时还要自己做 itemization —— 引入的误差比解决的多。
 *
 * ## 已知取舍
 *
 * - **竖排（`writing-mode: vertical-rl`）拒绝转换**：矩形是旋转的，基线、
 *   前进方向全换了一套，没有实测依据就不猜。
 * - **拿不到 SFNT 字节的字体拒绝转换**（用户导入的 woff2、未授权的本机字体）：
 *   浏览器会用回落字体渲染，硬转会静默换字形。系统字体走 **Local Font Access**
 *   取 `FontData.blob()`（见 `local-fonts.ts`），不需要用户导入文件；拿不到
 *   字节时才报错，错误里带上族名。
 * - **合成粗体 / 合成斜体拒绝转换**：轮廓里没有那层加粗，转出来会变细。
 */

import {
  EL_ID_ATTR,
  RUNS_WRAP_ATTR,
  textShadowList,
  type ElementShadow,
  type Paint,
  type Stroke,
  type TextElement,
  type TextStyle,
  type TypographyDocument,
} from './document';
import { buildDocDom } from './render-dom';
import { mapNodes, parsePathNodes, serializePathNodes, type SubPath } from './path-nodes';
import { resolveThemeColor, themeById, type TypographyTheme } from './theme';
import { plainTextOf } from './rich-text';
import type { FontRegistry } from './font-registry';
import { glyphFaceFor, type GlyphFace } from './font/outline-hb';
import { fontHasWeightAxis } from './font/sfnt';
import { resolveLocalFont } from './local-fonts';

export interface TextOutlineItem {
  /**
   * `box`（文本框底色 / 边框）、`highlight`（高亮）、`glyph`（字形）、
   * `decoration`（下划线 / 删除线）。调用方按这个顺序落层。
   */
  role: 'box' | 'highlight' | 'glyph' | 'decoration';
  /** 填充。文本转路径的 `role: 'glyph'` 可能是渐变 / 纹理（与 `TextElement.fill` 同构）。 */
  paint: Paint;
  /** 元素局部像素坐标（`0..frame.w` × `0..frame.h`）。 */
  d: string;
  /** 只有 `box` 有：文本框边框（映射到 `ShapeElement.stroke`）。 */
  stroke?: Stroke | null;
}

export type TextOutlineFailure =
  | { code: 'empty' }
  | { code: 'vertical' }
  /** 哪里都找不到这个字体（没导入、本机也没有）。 */
  | { code: 'no-font'; families: string[] }
  /** 本机有这个族，但浏览器没授权读本机字体。 */
  | { code: 'local-denied'; families: string[] }
  /** 本机有这个族，但拿不到字体文件字节（缺 `blob()` / 空文件）。 */
  | { code: 'local-missing'; families: string[] }
  /** 读本机字体时抛错（权限策略、系统错误……）。 */
  | { code: 'local-failed'; families: string[]; message: string }
  /** 字体本身可用，但里面没有这些字（浏览器用了回落字体渲染）。 */
  | { code: 'missing-glyphs'; families: string[]; chars: string }
  /** 浏览器用合成粗体 / 斜体渲染，轮廓里没有那一层。 */
  | { code: 'synthetic'; faces: string[] };

export interface TextOutlineOptions {
  fonts: FontRegistry;
  /** `doc.theme`（配色方案 id）。 */
  theme?: string;
  customThemes?: readonly TypographyTheme[];
}

export type TextOutlineResult =
  | { ok: true; items: TextOutlineItem[]; shadows: ElementShadow[] }
  | ({ ok: false } & TextOutlineFailure);

/** 文本框有可见底色或边框时要额外产出的那层矩形。 */
function needsBox(el: TextElement): boolean {
  return (
    (el.boxFill !== undefined && el.boxFill.kind !== 'none') ||
    (el.boxStroke != null && el.boxStroke.width > 0)
  );
}

/** 字体族名可能是 `"Inter", sans-serif` 这种列表：只取第一个。 */
export function firstFamily(name: string): string {
  return name.split(',')[0]!.trim().replace(/^["']|["']$/g, '');
}

/**
 * CSS `text-transform` 的**纯函数**版本（单测直接调）。
 *
 * `capitalize` 的口径与 CSS 一致：每个「词」的首字母大写，词的边界是空白。
 * 逐码点拼而不是 `replace(/\b\w/g, …)`：后者对中文与标点的边界与 CSS 不同。
 */
export function applyTextTransform(text: string, mode: TextStyle['textTransform']): string {
  switch (mode) {
    case 'uppercase':
      return text.toUpperCase();
    case 'lowercase':
      return text.toLowerCase();
    case 'capitalize': {
      let out = '';
      let wordStart = true;
      for (const ch of text) {
        out += wordStart ? ch.toUpperCase() : ch;
        wordStart = /\s/.test(ch);
      }
      return out;
    }
    default:
      return text;
  }
}

/** 一个矩形 → 闭合子路径（局部像素）。 */
function rectSub(x: number, y: number, w: number, h: number): SubPath {
  return {
    closed: true,
    nodes: [
      { x, y, in: null, out: null },
      { x: x + w, y, in: null, out: null },
      { x: x + w, y: y + h, in: null, out: null },
      { x, y: y + h, in: null, out: null },
    ],
  };
}

interface RunPlan {
  run: TextElement['runs'][number];
  /** 原始色（可能是 `@accent1` 这类配色方案引用）。 */
  color: string;
  /** 解析后的色，用于分组。 */
  colorKey: string;
  highlight?: string;
  highlightKey?: string;
  decoration: TextStyle['textDecoration'];
  /** 字体族名（报错用）。 */
  family: string;
}

interface GlyphBucket {
  paint: Paint;
  subs: SubPath[];
}

export async function outlineTextElement(
  el: TextElement,
  opts: TextOutlineOptions,
): Promise<TextOutlineResult> {
  if (typeof document === 'undefined') return { ok: false, code: 'empty' };
  if (el.style.writingMode === 'vertical-rl') return { ok: false, code: 'vertical' };
  if (!plainTextOf(el.runs).trim()) return { ok: false, code: 'empty' };

  /* 1. 解析每个 run 的字体面与颜色 —— 在动 DOM 之前把所有「不可能」挡掉。 */

  const theme = themeById(opts.theme, opts.customThemes);
  const noFont = new Set<string>();
  const localDenied = new Set<string>();
  const localMissing = new Set<string>();
  let localFailure: { families: string[]; message: string } | null = null;
  const synthetic = new Set<string>();

  /** `family/weight/style` → face。同一段文字里重复的样式只查一次。 */
  const faceCache = new Map<string, GlyphFace | null>();
  const plans: Omit<RunPlan, 'face'>[] = [];
  const faces: (GlyphFace | null)[] = [];

  for (const run of el.runs) {
    const family = firstFamily(run.style?.fontFamily ?? el.style.fontFamily);
    const weight = run.style?.fontWeight ?? el.style.fontWeight;
    const style = run.style?.fontStyle ?? el.style.fontStyle;
    const key = `${family}/${weight}/${style}`;
    let face = faceCache.get(key);
    if (face === undefined) {
      face = null;
      /*
       * 两条来源，顺序不能反：
       *  1. `FontRegistry` —— 用户导入的 / 内置的字体，有确定的字节；
       *  2. **本机字体** —— 系统字体不在注册表里，但 Local Font Access 能给出
       *     字体文件（`FontData.blob()`），于是「不用导入文件也能转」。
       * 系统字体拿不到字节（旧浏览器 / 用户拒绝授权）才真的失败。
       */
      const picked = opts.fonts.pickFace(family, weight, style);
      let bytes: ArrayBuffer | null = null;
      let syntheticBold = false;
      let syntheticItalic = false;
      if (picked) {
        syntheticBold = picked.syntheticBold;
        syntheticItalic = picked.syntheticItalic;
        bytes = await opts.fonts.sfntBytes(picked.face);
      }
      if (!bytes) {
        const local = await resolveLocalFont(family, weight, style);
        switch (local.kind) {
          case 'ok':
            bytes = local.bytes;
            // 记录自己的字面才是「有没有真粗体 / 真斜体」的依据。
            syntheticBold = weight >= 600 && local.weight < 600;
            syntheticItalic = style === 'italic' && !local.italic;
            break;
          case 'denied':
            localDenied.add(family);
            break;
          case 'unsupported':
          case 'not-found':
            noFont.add(family);
            break;
          case 'no-bytes':
            localMissing.add(family);
            break;
          default:
            localFailure = { families: [family], message: local.message };
        }
      }
      if (bytes) {
        /*
         * 变量字体（有 `wght` 轴）不是合成粗体：按轴实例化就是真粗体。
         * 合成斜体没有对应的轴（`slnt` 不在 CSS 的 `font-style: italic` 语义里），
         * 一律拒绝。
         */
        const variable = fontHasWeightAxis(bytes);
        if (syntheticItalic || (syntheticBold && !variable)) {
          synthetic.add(`${family} ${weight}${style === 'italic' ? ' italic' : ''}`);
        } else {
          face = await glyphFaceFor(bytes, variable ? weight : undefined);
        }
      }
      faceCache.set(key, face);
    }
    const color = run.style?.color ?? el.style.color;
    const highlight = run.style?.highlight ?? el.style.highlight;
    plans.push({
      run,
      color,
      colorKey: resolveThemeColor(color, theme),
      highlight,
      highlightKey: highlight ? resolveThemeColor(highlight, theme) : undefined,
      decoration: run.style?.textDecoration ?? el.style.textDecoration,
      family,
    });
    faces.push(face);
  }

  /*
   * 报错要挑**最能指导下一步**的那条：授权被拒可以重试授权，字体不存在只能
   * 导入文件，本机找不到字节则要导入那个字重。同一次转换里几种都有时，按这个
   * 优先级出一条（文案里带族名，用户能对上自己那段文字用的哪个字体）。
   */
  if (localDenied.size) return { ok: false, code: 'local-denied', families: [...localDenied] };
  if (localFailure) return { ok: false, code: 'local-failed', ...localFailure };
  if (noFont.size) return { ok: false, code: 'no-font', families: [...noFont] };
  if (localMissing.size) return { ok: false, code: 'local-missing', families: [...localMissing] };
  if (synthetic.size) return { ok: false, code: 'synthetic', faces: [...synthetic] };

  /* 2. 建一个**离屏、但真实参与排版**的 DOM。 */

  const probeEl: TextElement = {
    ...el,
    // 隐藏元素不参与 `buildDocDom` 的渲染 —— 但选中的隐藏文本仍应能转路径。
    visible: true,
    animations: [],
    transform3d: undefined,
    shadows: [],
    blur: undefined,
    frame: { ...el.frame, rot: 0 },
  };
  const probeDoc: TypographyDocument = {
    size: {
      // 元素可能超出文档框，测量用的根节点要装得下它（`overflow` 后面会放开）。
      w: Math.max(1, Math.round(el.frame.x + el.frame.w)),
      h: Math.max(1, Math.round(el.frame.y + el.frame.h)),
    },
    background: { kind: 'none' },
    elements: [probeEl],
    fonts: [],
    groups: [],
    theme: opts.theme,
  };
  const root = buildDocDom(probeDoc, { forRaster: true, customThemes: opts.customThemes });
  root.style.position = 'fixed';
  root.style.left = '-200000px';
  root.style.top = '0';
  root.style.overflow = 'visible';
  root.setAttribute('aria-hidden', 'true');
  document.body.appendChild(root);

  try {
    const shell = root.querySelector(`[${EL_ID_ATTR}="${cssEscape(el.id)}"]`) as HTMLElement | null;
    const box = shell?.querySelector('.typo-text') as HTMLElement | null;
    const wrap = box?.querySelector(`[${RUNS_WRAP_ATTR}]`) as HTMLElement | null;
    const spans = wrap ? (Array.from(wrap.children) as HTMLElement[]) : [];
    if (!shell || !box || spans.length !== el.runs.length) return { ok: false, code: 'empty' };

    /*
     * 原点是**元素框的左上角**（不是文档根）：产出的路径要落在元素局部像素里。
     * 外壳的 `rot` / `transform3d` / 阴影都已清掉，所以它的矩形就是那个框。
     */
    const frameRect = shell.getBoundingClientRect();
    const ox = frameRect.left;
    const oy = frameRect.top;

    const range = document.createRange();
    const buckets = new Map<string, GlyphBucket>();
    /*
     * 字形路径的解析结果按 **face + gid** 缓存：gid 只在各自的字体里有意义，
     * 一段富文本里换字体之后复用同一个 gid，拿到的会**另一个字的轮廓**。
     * 同一个字在一段标题里会重复出现几十次，这层缓存是必要的。
     */
    const glyphCaches = new WeakMap<GlyphFace, Map<number, SubPath[]>>();
    /** 字体缺字：族 → 缺的字符（浏览器用回落字体画了它们）。 */
    const missingGlyphs = new Map<string, Set<string>>();

    /** 只用纯色时所有字形共用一份 paint；有行内色时每个颜色一个桶。 */
    const hasInlineColor = el.runs.some((r) => r.style?.color !== undefined);
    const sharedPaint: Paint | null =
      !hasInlineColor && el.fill && (el.fill.kind === 'linear' || el.fill.kind === 'radial' || el.fill.kind === 'texture')
        ? el.fill
        : null;

    const highlightSubs = new Map<string, { color: string; subs: SubPath[] }>();
    const decorationSubs = new Map<string, { color: string; subs: SubPath[] }>();

    for (let ri = 0; ri < plans.length; ri++) {
      const plan = plans[ri]!;
      const face = faces[ri]!;
      if (!face) continue;
      const span = spans[ri]!;
      const node = span.firstChild;
      const text = plan.run.text;
      if (!node || node.nodeType !== Node.TEXT_NODE || !text) continue;

      const cs = getComputedStyle(span);
      const fontSize = parseFloat(cs.fontSize) || el.style.fontSize;
      const k = fontSize / (face.upem || 1000);
      const ascent = face.ascent * k;

      const paint: Paint = sharedPaint ?? { kind: 'solid', color: plan.color };
      const bucketKey = sharedPaint ? 'shared' : plan.colorKey;
      let bucket = buckets.get(bucketKey);
      if (!bucket) {
        bucket = { paint, subs: [] };
        buckets.set(bucketKey, bucket);
      }

      const display = applyTextTransform(text, el.style.textTransform);
      const displayOk = display.length === text.length;
      const textNode = node as Text;

      for (let i = 0; i < text.length; ) {
        const cp = text.codePointAt(i) ?? 0;
        const width = cp > 0xffff ? 2 : 1;
        const ch = text.slice(i, i + width);

        // 空白不产生字形，也不参与位置推算（下一个非空白字符会自己量）。
        if (/\s/.test(ch)) {
          i += width;
          continue;
        }

        range.setStart(textNode, i);
        range.setEnd(textNode, i + width);
        const rects = Array.from(range.getClientRects());
        const rect = rects[0];
        i += width;
        if (!rect) continue;

        const penX = rect.left - ox;
        const baseline = rect.top - oy + ascent;

        /*
         * `text-transform` 可能把一个字符变成多个（ß → SS）。逐个码点画，
         * 除第一个之外的位置靠字形前进宽度累加 —— 这种字符很少，
         * 但整段文字的上限/下限变化会让整块的偏移全错，所以不能直接跳过。
         */
        const shown = displayOk ? display.slice(i - width, i) : ch;
        let pen = penX;
        for (const shownCh of shown) {
          const shownCp = shownCh.codePointAt(0) ?? 0;
          const gid = face.glyphFor(shownCp);
          if (gid === null) {
            const set = missingGlyphs.get(plan.family) ?? new Set<string>();
            set.add(shownCh);
            missingGlyphs.set(plan.family, set);
            continue;
          }
          let cache = glyphCaches.get(face);
          if (!cache) {
            cache = new Map();
            glyphCaches.set(face, cache);
          }
          const glyphSubs = cache.get(gid) ?? parsePathNodes(face.pathOf(gid));
          if (!cache.has(gid)) cache.set(gid, glyphSubs);
          if (glyphSubs.length) {
            bucket.subs.push(...mapNodes(glyphSubs, (p) => ({ x: pen + p.x * k, y: baseline - p.y * k })));
          }
          pen += face.advanceOf(gid) * k;
        }
      }

      /* 高亮：整段的矩形（每行一个），形状就是那些矩形。 */
      if (plan.highlight && plan.highlightKey && plan.highlightKey !== 'transparent') {
        range.selectNodeContents(span);
        const rects = Array.from(range.getClientRects()).filter((r) => r.width > 0.01 && r.height > 0.01);
        if (rects.length) {
          let entry = highlightSubs.get(plan.highlightKey);
          if (!entry) {
            entry = { color: plan.highlight, subs: [] };
            highlightSubs.set(plan.highlightKey, entry);
          }
          for (const r of rects) entry.subs.push(rectSub(r.left - ox, r.top - oy, r.width, r.height));
        }
      }

      /* 装饰线：下划线 / 删除线。位置与厚度取字体自己的度量。 */
      if (plan.decoration !== 'none') {
        range.selectNodeContents(span);
        const rects = Array.from(range.getClientRects()).filter((r) => r.width > 0.01);
        if (rects.length) {
          let entry = decorationSubs.get(plan.colorKey);
          if (!entry) {
            entry = { color: plan.color, subs: [] };
            decorationSubs.set(plan.colorKey, entry);
          }
          /*
           * 尺寸是**实测**的，不是读字体表：
           *  - Chrome 的 `text-decoration-thickness: auto` 恒为 **0.1em**
           *    （Inter / Arial 在 40 / 80 / 160 px 下都一致），不看
           *    `post.underlineThickness`；
           *  - 下划线位置恒为基线下方 **0.05em** —— Inter 的
           *    `post.underlinePosition` 是 -0.17em，照抄会低 10 多像素；
           *  - 删除线位置倒是读字体的 `OS/2 yStrikeoutPosition`（实测中心
           *    0.331em 与 Inter 的 671/2048 对得上）。
           * 见 `.codebuddy/tmp/2026-10-21/underline-rule.mjs` 的取数。
           */
          const thickness = Math.max(0.5, fontSize * 0.1);
          for (const r of rects) {
            const lineBaseline = r.top - oy + ascent;
            const x = r.left - ox;
            const w = r.width;
            const y =
              plan.decoration === 'underline'
                ? lineBaseline + fontSize * 0.05
                : lineBaseline - face.strikeoutOffset * k - thickness / 2;
            entry.subs.push(rectSub(x, y, w, thickness));
          }
        }
      }
    }

    if (missingGlyphs.size) {
      /*
       * 浏览器画的是**回落字体**，我们拿不到它的轮廓 —— 宁可拒绝，不要静默
       * 换字形。典型场景：默认字体 Inter 不含中文，`双击编辑文本` 会走到这里。
       */
      const chars = [...missingGlyphs.values()].flatMap((set) => [...set]);
      const unique = [...new Set(chars)];
      const shown = unique.slice(0, 12).join('');
      return {
        ok: false,
        code: 'missing-glyphs',
        families: [...missingGlyphs.keys()],
        chars: unique.length > 12 ? `${shown}…` : shown,
      };
    }

    /* 3. 按图层组装：文本框底色 → 高亮 → 字形 → 装饰线。 */

    const items: TextOutlineItem[] = [];

    if (needsBox(el)) {
      items.push({
        role: 'box',
        paint: el.boxFill ?? { kind: 'none' },
        stroke: el.boxStroke ?? null,
        d: serializePathNodes([rectSub(0, 0, el.frame.w, el.frame.h)]),
      });
    }

    for (const entry of highlightSubs.values()) {
      items.push({ role: 'highlight', paint: { kind: 'solid', color: entry.color }, d: serializePathNodes(entry.subs) });
    }

    for (const bucket of buckets.values()) {
      if (!bucket.subs.length) continue;
      items.push({ role: 'glyph', paint: bucket.paint, d: serializePathNodes(bucket.subs) });
    }

    for (const entry of decorationSubs.values()) {
      items.push({
        role: 'decoration',
        paint: { kind: 'solid', color: entry.color },
        d: serializePathNodes(entry.subs),
      });
    }

    if (!items.some((it) => it.role === 'glyph')) return { ok: false, code: 'empty' };

    /*
     * 文字阴影 → 元素阴影。**顺序是刻意的**：filter 链里后面的会连前面的
     * 影子一起再投一次，所以「贴着字形的 text-shadow」放前面、「投整个元素
     * 的 drop-shadow」放后面，才与原来的叠放一致。
     */
    const shadows: ElementShadow[] = [
      ...textShadowList(el.style).map((s) => ({
        color: s.color,
        dx: s.dx * el.style.fontSize,
        dy: s.dy * el.style.fontSize,
        blur: s.blur * el.style.fontSize,
      })),
      ...(el.shadows ?? []),
    ];

    return { ok: true, items, shadows };
  } finally {
    root.remove();
  }
}

/** `querySelector` 里的 id 转义：本项目 id 是十六进制串，但别赌它。 */
function cssEscape(value: string): string {
  const g = globalThis as { CSS?: { escape?: (v: string) => string } };
  return g.CSS?.escape ? g.CSS.escape(value) : value.replace(/["\\]/g, '\\$&');
}

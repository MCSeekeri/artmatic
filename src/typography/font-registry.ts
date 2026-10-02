/**
 * font-registry.ts — 运行期字体表。
 *
 * 工程文件里只存**引用**（FontRef），字节由这里持有（AGENTS §1.7 + M5 的
 * 「素材用引用而非拷贝」）。M5 落地磁盘后字节改从工程目录读，对外接口不变。
 *
 * ## 为什么按 **face** 组织而不是按族
 *
 * Inter 的 400 与 700 是**两个文件**。如果一族只存一份字节，粗体就只能在
 * 光栅化时被浏览器合成出来，而舞台用的是真正的 700 字面 —— 于是「预览是
 * 真粗体、导出是合成粗体」，字宽和笔画都不同。这类差异肉眼很难描述，
 * 但逐像素一比就是几万个像素。
 *
 * 所以这里的最小单位是 face：`family + weight + style` 一条。
 * `localFonts()` 把用到的族展开成多条，每条带上 weight/style，snapDOM 才会
 * 按与浏览器同一套规则选面。
 *
 * ## 三个阶段的划分（刻意的）
 *
 *   register*   —— 注册（内存里放一条记录）
 *   ensure()    —— 异步准备：等 document.fonts.ready、load face、
 *                  把字节编码成 data URL（P7 会把「子集化」插在这一步）
 *   localFonts()—— 同步取用，在光栅化的热路径上调用
 *
 * 编码放 ensure() 是因为 base64 一个 9 MB 的字体要几十毫秒 —— 放进每帧的
 * 光栅化路径等于每帧都付一次。
 */

import type { FontRef, TypographyDocument } from './document';
import { collectGlyphs, usedFontFamilies } from './document';
import type { FontAsset, FontProvider } from './font-provider';
import { subsetFont } from './font/subset-hb';
import { fnv1a } from './cache-key';

export interface FontFaceSource {
  /** `${family}/${weight}/${style}`，进程内唯一。 */
  id: string;
  family: string;
  weight: number;
  style: 'normal' | 'italic';
  /** 原始字节。内置字体首次 ensure 时经 fetch 载入后缓存于此。 */
  bytes: ArrayBuffer | null;
  /** 内置字体的 URL；用户字体为 null（字节已在内存里）。 */
  url: string | null;
  mime: string;
  /** ensure() 阶段备好的 data URL（P7 的子集化产物也放这里）。 */
  dataUrl: string | null;
  loaded: boolean;
}

/** 随软件分发的内置字体（OFL，见 public/fonts/OFL.txt）。 */
export const BUILTIN_FONTS: { family: string; file: string; weight: number; style: 'normal' | 'italic' }[] = [
  { family: 'Inter', file: 'inter-latin-400.woff2', weight: 400, style: 'normal' },
  { family: 'Inter', file: 'inter-latin-700.woff2', weight: 700, style: 'normal' },
];

/** btoa 一次吃不下大字体，分块编码。 */
export function bytesToBase64(bytes: Uint8Array, chunk = 0x8000): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += chunk) {
    out += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(out);
}

export function dataUrlFor(bytes: Uint8Array, mime: string): string {
  return `data:${mime};base64,${bytesToBase64(bytes)}`;
}

/** 是否可以被 HarfBuzz 子集化。**只有 SFNT（TTF/OTF）可以**，woff/woff2 不行。 */
export function isSubsettable(mime: string): boolean {
  return mime === 'font/ttf' || mime === 'font/otf';
}

/** 从文件名猜 MIME。猜到什么只影响 data URL 的类型标注，不影响渲染。 */
export function mimeForFilename(name: string): string {
  const ext = name.toLowerCase().slice(name.lastIndexOf('.'));
  if (ext === '.otf') return 'font/otf';
  if (ext === '.woff2') return 'font/woff2';
  if (ext === '.woff') return 'font/woff';
  return 'font/ttf';
}

/** 从文件名猜字体族名（去扩展名与分隔符）。 */
export function familyFromFilename(name: string): string {
  return name.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ').trim() || 'Imported';
}

export class FontRegistry implements FontProvider {
  /** face id → face */
  private readonly faces = new Map<string, FontFaceSource>();
  /** family → face ids（保持注册顺序，localFonts 的输出才稳定）。 */
  private readonly byFamily = new Map<string, string[]>();
  /** 正在进行的 ensure，避免同一族被并发加载两次。 */
  private readonly inflight = new Map<string, Promise<void>>();
  /** 每次注册 +1。UI 用它触发重算（字体下拉的内容会变）。 */
  revision = 0;

  /**
   * 子集缓存：`faceId|glyphHash` → 子集字节。
   *
   * 字形集只在用户打字时变化，所以命中率极高 —— 这正是 ADR-003 规则 ①
   * 「按字形集哈希缓存」的全部意义：把 14 ms 的冷路径摊销到打字那次，
   * 之后每帧都只剩内联成本。
   */
  private readonly subsetCache = new Map<string, Uint8Array>();
  /** 冷路径/热路径计数与耗时，供测试与 ADR 取数。 */
  readonly subsetStats = { computed: 0, cacheHits: 0, lastMs: 0, lastFullBytes: 0, lastSubsetBytes: 0 };

  /**
   * 关掉子集化（退回整体内联）。
   *
   * 存在的唯一理由是**验证**：ADR-003 的「子集 vs 全量逐像素零差异」这条断言
   * 需要一个对照组。光栅化慢 100 倍，但结果必须一模一样 —— 一旦不一样，
   * 就说明子集改动过字形或度量。
   */
  subsetting = true;

  /** 清掉所有已备好的 data URL 与子集缓存（切开关后必须调，否则读到旧值）。 */
  invalidatePrepared(): void {
    this.subsetCache.clear();
    for (const face of this.faces.values()) face.dataUrl = null;
    this.inflight.clear();
  }

  /** 面孔快照（测试与 ADR 取数用）。 */
  faceReports(): { id: string; mime: string; fullBytes: number; dataUrlLen: number }[] {
    return [...this.faces.values()].map((f) => ({
      id: f.id,
      mime: f.mime,
      fullBytes: f.bytes?.byteLength ?? 0,
      dataUrlLen: f.dataUrl?.length ?? 0,
    }));
  }

  /** 内置字体：只登记 URL，第一次 ensure 时才 fetch。 */
  registerBuiltin(family: string, url: string, weight = 400, style: 'normal' | 'italic' = 'normal', mime = 'font/woff2'): void {
    this.put({ family, url, weight, style, mime, bytes: null });
  }

  /** 把随软件分发的内置字体全部登记一遍（幂等）。 */
  registerBundled(): void {
    const base = import.meta.env?.BASE_URL ?? '/';
    for (const f of BUILTIN_FONTS) {
      this.registerBuiltin(f.family, `${base}fonts/${f.file}`, f.weight, f.style);
    }
  }

  /** 用户导入的字体。字节立刻可用，但仍要 await face.load() 才算真正可用。 */
  async registerFile(name: string, bytes: ArrayBuffer, family?: string): Promise<FontFaceSource> {
    const face = this.put({
      family: family ?? familyFromFilename(name),
      bytes,
      url: null,
      weight: 400,
      style: 'normal',
      mime: mimeForFilename(name),
    });
    await this.loadFace(face);
    return face;
  }

  private put(spec: {
    family: string;
    bytes: ArrayBuffer | null;
    url: string | null;
    weight: number;
    style: 'normal' | 'italic';
    mime: string;
  }): FontFaceSource {
    const id = `${spec.family}/${spec.weight}/${spec.style}`;
    const existing = this.faces.get(id);
    if (existing) {
      // 同 id 重复注册：更新字节来源，不产生第二条。
      if (spec.bytes) existing.bytes = spec.bytes;
      if (spec.url) existing.url = spec.url;
      return existing;
    }
    const face: FontFaceSource = {
      id,
      family: spec.family,
      weight: spec.weight,
      style: spec.style,
      bytes: spec.bytes,
      url: spec.url,
      mime: spec.mime,
      dataUrl: null,
      loaded: false,
    };
    this.faces.set(id, face);
    const list = this.byFamily.get(spec.family) ?? [];
    list.push(id);
    this.byFamily.set(spec.family, list);
    this.revision += 1;
    return face;
  }

  has(family: string): boolean {
    return this.byFamily.has(family);
  }

  families(): string[] {
    return [...this.byFamily.keys()];
  }

  facesOf(family: string): FontFaceSource[] {
    return (this.byFamily.get(family) ?? []).map((id) => this.faces.get(id)!);
  }

  /** 文档用到但未注册的族。UI 的「字体未就绪」横幅读这个。 */
  missing(doc: TypographyDocument): string[] {
    return usedFontFamilies(doc).filter((f) => !this.byFamily.has(f));
  }

  ready(doc: TypographyDocument): boolean {
    return this.missing(doc).length === 0;
  }

  /**
   * snapDOM 的显式字体素材。**同步** —— 数据已在 ensure() 阶段备好。
   * 一个族有几条 face 就报几条，weight/style 带上，snapDOM 才选得对。
   */
  localFonts(doc: TypographyDocument): FontAsset[] | undefined {
    const out: FontAsset[] = [];
    for (const family of usedFontFamilies(doc)) {
      for (const face of this.facesOf(family)) {
        if (!face.dataUrl) continue;
        out.push({
          family: face.family,
          src: face.dataUrl,
          weight: face.weight,
          style: face.style,
        });
      }
    }
    return out.length ? out : undefined;
  }

  async ensure(doc: TypographyDocument): Promise<void> {
    const families = usedFontFamilies(doc);
    // 子集化的输入是「整篇文档用到的码点」。按族分别裁，因为
    // 一个族可能有多个 face（Inter 的 400 与 700 是两个文件）。
    const glyphs = collectGlyphs(doc);
    await Promise.all(families.map((f) => this.ensureFamily(f, glyphs)));
    // ADR-003 规则 ③：不等 fonts.ready 的话首帧会用回落字体量度，
    // 导出与预览不一致，而且「看起来都正常」，极难定位。
    if (typeof document !== 'undefined' && document.fonts) {
      await document.fonts.ready;
    }
  }

  private ensureFamily(family: string, glyphs: string): Promise<void> {
    const running = this.inflight.get(family);
    if (running) return running;
    const ids = this.byFamily.get(family);
    if (!ids?.length) return Promise.resolve();

    const job = (async () => {
      for (const id of ids) {
        const face = this.faces.get(id);
        if (!face) continue;
        if (!face.bytes && face.url) {
          try {
            const res = await fetch(face.url);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            face.bytes = await res.arrayBuffer();
          } catch (err) {
            // 拉不到就当作缺字体：渲染会用回落字体，比整个流程崩掉好。
            console.warn(`[typo] 内置字体 ${face.url} 加载失败`, err);
            continue;
          }
        }
        if (!face.loaded) await this.loadFace(face);
        await this.prepareDataUrl(face, glyphs);
      }
      this.inflight.delete(family);
    })();

    this.inflight.set(family, job);
    return job;
  }

  /**
   * ADR-003 规则 ①：字体子集化，按字形集哈希缓存。
   *
   * 为什么必须做：光栅化后端要把字体**内联**进 SVG（不然字形会回落到别的
   * 字体），而内联成本 ≈ 4 µs/KB + 0.7 ms 固定。实测 9.5 MB 的 simhei.ttf
   * 内联一次是 ~129 ms/帧，裁到 9.3 KB 之后是 ~0.7 ms/帧，且逐像素零差异。
   *
   * woff/woff2 **不做子集化**（HarfBuzz 只吃 SFNT，实测 `hb_subset_or_fail`
   * 对 woff2 返回 0），原样内联 —— 好在 woff2 本身就是压缩格式，体积可控。
   */
  private async prepareDataUrl(face: FontFaceSource, glyphs: string): Promise<void> {
    if (!face.bytes) return;

    const canSubset = this.subsetting && isSubsettable(face.mime) && glyphs.length > 0;
    if (!canSubset) {
      if (!face.dataUrl) face.dataUrl = dataUrlFor(new Uint8Array(face.bytes), face.mime);
      return;
    }

    // glyphs 由 collectGlyphs 产出，已经是**排序去重**过的 —— 所以
    // 「打字顺序不同」不会产生不同的键，缓存才稳。
    const key = `${face.id}|${fnv1a(glyphs)}`;
    const hit = this.subsetCache.get(key);
    let bytes: Uint8Array;
    if (hit) {
      this.subsetStats.cacheHits += 1;
      bytes = hit;
    } else {
      const t0 = performance.now();
      try {
        bytes = await subsetFont(face.bytes, glyphs);
      } catch (err) {
        // 子集化失败（字体损坏 / wasm 取不到）不该让整条链路挂掉 ——
        // 退回整体内联，代价是慢，但结果是对的。
        console.warn(`[typo] ${face.id} 子集化失败，退回整体内联`, err);
        if (!face.dataUrl) face.dataUrl = dataUrlFor(new Uint8Array(face.bytes), face.mime);
        return;
      }
      this.subsetStats.computed += 1;
      this.subsetStats.lastMs = performance.now() - t0;
      this.subsetStats.lastFullBytes = face.bytes.byteLength;
      this.subsetStats.lastSubsetBytes = bytes.byteLength;
      this.subsetCache.set(key, bytes);
    }
    face.dataUrl = dataUrlFor(bytes, face.mime);
  }

  private async loadFace(face: FontFaceSource): Promise<void> {
    if (face.loaded) return;
    const src: ArrayBuffer | string | null = face.bytes ?? face.url;
    if (!src) return;
    try {
      const descriptors: FontFaceDescriptors = { weight: String(face.weight), style: face.style };
      const ff = new FontFace(face.family, src as ArrayBuffer, descriptors);
      await ff.load();
      document.fonts.add(ff);
      face.loaded = true;
    } catch (err) {
      console.warn(`[typo] 字体 ${face.id} 的 FontFace 加载失败`, err);
    }
  }

  /** 文档用到的字体引用（写进 TypographyDocument.fonts）。 */
  refFor(family: string): FontRef | null {
    const faces = this.facesOf(family);
    if (!faces.length) return null;
    const mime = faces[0]!.mime;
    return {
      id: `font-${family}`,
      family,
      // HarfBuzz 的 subset 只吃 SFNT；woff/woff2 只能整体内联（见 P7）。
      format: mime.includes('woff2') ? 'woff2' : mime.includes('woff') ? 'woff' : 'sfnt',
      source: faces[0]!.url ? { kind: 'builtin' } : { kind: 'file' },
    };
  }
}

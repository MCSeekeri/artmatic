/**
 * local-fonts.ts — 枚举 / 读取**本机已安装**的字体（纯逻辑 + 一层薄薄的 API 包装）。
 *
 * ## 不需要 Node，也不需要 Electron
 *
 * 浏览器有专门的 API：**Local Font Access**（`window.queryLocalFonts()`），
 * Chrome / Edge 103+ **桌面版**有。
 *
 * ⚠️ **挂点是 `window`（全局函数），不是 `navigator`。** 规范条目名就是
 * `Window.queryLocalFonts()`（caniuse 的 id 是 `mdn-api-window-querylocalfonts`）。
 * 写成 `navigator.queryLocalFonts` 的症状是「探测**永远**失败」—— 界面上的表现是
 * 「按钮一直灰着，像是浏览器不支持」，而实际上只是找错了对象。下面有单测钉住。它返回的是**字体文件**记录 —— 一个族会有多条
 * （每个字重 / 斜体各一条），所以「族名列表」只取 `family` 再去重排序。
 *
 * ## 三条必须处理的约束
 *
 *  ① **必须由用户手势触发**（有头浏览器里会弹权限框让用户点）。所以入口是一个
 *     按钮，不能启动时自动跑。自动化里可以用 `context.grantPermissions(['local-fonts'])`
 *     预置权限 —— 于是成功路径**也能进回归网**，不必只测降级分支。
 *  ② **用户拒绝授权时 resolve 空数组**，而不是抛错 —— 「不支持」和「被拒绝」必须
 *     分开报，界面上的说法完全不同（「你的浏览器不行」vs「你点了拒绝」）。
 *  ③ **只在 Chromium 桌面版有**。Firefox / Safari / 移动端一律没有，入口要能置灰。
 *
 * ## 本机字体**不**走 FontRegistry
 *
 * 文档里存的就是族名（`fontFamily: 'Microsoft YaHei'`），浏览器渲染和光栅化
 * （canvas 的 `ctx.font`）都直接吃系统字体 —— 不需要注册，也**不能**子集化嵌入
 * （那是 `FontRegistry` 的职责，它的字体有 FontFace 与字节）。所以本机字体只加进
 * 「下拉里能选到」的那份列表，两条来源在状态里也必须分开存。
 *
 * ## 但「文字转路径」需要**字体文件**
 *
 * 轮廓只能从 SFNT 里取。Local Font Access 的每条记录都带 `blob()`，拿到的正是
 * 字体文件字节 —— 于是系统字体也能转路径（`resolveLocalFont`）。实测（Chrome
 * 140 / Windows 11）有两个重要事实：
 *
 *  - **`blob()` 给的是单字体 SFNT，不是 TTC 集合**（微软雅黑的记录不会塞来一个
 *    `ttcf`），所以不需要处理 collection index；
 *  - **第一次 `queryLocalFonts()` 要 3 秒**（枚举整机字体），之后 Chrome 自己
 *    缓存到 1ms。模块内也缓存记录，跨会话内的多次转换只付一次。
 *
 * 本机字体字节**只放内存**（LRU，4 个）：CJK 字体动辄 15 MB，而且它们绝不能
 * 进工程文件 —— 工程里只存族名。
 */

import { pickCssWeight } from './font/css-weight';

/** `window.queryLocalFonts()` 返回记录的最小结构（不引 lib.dom 的版本差异）。 */
export interface LocalFontData {
  family: string;
  fullName: string;
  postscriptName: string;
  style: string;
  /**
   * 取字体文件字节。规范里就有；测试注入时也要实现它。
   * 老浏览器 / 非标准实现可能没有 —— 缺了就当「读不到轮廓」。
   */
  blob?: () => Promise<Blob>;
}

export interface LocalFontSource {
  queryLocalFonts(): Promise<LocalFontData[]>;
}

/** 当前环境支不支持。UI 据此把入口按钮置灰。 */
export function localFontSource(): LocalFontSource | null {
  /*
   * 取的是**全局**（浏览器里就是 `window`）上的函数。
   *
   * 不要改成 `navigator.queryLocalFonts` —— 那个属性根本不存在，探测会**永远**
   * 返回 null，界面上就是「按钮一直灰着」，看着像浏览器不支持。踩过。
   *
   * 把 `globalThis` 本身当 source（而不是解出函数再包一层）：这样调用时 `this`
   * 就是 `window`，与 `window.queryLocalFonts()` 的语义完全一致。
   */
  const g = globalThis as typeof globalThis & { queryLocalFonts?: unknown };
  return typeof g.queryLocalFonts === 'function' ? (g as unknown as LocalFontSource) : null;
}

/** 查询结果。「不支持 / 被拒绝 / 出错」都得能表达，所以不用裸数组。 */
export type LocalFontResult =
  | { kind: 'ok'; families: string[] }
  | { kind: 'denied' }
  | { kind: 'unsupported' }
  | { kind: 'failed'; message: string };

/** 带记录的查询结果（文字转路径要拿 `blob()`，不能只有族名）。 */
export type LocalFontRecordsResult =
  | { kind: 'ok'; fonts: LocalFontData[] }
  | { kind: 'denied' }
  | { kind: 'unsupported' }
  | { kind: 'failed'; message: string };

/**
 * 族名归一化：去空白、去重、按**本地化顺序**排。
 *
 * 排序用 `localeCompare` 而不是默认的码点序：按码点排的话「微软雅黑」这类
 * 中文族名会全部落到 ASCII 之后，而中文字体恰恰是这个功能的主要目标。
 */
export function normalizeFamilies(names: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of names) {
    const name = raw.trim();
    if (!name || seen.has(name)) continue;
    seen.add(name);
    out.push(name);
  }
  return out.sort((a, b) => a.localeCompare(b));
}

/* ------------------------------------------------------------------ *
 * 记录（含 blob）的查询与缓存
 * ------------------------------------------------------------------ */

/**
 * 一次会话内只问一次。**成功才缓存**：被拒绝 / 出错之后再点一次应该真的重试
 * （用户可能刚在地址栏的权限面板里放行）。
 */
let cachedRecords: LocalFontData[] | null = null;

/** 测试用：把记录缓存与字节缓存都清掉。 */
export function resetLocalFontCaches(): void {
  cachedRecords = null;
  localBytes.clear();
}

/**
 * 查询本机字体的**记录**（含 `blob()`）。
 *
 * `source` 缺省 = 真实 API。显式传 source 时**不读写缓存**：测试与探针不该
 * 被上一组假数据污染。
 *
 * 空数组按 API 约定归到 `denied`（拒绝授权 ⇒ resolve 空数组）；这比报
 * 「载入成功，0 个字体」诚实。
 */
export async function queryLocalFontRecords(
  source?: LocalFontSource | null,
): Promise<LocalFontRecordsResult> {
  if (source === null) return { kind: 'unsupported' };
  const useCache = source === undefined;
  const src = source ?? localFontSource();
  if (!src) return { kind: 'unsupported' };
  if (useCache && cachedRecords) return { kind: 'ok', fonts: cachedRecords };
  try {
    const fonts = await src.queryLocalFonts();
    if (!fonts.length) return { kind: 'denied' };
    if (useCache) cachedRecords = fonts;
    return { kind: 'ok', fonts };
  } catch (e) {
    /*
     * 用户在手势之外调用、页面不是顶层窗口、Permissions-Policy 挡住了……都走这条。
     * 一律归到 failed 并把原因带出去 —— 猜成「被拒绝」会把真正的问题藏起来。
     */
    return { kind: 'failed', message: e instanceof Error ? e.message : String(e) };
  }
}

/** 只要族名时的薄包装（字体下拉用）。 */
export async function queryLocalFontFamilies(
  source?: LocalFontSource | null,
): Promise<LocalFontResult> {
  const r = await queryLocalFontRecords(source);
  if (r.kind !== 'ok') return r;
  const families = normalizeFamilies(r.fonts.map((f) => f.family));
  return families.length ? { kind: 'ok', families } : { kind: 'denied' };
}

/* ------------------------------------------------------------------ *
 * 挑 face：style 字符串 → weight / italic，族名 → 记录
 * ------------------------------------------------------------------ */

/** `FontData.style` 的取值（"Regular" / "Bold Italic" / "SemiBold" / "Light" …）。 */
const STYLE_WEIGHTS: readonly (readonly [RegExp, number])[] = [
  [/\b(thin|hairline)\b/i, 100],
  [/\b(extra\s*light|ultra\s*light)\b/i, 200],
  [/\blight\b/i, 300],
  [/\bmedium\b/i, 500],
  [/\b(semi\s*bold|demi\s*bold)\b/i, 600],
  [/\b(extra\s*bold|ultra\s*bold)\b/i, 800],
  [/\b(black|heavy)\b/i, 900],
  [/\bbold\b/i, 700],
];

/**
 * 把 `FontData.style` 解析成 weight + italic。
 *
 * 这是**猜测**，不是规范映射：规范只保证 `style` 是人类可读字符串（不同平台
 * 还会本地化）。覆盖常见的英文 style 名即可；认不出的按 400 / normal —— 与
 * 浏览器「找不到就回落 Regular」的行为一致。顺序有讲究：`ExtraBold` 含 `Bold`，
 * `SemiBold` 同理，所以复合词必须排在前面。
 */
export function styleTextToFace(style: string): { weight: number; italic: boolean } {
  const s = style.trim();
  const italic = /\b(italic|oblique)\b/i.test(s);
  for (const [re, weight] of STYLE_WEIGHTS) {
    if (re.test(s)) return { weight, italic };
  }
  return { weight: 400, italic };
}

function normFamily(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/["']/g, '')
    .replace(/\s+/g, ' ');
}

export interface LocalFontChoice {
  record: LocalFontData;
  /** 记录自身的字重（用来判断是否需要合成粗体）。 */
  weight: number;
  italic: boolean;
}

/**
 * 在记录里找「族 + 字重 + 斜体」最接近的一条（CSS Fonts 4 的匹配口径）。
 *
 * 族名匹配按 `family` → `fullName` → `postscriptName` 三级回落：文档里存的是
 * 下拉选中的 `family`，但用户也可能在自定义 CSS 里写全名 / PostScript 名。
 *
 * **找不到斜体面时返回常规面**（`italic: false`），让调用方去判断「这是合成
 * 斜体、不能转」；在这里直接返回 null 会把「族存在但缺斜体」误报成「没有这个
 * 字体」。
 */
export function pickLocalFont(
  fonts: readonly LocalFontData[],
  family: string,
  weight: number,
  style: 'normal' | 'italic',
): LocalFontChoice | null {
  const want = normFamily(family);
  if (!want) return null;

  let matches = fonts.filter((f) => normFamily(f.family) === want);
  if (!matches.length) matches = fonts.filter((f) => normFamily(f.fullName) === want);
  if (!matches.length) matches = fonts.filter((f) => normFamily(f.postscriptName) === want);
  if (!matches.length) return null;

  const parsed = matches.map((record) => ({ record, ...styleTextToFace(record.style) }));
  const sameStyle = parsed.filter((p) => p.italic === (style === 'italic'));
  const pool = sameStyle.length ? sameStyle : parsed;
  const wanted = pickCssWeight(
    weight,
    pool.map((p) => p.weight),
  );
  const chosen = pool.find((p) => p.weight === wanted) ?? pool[0]!;
  return { record: chosen.record, weight: chosen.weight, italic: chosen.italic };
}

/* ------------------------------------------------------------------ *
 * 取字节：文字转路径用
 * ------------------------------------------------------------------ */

export type LocalFontResolution =
  | {
      kind: 'ok';
      bytes: ArrayBuffer;
      record: LocalFontData;
      /** 记录自身的字重 / 斜体（合成判断用）。 */
      weight: number;
      italic: boolean;
    }
  /** 权限被拒（可以靠再点一次 + 授权解决）。 */
  | { kind: 'denied' }
  /** 环境没有这个 API。 */
  | { kind: 'unsupported' }
  /** 记录里根本没有这个族。 */
  | { kind: 'not-found' }
  /** 族找到了，但拿不到字节（缺 `blob()` / 空文件）。 */
  | { kind: 'no-bytes' }
  | { kind: 'failed'; message: string };

/**
 * 本机字体字节的 LRU。**只放内存，绝不进工程**。
 *
 * 上限 4 个：CJK 字体单条就有十几 MB（实测等线 16 MB），而一次转换通常只碰
 * 一两个族。超出就淘汰最久没用的那条 —— `GlyphFace` 的 WeakMap 会在字节
 * 没人引用后自然释放。
 */
const LOCAL_BYTES_MAX = 4;
const localBytes = new Map<string, ArrayBuffer>();

/**
 * 找到某个族 / 字重 / 斜体对应的**字体文件字节**。
 *
 * 失败要分得比「成功/失败」细：`not-found` 是「没有这个字体」，`no-bytes` 是
 * 「有但读不出轮廓」，`denied` 是「还没授权」—— 三者的下一步动作完全不同。
 */
export async function resolveLocalFont(
  family: string,
  weight: number,
  style: 'normal' | 'italic',
  source?: LocalFontSource | null,
): Promise<LocalFontResolution> {
  const found = await queryLocalFontRecords(source);
  if (found.kind !== 'ok') return found;

  const choice = pickLocalFont(found.fonts, family, weight, style);
  if (!choice) return { kind: 'not-found' };

  const { record } = choice;
  const key = `${normFamily(family)}|${record.postscriptName}|${choice.weight}|${choice.italic ? 'i' : 'n'}`;
  const hit = localBytes.get(key);
  if (hit) {
    // Map 的插入序就是 LRU 序：命中后挪到队尾。
    localBytes.delete(key);
    localBytes.set(key, hit);
    return { kind: 'ok', bytes: hit, record, weight: choice.weight, italic: choice.italic };
  }

  if (typeof record.blob !== 'function') return { kind: 'no-bytes' };
  try {
    const bytes = await (await record.blob()).arrayBuffer();
    if (!bytes.byteLength) return { kind: 'no-bytes' };
    localBytes.set(key, bytes);
    while (localBytes.size > LOCAL_BYTES_MAX) {
      const oldest = localBytes.keys().next().value;
      if (oldest === undefined) break;
      localBytes.delete(oldest);
    }
    return { kind: 'ok', bytes, record, weight: choice.weight, italic: choice.italic };
  } catch (e) {
    return { kind: 'failed', message: e instanceof Error ? e.message : String(e) };
  }
}

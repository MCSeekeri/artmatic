/**
 * local-fonts.ts — 枚举**本机已安装**的字体族（纯逻辑 + 一层薄薄的 API 包装）。
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
 * （每个字重 / 斜体各一条），所以这里只取 `family` 再去重排序。
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
 */

/** `window.queryLocalFonts()` 返回记录的最小结构（不引 lib.dom 的版本差异）。 */
export interface LocalFontData {
  family: string;
  fullName: string;
  postscriptName: string;
  style: string;
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

/**
 * 查询本机字体族。
 *
 * 空数组**有歧义**（可能是拒绝授权，也可能是机器上真一个字体都没有）。API 的
 * 约定是「拒绝 ⇒ resolve 空数组」，所以这里把空数组归到 `denied` —— 比报
 * 「载入成功，0 个字体」诚实。
 */
export async function queryLocalFontFamilies(
  source: LocalFontSource | null = localFontSource(),
): Promise<LocalFontResult> {
  if (!source) return { kind: 'unsupported' };
  try {
    const fonts = await source.queryLocalFonts();
    const families = normalizeFamilies(fonts.map((f) => f.family));
    return families.length ? { kind: 'ok', families } : { kind: 'denied' };
  } catch (e) {
    /*
     * 用户在手势之外调用、页面不是顶层窗口、Permissions-Policy 挡住了……都走这条。
     * 一律归到 failed 并把原因带出去 —— 猜成「被拒绝」会把真正的问题藏起来。
     */
    return { kind: 'failed', message: e instanceof Error ? e.message : String(e) };
  }
}

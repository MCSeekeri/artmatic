/**
 * font-provider.ts — 字体就绪与「给光栅化后端的字体素材」（纯接口 + 无 DOM 的类型）。
 *
 * 三个职责，按调用时机分开：
 *  1. `ensure(doc)`  —— **异步**：等 document.fonts.ready、逐个 face load、
 *     把字体字节准备成 data URL。ADR-003 规则 ③ 的落地处。
 *  2. `localFonts(doc)` —— **同步**：给 snapDOM 的 `localFonts`。
 *     它必须是同步的（在 rasterize 里调用），所以字节的读取与编码都在
 *     ensure() 阶段做完。
 *  3. `missing(doc)` —— 同步：UI 用它显示「字体未就绪」横幅。
 *
 * 为什么走 snapDOM 的 `localFonts` 而不是自己拼 CSS：
 * snapDOM 3.x 的 `embedFonts` 是布尔/`'auto'`，字体素材由 `localFonts`
 * 显式提供（官方注释：「Provide fonts explicitly to avoid remote discovery」）。
 * 自己拼 @font-face 反而要多一条「它认不认我的规则」的隐式契约。
 */

import type { TypographyDocument } from './document';

/** 与 snapDOM 的 LocalFont 结构一致（不去 import 它的类型，保持本层无第三方耦合）。 */
export interface FontAsset {
  family: string;
  /** URL 或 data: URL。 */
  src: string;
  weight?: string | number;
  style?: string;
}

export interface FontProvider {
  /** 文档用到的字体里，当前不可用的族名。 */
  missing(doc: TypographyDocument): string[];
  /** 给 snapDOM 的显式字体素材。必须同步；数据由 ensure() 预先备好。 */
  localFonts(doc: TypographyDocument): FontAsset[] | undefined;
  /** 等字体就绪 + 备好字体素材。导出前必须 await（ADR-003 规则 ③）。 */
  ensure(doc: TypographyDocument): Promise<void>;
  /** 文档用到的所有字体都可用时返回 true。 */
  ready(doc: TypographyDocument): boolean;
}

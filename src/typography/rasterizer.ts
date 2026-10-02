/**
 * rasterizer.ts — 光栅化后端的契约与注册表（ADR-003 的落地）。
 *
 * 后端是**无状态**的：它只管「文档 + 尺寸 + 时刻 → 一张位图」，不持有缓存。
 * 缓存（LRU、内存预算、并发去重）统一放在 runtime.ts，理由只有一个：
 * 内存上限必须由单一处说了算，否则「谁该淘汰」会变成两个模块的猜谜游戏。
 *
 * 后端优先级（ADR-003）：hic → dom-snap → canvas2d → png-import。
 * M4 只实现 dom-snap；其余留 stub（isAvailable() 返回 false）。
 * hic 的位置尤其要留：snapDOM 3.x 自己就有 `engine: 'html-in-canvas'`，
 * 等它的上传路径在这个 Electron 版本上通了，dom-snap 后端内部换一行即可。
 */

import type { TypographyDocument } from './document';
import { DomSnapRasterizer } from './backends/dom-snap';
import type { FontProvider } from './font-provider';

export type RasterBackendId = 'hic' | 'dom-snap' | 'canvas2d' | 'png-import';

export interface RasterRequest {
  doc: TypographyDocument;
  /** 输出位图的像素尺寸。 */
  width: number;
  height: number;
  /** 片段内本地时间（秒）。静态文档传 0。 */
  localSec: number;
  /** 图片素材 → URL。 */
  resolveImage?: (assetId: string) => string | null;
}

export interface TextRasterizer {
  readonly id: RasterBackendId;
  isAvailable(): boolean;
  /** **必须确定**：同参数同结果。预览与导出都走它。 */
  rasterize(req: RasterRequest): Promise<HTMLCanvasElement>;
  dispose(): void;
}

export interface TextBackendRegistry {
  /** 按优先级取第一个可用的后端。 */
  pick(): TextRasterizer;
  byId(id: RasterBackendId): TextRasterizer | null;
  dispose(): void;
}

/**
 * 离屏挂载容器。
 *
 * **不能用 visibility:hidden / display:none / opacity:0** —— 它们会被
 * getComputedStyle 继承下去，光栅化出来的是一张空图（而且不报任何错）。
 * 挪到视口外就够：布局与计算样式全部照常，只是不会被用户看到。
 */
export function createOffscreenHost(): HTMLElement {
  const host = document.createElement('div');
  host.setAttribute('data-typo-host', '1');
  host.style.cssText = [
    'position:fixed',
    'left:-200000px',
    'top:0',
    'width:0',
    'height:0',
    'overflow:visible',
    'pointer-events:none',
    'z-index:-1',
  ].join(';');
  document.body.appendChild(host);
  return host;
}

export function createTextBackendRegistry(
  host: HTMLElement,
  fonts: FontProvider,
): TextBackendRegistry {
  const domSnap = new DomSnapRasterizer(host, fonts);
  const backends: TextRasterizer[] = [domSnap];

  return {
    pick(): TextRasterizer {
      const found = backends.find((b) => b.isAvailable());
      if (!found) throw new Error('没有可用的排版光栅化后端');
      return found;
    },
    byId(id: RasterBackendId): TextRasterizer | null {
      return backends.find((b) => b.id === id) ?? null;
    },
    dispose(): void {
      for (const b of backends) b.dispose();
      host.remove();
    },
  };
}

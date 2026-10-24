/**
 * pattern-import.ts — 媒体池素材 → `pattern` 位图（UI 侧的数据源）。
 *
 * ## 为什么是一个「源对象」而不是让编辑器直接读 appState
 *
 * `PatternEditorModal` 被**两个入口**共用：主应用的检查器与 `/lab/` 的右栏。
 * 后者刻意不装配 `appState`（试炼场只共享 render-core 与控件），编辑器里直接
 * import `appState` 会把整棵应用状态拖进 lab 的 bundle —— 那是架构上的越界，
 * 而且 bundle 守卫会发现多出来的分片。
 *
 * 所以编辑器只认这个接口；主应用在这里把 `appState` 包一层传进去，lab 不传
 * （于是没有「从素材导入」按钮，而不是有一个点了报错的按钮）。
 *
 * 真正的采样在 `algos/pattern-image.ts`（纯函数 + `<img>` 解码）；
 * Agent 走控制平面自己的 `seedPatternFromAsset`，读的是同一份采样函数。
 */

import type { Bitmap } from '../../algos/pattern-codec';
import { bitmapFromImageBlob } from '../../algos/pattern-image';
import { mimeForImageFilename, resolveImageAsset } from '../../typography/image-assets';
import { appState } from '../app-state.svelte';
import { buildPoolItems } from '../media-pool';

/** 选择器里的一行。 */
export interface PatternAssetItem {
  id: string;
  name: string;
  /** 缩略图 objectURL（导入 / 打开工程时已建好）；没有就退化成图标。 */
  thumb: string | null;
  w: number | null;
  h: number | null;
  missing: boolean;
}

export interface PatternAssetSource {
  /** 当前可选的图片。读 `appState.version` —— 新导入的素材要立刻出现。 */
  list(): PatternAssetItem[];
  /** 按 `w × h`（模拟网格）采样。返回 null = 读不出来。 */
  load(assetId: string, w: number, h: number): Promise<Bitmap | null>;
}

/** 取素材字节并按 `w × h` 采样成位图。 */
export async function bitmapFromAsset(assetId: string, w: number, h: number): Promise<Bitmap | null> {
  const bytes = await appState.assets.readAll(assetId);
  if (!bytes || bytes.byteLength === 0) return null;
  const name = appState.assets.input(assetId)?.originName ?? '';
  // `Uint8Array<ArrayBufferLike>` 在 TS 5.9 里不满足 BlobPart；切一份自己的
  // ArrayBuffer，顺带避免把素材仓的底层 buffer 借给 Blob（它会跟着活很久）。
  const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  return bitmapFromImageBlob(new Blob([buf], { type: mimeForImageFilename(name) }), w, h);
}

/** 主应用的数据源（检查器用）。 */
export function appPatternSource(): PatternAssetSource {
  return {
    list: () => {
      void appState.version;
      return buildPoolItems(appState.store.project.assets, appState.assets)
        .filter((i) => i.kind === 'image')
        .map((i) => ({
          id: i.id,
          name: i.name,
          thumb: resolveImageAsset(i.id),
          w: i.size?.w ?? null,
          h: i.size?.h ?? null,
          missing: i.missing,
        }));
    },
    load: (assetId, w, h) => bitmapFromAsset(assetId, w, h),
  };
}

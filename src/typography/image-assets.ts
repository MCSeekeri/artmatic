/**
 * image-assets.ts — 排版文档里图片素材的 URL 表（运行期内存）。
 *
 * 文档元素只存 `assetId`（与 schema 的「素材用引用而非拷贝」一致），
 * 真正的对象 URL 在这里。放在 typography 模块而不是 UI 层，是因为
 * **光栅化运行时也要用它**（snapDOM 得能把 <img> 取下来内联进快照）。
 *
 * M4 还没有工程目录（那是 M5），所以素材活在内存里：关掉页面就没了。
 * 这是已知且可接受的降级 —— 与音频素材现在的处理一致。
 */

const urls = new Map<string, string>();

export function putImageAsset(assetId: string, url: string): void {
  const old = urls.get(assetId);
  if (old && old !== url) URL.revokeObjectURL(old);
  urls.set(assetId, url);
}

/** 由字节建一个可被 snapDOM 取用的 URL。 */
export function putImageBytes(assetId: string, data: ArrayBuffer, mime = 'image/png'): string {
  const url = URL.createObjectURL(new Blob([data], { type: mime }));
  putImageAsset(assetId, url);
  return url;
}

export function resolveImageAsset(assetId: string): string | null {
  return urls.get(assetId) ?? null;
}

export function hasImageAsset(assetId: string): boolean {
  return urls.has(assetId);
}

/**
 * 丢掉一条素材的 URL（媒体池移除素材时调）。
 *
 * **必须 revoke**：objectURL 不释放就一直钉着那份字节（一张 4K 图片是十几 MB），
 * 而「删掉的素材还在内存里躺着」这种事没人会去查。
 * 幂等：没有这条素材时什么都不做。
 */
export function forgetImageAsset(assetId: string): void {
  const url = urls.get(assetId);
  if (!url) return;
  URL.revokeObjectURL(url);
  urls.delete(assetId);
}

/** 由文件名猜图片 MIME。猜错只影响 Blob 的类型标注，不影响渲染。 */
export function mimeForImageFilename(name: string): string {
  const ext = name.toLowerCase().slice(name.lastIndexOf('.'));
  switch (ext) {
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    case '.webp':
      return 'image/webp';
    case '.gif':
      return 'image/gif';
    case '.svg':
      return 'image/svg+xml';
    default:
      return 'image/png';
  }
}

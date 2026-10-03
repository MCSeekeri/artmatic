/**
 * media-assets.ts — 运行期的「素材 → 可上传的图源」登记处。
 *
 * ## 为什么需要单独一层
 *
 * 持久化层存的是**字节**（`project/asset-store.ts`），渲染层要的是
 * **TexImageSource**。中间那次转换过去没有落点：`SourceManager.setImage`
 * 在 M4 就写好了，但**全仓库零调用方** —— 后果是排版「转为图片」产出的
 * `{type:'image'}` 片段、以及导入图片后建的同类型片段，**画面上都是空白**。
 *
 * 这里放的是「已经解码好、等着被上传」的东西，**不碰 GL**：
 *
 * ```
 * 字节 ──registerImageBytes──→ ImageBitmap ──→ SourceManager 首次用到时上传成纹理
 * 字节 ──registerVideoBlob ──→ Blob（不解码）──→ video-source 按需取帧
 * ```
 *
 * 关键设计：**视频只存 Blob/File 引用，绝不在内存里摊开字节**。
 * 浏览器给的文件句柄是磁盘背书的，mediabunny 从它 seek 读；10 MB 的素材
 * 占 10 MB 磁盘缓存而不是 10 MB 堆内存，几 GB 的素材也不会把页面撑爆。
 * 这一点是硬要求 —— 工程打开时 `AssetStore.loadFrom` 会把所有素材
 * 读回内存（见 AGENTS §8 第 12 条），视频若跟着走那条路会直接 OOM。
 *
 * ## 生命周期
 *
 * `assetId` 是 uuid，一次导入一个，不会复用。所以「同一 id 换内容」在
 * 实践中不会发生；但 `registerImageBytes` 仍然按**对象身份**判断是否需要
 * 重传（`SourceManager` 拿登记项本身当版本号），这样万一发生了也不会画旧图。
 */

/**
 * 已解码、待上传的图片。
 *
 * `w/h` 给 placement 算 fit 用（contain/cover 要长宽比）。
 * `source` 刻意是 **canvas 而不是 ImageBitmap**，理由见 `registerImageBytes`。
 */
export interface ImageEntry {
  source: TexImageSource;
  w: number;
  h: number;
}

/**
 * 视频素材的载体。**优先 `Blob`**：本地导入时 `File` 是磁盘背书的句柄，
 * mediabunny 从它 seek 读，几 GB 素材也不会把页面撑爆。
 *
 * `Uint8Array` 是为**打开工程**那条路准备的降级：`AssetStore.loadFrom` 会把
 * 素材读回内存（AGENTS §8 第 12 条的已知问题），此时再包一层 `Blob` 会多一份
 * 拷贝，所以原样收下、用 mediabunny 的 `BufferSource` 零拷贝包住。
 */
export type VideoMedia = Blob | Uint8Array;

const images = new Map<string, ImageEntry>();
const videoMedia = new Map<string, VideoMedia>();

let listener: (() => void) | null = null;
/** 素材就绪/变化时的通知（主应用 → `store.touch()`，让下一帧重绘）。 */
export function setMediaAssetsListener(cb: (() => void) | null): void {
  listener = cb;
}

function notify(): void {
  listener?.();
}

/* ------------------------------------------------------------------ 图片 */

/**
 * 由字节解码出一张**可直接上传**的图源。
 *
 * ## 为什么先解成 ImageBitmap、再画进 canvas（而不是直接上传 ImageBitmap）
 *
 * 这是**实测**逼出来的：Chromium 上传 `ImageBitmap` 时**忽略
 * `UNPACK_FLIP_Y_WEBGL`**，于是图片上下颠倒，而且把那个标志从 true 改成 false
 * 结果逐像素完全一样（`tests/e2e/m6.spec.ts` 抓到的）。canvas 源则正常受那个
 * 标志控制。
 *
 * 所以这里统一成 canvas：**上传源只有一种类型（canvas）**，翻转就在
 * `SourceManager.uploadImage` 一处定义、对图片与视频同时生效 ——
 * 两条路各写一套翻转逻辑是最容易悄悄错一半的做法。
 *
 * 代价是内存里多一份 RGBA（4K 图约 33 MB），可接受：纹理上传后它只用于
 * 重传，不再参与逐帧路径。
 */
export async function registerImageBytes(assetId: string, blob: Blob): Promise<void> {
  const bitmap = await createImageBitmap(blob);
  const w = bitmap.width;
  const h = bitmap.height;
  const canvas =
    typeof OffscreenCanvas !== 'undefined'
      ? new OffscreenCanvas(w, h)
      : document.createElement('canvas');
  if (canvas instanceof HTMLCanvasElement) {
    canvas.width = w;
    canvas.height = h;
  }
  const ctx = canvas.getContext('2d') as
    | OffscreenCanvasRenderingContext2D
    | CanvasRenderingContext2D
    | null;
  if (!ctx) {
    bitmap.close();
    return;
  }
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close();
  images.set(assetId, { source: canvas as unknown as TexImageSource, w, h });
  notify();
}

export function imageSourceFor(assetId: string): ImageEntry | null {
  return images.get(assetId) ?? null;
}

export function forgetImage(assetId: string): void {
  images.delete(assetId);
}

/* ------------------------------------------------------------------ 视频 */

/**
 * 登记一份视频素材的**载体**。不解码、不读字节 —— 见文件头。
 *
 * 本地导入请传 `File`（磁盘背书，零内存）；只有从工程目录读回来的字节
 * 才传 `Uint8Array`。
 */
export function registerVideoMedia(assetId: string, media: VideoMedia): void {
  videoMedia.set(assetId, media);
  notify();
}

export function videoMediaFor(assetId: string): VideoMedia | null {
  return videoMedia.get(assetId) ?? null;
}

export function forgetVideo(assetId: string): void {
  videoMedia.delete(assetId);
}

/* ------------------------------------------------------------------ 通用 */

export function forgetMedia(assetId: string): void {
  forgetImage(assetId);
  forgetVideo(assetId);
}

/** 测试用：清空全部登记（避免用例之间互相污染）。 */
export function clearMediaAssets(): void {
  for (const id of [...images.keys()]) forgetImage(id);
  videoMedia.clear();
}

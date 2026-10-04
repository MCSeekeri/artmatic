/**
 * export-thumbs.ts — lab 的「导出截图」。
 *
 * 两个动作，服务于同一件事（缩略图是**预先准备好的静态图**，而不是每次开
 * 选择器现渲 —— 现渲实测会让帧数 240 → 190）：
 *
 * - `exportCurrentShot()`：把**当前舞台画面**存成 `<特效 id>.png`。
 *   这是「比右键 canvas 另存为更方便」的那个：一键、文件名自动、不弹对话框。
 *   尺寸＝当前舞台大小（不是缩略图尺寸），因为它的用途是「把你正在看的东西存下来」。
 * - `exportAllThumbnails()`：按**目录底图**逐个特效渲一张 **WebP**，打成一个 zip。
 *   解压进 `src/assets/effect-thumbnails/` 就是选择器直接用的那套资源 ——
 *   **中间没有「再压一遍」这一步**（早期版本导 PNG，还得另外转一次）。
 *
 * ## 为什么批量走 zip 而不是七十多次下载
 *
 * 逐张 `a.click()` 会触发浏览器的「是否允许下载多个文件」拦截，而且要往
 * 下载目录里丢七十多个散文件。一个 zip 是一次下载、一个文件，解压出来还是
 * 以特效 id 命名的单张 —— 两边的好处都留着。`fflate` 已经是依赖
 * （PNG 序列导出在用，见 `exporters/png-sequence.ts`）。
 *
 * ## 文件名是**特效 id**，不是显示名
 *
 * id 是这份素材的**主键**：选择器按它取图，重新导出也按它覆盖。
 * 显示名会随文案变（「去饱和度」这种名字一改，文件名就对不上代码了）。
 * 试炼场右栏本来就是「显示名 + id 并排」显示（`lab.spec.ts` 有一条断言钉着
 * 这件事，理由正是「id 是要直接抄进文件名 / i18n 键 / CREDITS 的东西」）。
 */

import { zipSync } from 'fflate';
import { listEffects } from '../src/effects/registry';
import { EffectThumbRenderer, thumbSize } from '../src/render/effect-thumb-renderer';

/** 批量导出可选的高度。宽度按 16:9 推。 */
export const SHOT_HEIGHTS = [128, 192, 256, 360] as const;
export type ShotHeight = (typeof SHOT_HEIGHTS)[number];
/**
 * 默认高度 = **当前仓库里那套资源的尺寸**。
 *
 * 640×360 的 WebP（q84）实测整套只有 **1.11 MB**（原始 640×360 PNG 是 6.6 MB），
 * 所以没有必要为了省体积缩到 256：卡片显示宽度约 208 CSS px，360 高在任何
 * DPI 下都清晰，而且**不重采样**就是零损失。默认值跟着实际资源走，
 * 「重新导出一次」与「仓库里现有的」才是同一个东西。
 */
export const DEFAULT_SHOT_HEIGHT: ShotHeight = 360;
/** 批量导出的 WebP 质量。84 是实测过的甜点：整套 1.11 MB，肉眼看不出损失。 */
export const SHOT_QUALITY = 0.84;

/**
 * 文件名消毒：只留字母数字与 `-` `_` `.`。
 *
 * 特效 id 本来就是这个形状，所以对它们是个恒等变换；真正的用处是**没选特效时
 * 回退到源 id**（`lab:grid` 里的冒号在文件名里不合法）。
 */
export function safeFilename(name: string): string {
  const cleaned = name.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
  return cleaned || 'shot';
}

/** 单张截图的文件名。有特效就用特效 id，否则回退到源 id。 */
export function shotFilename(effectId: string | null, sourceId: string): string {
  return `${safeFilename(effectId ?? sourceId)}.png`;
}

/** 触发一次下载。 */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  // 必须先入文档再 click：Firefox 对游离节点的 click 不触发下载。
  document.body.appendChild(a);
  a.click();
  a.remove();
  // 立刻 revoke 会让部分浏览器在下载开始前把 URL 收走 —— 下一轮事件循环之后再放。
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** 把一张 canvas 存成 PNG 并下载。 */
export async function exportCanvas(canvas: HTMLCanvasElement, filename: string): Promise<void> {
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (!blob) throw new Error('toBlob returned null');
  downloadBlob(blob, filename);
}

export interface ThumbBatchResult {
  /** 真正打进包里的张数。 */
  count: number;
  /** 未压缩的 WebP 总字节数（zip 用 level 0，所以这就是包内大小）。 */
  bytes: number;
  height: number;
}

/**
 * 按目录底图渲染**每一个**特效并打包成一个 zip。
 *
 * 逐张 `await toBlob` + 逐帧让出：既保证 canvas 在被读之前不被下一次渲染覆盖，
 * 也让进度读数真的能动（连渲 73 张会把 UI 冻住）。渲染器与选择器**同源**
 * （`EffectThumbRenderer`），所以导出的就是选择器会显示的东西。
 *
 * 编码 WebP 而不是 PNG：这些图是要**进仓库**的静态资源，PNG 那套（6.6 MB）
 * 对七十多张 640×360 来说太贵，WebP q84 是 1.11 MB 且看不出差别。
 */
export async function exportAllThumbnails(
  height: number,
  onProgress: (done: number, total: number) => void,
): Promise<ThumbBatchResult> {
  const ids = listEffects().map((e) => e.id);
  const size = thumbSize(height);
  const renderer = new EffectThumbRenderer();
  const files: Record<string, Uint8Array> = {};
  let bytes = 0;

  try {
    for (let i = 0; i < ids.length; i += 1) {
      const id = ids[i]!;
      const canvas = renderer.renderCanvas(id, size);
      if (canvas) {
        const blob = await new Promise<Blob | null>((resolve) =>
          canvas.toBlob(resolve, 'image/webp', SHOT_QUALITY),
        );
        if (blob) {
          const buf = new Uint8Array(await blob.arrayBuffer());
          files[`${id}.webp`] = buf;
          bytes += buf.byteLength;
        }
      }
      onProgress(i + 1, ids.length);
      await nextFrame();
    }

    // level 0：WebP 自己已压缩，zip 只负责打包（与 PNG 序列导出同一取舍）。
    const zipped = zipSync(files, { level: 0 });
    const out = new ArrayBuffer(zipped.byteLength);
    new Uint8Array(out).set(zipped);
    downloadBlob(new Blob([out], { type: 'application/zip' }), `effect-thumbnails-${size.h}p.zip`);
    return { count: Object.keys(files).length, bytes, height: size.h };
  } finally {
    renderer.dispose();
  }
}

/** 让出一帧（进度可读、UI 不冻）。 */
function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

/**
 * clipboard-assets.ts — 从剪贴板里挑出「能当素材的那几条」。
 *
 * ## 为什么走 paste 事件而不是 navigator.clipboard.read()
 *
 * `clipboardData` 只在 paste 事件派发期间可读：同步、零权限、不会弹授权框。
 * `navigator.clipboard.read()` 是另一条路（异步 + 权限 + 无头 E2E 里不一定
 * 可用），本项目的排版内部剪贴板早就因为同样的理由绕开了它（见
 * `ui/typography/keys.ts` 的注释）。这里保持同一条边界。
 *
 * ## 纯函数
 *
 * 提取与命名都吃最小接口、吐数据 —— 单测直接喂普通对象，不需要造 DataTransfer。
 * 真正的 UI 分流在 `App.svelte` 的 paste 监听里。
 */

import { kindOfFile, type PoolKind } from './media-pool';
import type { MessageKey } from '../i18n/locales';
import { tr } from '../i18n/index.svelte';

/**
 * `DataTransferItem` 的最小接口。真实条目天然满足 —— 用鸭子类型是为了
 * 单测能直接传字面量对象。
 */
export interface ClipboardItemLike {
  kind: string;
  type: string;
  getAsFile(): File | null;
}

/** 剪贴板里的一条素材：文件 + 认出来的类型。 */
export interface ClipboardAsset {
  file: File;
  kind: PoolKind;
}

/**
 * 挑出剪贴板条目里的素材。**认不出的静默跳过**（文本、HTML 片段、URL）——
 * 粘贴一段文字时弹「不支持的文件」是纯粹的噪声。
 *
 * 类型判据复用 `kindOfFile`（先 MIME 后扩展名）：截图与网页图片的
 * `File.name` 常常是空的，MIME 才是唯一可信的那一半。
 */
export function clipboardAssets(items: readonly ClipboardItemLike[]): ClipboardAsset[] {
  const out: ClipboardAsset[] = [];
  for (const item of items) {
    if (item.kind !== 'file') continue;
    const file = item.getAsFile();
    if (!file) continue;
    // item.type 与 file.type 通常一致；合起来看，任一半能用就行。
    const kind = kindOfFile(file.name, file.type || item.type);
    if (!kind) continue;
    out.push({ file, kind });
  }
  return out;
}

/** MIME 子类型 → 扩展名的少数例外（其余直接用子类型本身）。 */
const EXT_ALIAS: Record<string, string> = {
  jpeg: 'jpg',
  'svg+xml': 'svg',
  quicktime: 'mov',
  mpeg: 'mp3',
  'x-wav': 'wav',
  'x-m4a': 'm4a',
  'x-flac': 'flac',
  'x-aiff': 'aiff',
};

const DEFAULT_EXT: Record<PoolKind, string> = { image: 'png', video: 'mp4', audio: 'wav' };

/**
 * 名字兜底：剪贴板来的字节常常没有名字（截图、从网页复制的图片），
 * 而 `Asset.name` 会被显示在媒体池与片段标签上 —— 空名字的素材列表没有信息量。
 *
 * `base` 由调用方给（已翻译的「剪贴板图片」一类），这里只负责拼扩展名：
 * 扩展名要从**真实 MIME** 推，不是猜 —— 猜错的话 `mimeForImageFilename`
 * 会把这份字节的 Blob 标成另一种类型。
 */
export function fallbackAssetName(base: string, kind: PoolKind, mime: string): string {
  const sub = (mime.split('/')[1] ?? '').split(';')[0].trim().toLowerCase();
  const ext = EXT_ALIAS[sub] ?? (/^[a-z0-9]+$/.test(sub) ? sub : DEFAULT_EXT[kind]);
  return `${base}.${ext}`;
}

/** 空名兜底的「基名」（已翻译）。名字生成于导入那一刻，之后不再随语言变。 */
const CLIPBOARD_BASE_KEY: Record<PoolKind, MessageKey> = {
  image: 'pool.clipboardImage',
  video: 'pool.clipboardVideo',
  audio: 'pool.clipboardAudio',
};

/** 一条剪贴板素材在界面/片段标签上显示的名字。 */
export function clipboardAssetName(asset: ClipboardAsset): string {
  const file = asset.file;
  return file.name.trim() || fallbackAssetName(tr(CLIPBOARD_BASE_KEY[asset.kind]), asset.kind, file.type);
}

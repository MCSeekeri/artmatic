/**
 * media-import.ts — 「一个文件进来 → 变成工程里的一条素材（+ 可选的一条片段）」。
 *
 * ## 为什么单独一层
 *
 * 四个入口要干同一件事：
 *
 * | 入口 | 谁在调 | 片段？ |
 * |---|---|---|
 * | 时间轴菜单（系统文件选择器） | `timeline/Timeline.svelte` | 建 |
 * | 从系统拖文件到时间轴 | 时间轴的落点（`.rows`） | 建 |
 * | 从系统拖文件到媒体池 | `ui/MediaPoolDrawer.svelte` | 不建（只收素材） |
 * | 从媒体池拖条目到时间轴 | 时间轴的落点 | 建（走 `insertAssetClip`） |
 *
 * 各写一份的失败形态很隐蔽：**拖进来的视频与菜单导入的，落点、`fit`、默认长度
 * 慢慢就不一样了**，而这种偏差没人会去查。所以素材那一半全在这里。
 *
 * ## 片段那一半不在这里
 *
 * 建片段一律走 `media-pool.ts` 的 `insertAssetClip()` —— 「默认 4 拍 / contain /
 * cover / 音频按素材时长」只有那一处定义。这里只负责把素材登记好，然后构造一个
 * `PoolItem` 交给它，顺手把片段选中。
 */

import { newId } from '../core/schema';
import { contentOfBlob, contentOfBytes, contentOfPath } from '../project/fingerprint';
import { platform } from '../platform/index';
import { adoptFileHandle } from '../project/fs';
import { putAssetHandle } from '../project/asset-handles';
import { checkImportSize, getLimits } from '../core/capacity';
import { formatBytes } from '../core/format';
import { computeWaveform, decodeAudio } from '../audio/decode';
import { imageSourceFor, registerImageBytes, registerVideoMedia } from '../engine/media-assets';
import { probeVideo } from '../engine/video-source';
import { mimeForImageFilename, putImageBytes } from '../typography/image-assets';
import { appState } from './app-state.svelte';
import { insertAssetClip, kindOfFile, type PoolItem, type PoolKind } from './media-pool';
import { tr } from '../i18n/index.svelte';

export interface ImportTarget {
  /** 片段落点（秒，**已吸附**）。只有给了 `trackId` 才有意义。 */
  start?: number;
  /**
   * 建不建片段、落在哪条轨：
   *  · `undefined`（不给）= **只进素材池**（从系统拖到媒体池、剪贴板的「仅加入媒体池」）；
   *  · 字符串 = 建片段，优先这条轨；
   *  · `null` = 建片段，轨由 `insertAssetClip` 自己挑（找不到装得下的会补一条）——
   *    「粘贴到播放头」这条路没有天然的落轨，用它。
   */
  trackId?: string | null;
}

export interface ImportedFile {
  assetId: string;
  kind: PoolKind;
  /** 落下来的片段末尾（秒）。只进池子、或落点被拒时是 null。 */
  end: number | null;
}

/** 登记完成后的收尾：建片段（可选）+ 选中 + 回传末尾。 */
function finish(
  assetId: string,
  kind: PoolKind,
  name: string,
  meta: { durationSec?: number; size?: { w: number; h: number } },
  target: ImportTarget,
): ImportedFile {
  if (target.trackId === undefined) return { assetId, kind, end: null };

  const item: PoolItem = {
    id: assetId,
    kind,
    name,
    durationSec: meta.durationSec ?? null,
    size: meta.size ?? null,
    bytes: appState.assets.size(assetId),
    missing: false,
  };
  const clipId = insertAssetClip(appState.store, item, {
    at: target.start ?? 0,
    grid: appState.store.project.beatGrid,
    preferredTrackId: target.trackId,
  });
  if (!clipId) return { assetId, kind, end: null };

  appState.selectedClipId = clipId;
  return { assetId, kind, end: appState.store.findClip(clipId)?.clip.end ?? null };
}

/* ------------------------------------------------------------------ 视频 */

/**
 * 导入一份本地视频。
 *
 * 与音频/图片的两处关键差别：
 *  1. **`File` 句柄同时交给渲染层与素材仓**（`registerVideoMedia` / `putFile`）：
 *     解码从磁盘流式读，保存也按块流式写 —— 全程没有「整份字节进堆」那一步
 *     （W1.1）。这是视频与图片/音频在生命周期上的根本区别。
 *  2. 元数据（时长 / 显示尺寸）必须 probe 出来 —— 它决定片段默认长度，
 *     也是「这份字节到底是不是视频」唯一的判据。
 */
export async function importVideoFile(
  file: File,
  target: ImportTarget = {},
  linkedHandle?: unknown,
): Promise<ImportedFile | null> {
  /*
   * 体积闸门在 `probeVideo` 之前（W0.2）。
   *
   * W1.1 之后导入**不再把整份视频读进堆**（`putFile` 只存 `File` 句柄），
   * 所以这条闸门不再防内存，而是一条**策略**上限：单个素材的体积超过本机
   * 预算就不收。它挡的下一步动作是「把这个文件整份拷进工程目录」——
   * 磁盘占用与解码代价仍然是真实成本。口径见 `core/capacity.ts::checkImportSize`。
   */
  const check = checkImportSize(file.size, getLimits().videoPerAssetMB);
  if (!check.ok) {
    appState.flash(
      tr('err.video.tooLarge', {
        size: formatBytes(check.sizeBytes),
        limit: formatBytes(check.limitBytes),
      }),
      'error',
    );
    return null;
  }

  const meta = await probeVideo(file);
  if (!meta) {
    appState.flash(tr('err.video.unreadable', { name: file.name }), 'error');
    return null;
  }

  /*
   * 内容身份（W1 去重）：只读首尾各 64 KiB，**不整份读**。
   * 命中同一份内容就复用它 —— 反复导入同一个文件不该在 assets/ 里堆副本。
   */
  const content = await contentOfBlob(file);
  const existing = appState.assets.findByFp(content.fp);
  if (existing) {
    const wasRetained = appState.assets.isRetained(existing);
    appState.assets.activate(existing);
    registerVideoMedia(existing, file);
    if (linkedHandle) {
      const fh = adoptFileHandle(linkedHandle as FileSystemFileHandle);
      appState.assets.putLinkedHandle(
        existing,
        fh,
        file.size,
        { kind: 'video', name: file.name, originName: file.name },
        content,
      );
      void putAssetHandle(existing, linkedHandle);
    } else {
      appState.assets.putFile(
        existing,
        file,
        { kind: 'video', name: file.name, originName: file.name },
        content,
      );
    }
    const declared = appState.store.project.assets[existing];
    if (!declared) {
      appState.store.commit(tr('tl.importVideo'), (p) => {
        p.assets[existing] = {
          id: existing,
          kind: 'video',
          name: file.name,
          durationSec: meta.duration,
          size: { w: meta.width, h: meta.height },
        };
      });
    }
    appState.flash(
      tr(wasRetained ? 'pool.reusedRestored' : 'pool.reusedAsset', { name: file.name }),
      'info',
    );
    return finish(
      existing,
      'video',
      declared?.name ?? file.name,
      { durationSec: meta.duration, size: { w: meta.width, h: meta.height } },
      target,
    );
  }

  const assetId = newId();
  /*
   * W1.1：**不整份读**。`File` 是磁盘背书的句柄 —— 解码器从它 seek 读，
   * 保存时按块流式写。原先这里 `await file.arrayBuffer()` 是「导入 2 GB 视频 =
   * 2 GB JS 堆」的唯一来源，而它换来的字节没有任何一处消费方需要。
   */
  registerVideoMedia(assetId, file);
  if (linkedHandle) {
    const fh = adoptFileHandle(linkedHandle as FileSystemFileHandle);
    appState.assets.putLinkedHandle(
      assetId,
      fh,
      file.size,
      { kind: 'video', name: file.name, originName: file.name },
      content,
    );
    void putAssetHandle(assetId, linkedHandle);
  } else {
    appState.assets.putFile(
      assetId,
      file,
      {
        kind: 'video',
        name: file.name,
        originName: file.name,
      },
      content,
    );
  }
  appState.store.commit(tr('tl.importVideo'), (p) => {
    p.assets[assetId] = {
      id: assetId,
      kind: 'video',
      name: file.name,
      durationSec: meta.duration,
      size: { w: meta.width, h: meta.height },
    };
  });
  return finish(
    assetId,
    'video',
    file.name,
    { durationSec: meta.duration, size: { w: meta.width, h: meta.height } },
    target,
  );
}

/**
 * 桌面版：导入一份**本机路径**（linked）。
 *
 * 视频走 `path` 来源 + mediabunny `CustomSource`，全程只按范围读；图片/音频
 * 读一份字节（解码器本来就要整份）。**不复制进工程**，`collect` 才复制。
 */
export async function importLinkedPath(
  kind: PoolKind,
  name: string,
  path: string,
  size: number,
  target: ImportTarget = {},
): Promise<ImportedFile | null> {
  const read = platform.readPath;
  if (!read) return null;

  if (kind !== 'video') {
    const readFile = platform.readFileAt;
    if (!readFile) return null;
    try {
      const bytes = await readFile(path);
      const data =
        bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength
          ? (bytes.buffer as ArrayBuffer)
          : (bytes.slice().buffer as ArrayBuffer);
      return kind === 'image'
        ? await importImageBlob(name, data, target, undefined, path)
        : await importAudioBlob(name, data, target, undefined, path);
    } catch (e) {
      appState.flash(tr('err.video.unreadable', { name }), 'error');
      void e;
      return null;
    }
  }

  const check = checkImportSize(size, getLimits().videoPerAssetMB);
  if (!check.ok) {
    appState.flash(
      tr('err.video.tooLarge', {
        size: formatBytes(check.sizeBytes),
        limit: formatBytes(check.limitBytes),
      }),
      'error',
    );
    return null;
  }

  const media = {
    kind: 'path' as const,
    path,
    size,
    read: (start: number, end: number) => read(path, start, end),
  };
  const meta = await probeVideo(media);
  if (!meta) {
    appState.flash(tr('err.video.unreadable', { name }), 'error');
    return null;
  }
  const content = await contentOfPath(size, (s, e) => read(path, s, e));
  const existing = appState.assets.findByFp(content.fp);
  const assetId = existing ?? newId();
  const wasRetained = existing ? appState.assets.isRetained(existing) : false;
  if (existing) appState.assets.activate(existing);

  registerVideoMedia(assetId, media);
  appState.assets.putPath(
    assetId,
    path,
    size,
    { kind: 'video', name, originName: name },
    content,
  );

  const declared = appState.store.project.assets[assetId];
  if (!declared) {
    appState.store.commit(tr('tl.importVideo'), (p) => {
      p.assets[assetId] = {
        id: assetId,
        kind: 'video',
        name,
        durationSec: meta.duration,
        size: { w: meta.width, h: meta.height },
      };
    });
  }
  if (existing) {
    appState.flash(
      tr(wasRetained ? 'pool.reusedRestored' : 'pool.reusedAsset', { name }),
      'info',
    );
  }
  return finish(
    assetId,
    'video',
    declared?.name ?? name,
    { durationSec: meta.duration, size: { w: meta.width, h: meta.height } },
    target,
  );
}

/* ------------------------------------------------------------------ 图片 */

/**
 * 导入一张图片（字节形态）。文件选择器与系统拖拽都给字节，所以这里统一收 `ArrayBuffer`。
 *
 * 与视频相反：图片**没有句柄可留**（`pickImageFile` 只给字节），解码用的就是
 * 这份字节本身 —— 必须进仓，否则重开工程时画面是空的。
 */
export async function importImageBlob(
  name: string,
  data: ArrayBuffer,
  target: ImportTarget = {},
  linkedHandle?: unknown,
  linkedPath?: string,
): Promise<ImportedFile | null> {
  const bytes = new Uint8Array(data);
  const content = await contentOfBytes(bytes);
  const existing = appState.assets.findByFp(content.fp);
  const assetId = existing ?? newId();
  const wasRetained = existing ? appState.assets.isRetained(existing) : false;
  if (existing) appState.assets.activate(existing);

  const mime = mimeForImageFilename(name);
  /*
   * 解码放在最前面：后面几步都是「落了地就难收回」的登记，而解不开的字节
   * （扩展名骗人 / 文件截断 / 没有固有尺寸的 SVG）重开时只会变成一条画不出来的素材。
   */
  try {
    await registerImageBytes(assetId, new Blob([data], { type: mime }));
  } catch {
    appState.flash(tr('err.image.unreadable', { name }), 'error');
    return null;
  }
  // 尺寸从解码结果取（拿不到就不写，不猜）。Asset.size 只是展示用。
  const decoded = imageSourceFor(assetId);

  // 排版文档与媒体池缩略图走 objectURL（与打开工程时 hydrate 那条路一致）。
  putImageBytes(assetId, data, mime);
  // 字节进仓。直接持有 `data` 上的视图，不额外拷贝：这份 buffer 是刚读出来的，
  // 没有第二个持有者（`putImageBytes` 与 `registerImageBytes` 各自内部拷贝）。
  const input = { kind: 'image' as const, name, originName: name };
  if (linkedPath) {
    appState.assets.putLinkedBytesAt(assetId, bytes, linkedPath, input, content);
  } else if (linkedHandle) {
    appState.assets.putLinkedBytes(assetId, bytes, input, content);
    void putAssetHandle(assetId, linkedHandle);
  } else {
    appState.assets.put(assetId, bytes, input, content);
  }
  const declared = appState.store.project.assets[assetId];
  if (!declared) {
    appState.store.commit(tr('tl.importImage'), (p) => {
      p.assets[assetId] = {
        id: assetId,
        kind: 'image',
        name,
        ...(decoded ? { size: { w: decoded.w, h: decoded.h } } : {}),
      };
    });
  }
  if (existing) {
    appState.flash(
      tr(wasRetained ? 'pool.reusedRestored' : 'pool.reusedAsset', { name }),
      'info',
    );
  }
  return finish(
    assetId,
    'image',
    declared?.name ?? name,
    decoded ? { size: { w: decoded.w, h: decoded.h } } : {},
    target,
  );
}

/* ------------------------------------------------------------------ 音频 */

/**
 * 导入一段音频（字节形态）。顺序与 `addAudio` 时代一致：解码 → 播放器与波形
 * → 进仓 → 登记 → （可选）建片段 → 拍网格自动估计。
 */
export async function importAudioBlob(
  name: string,
  data: ArrayBuffer,
  target: ImportTarget = {},
  linkedHandle?: unknown,
  linkedPath?: string,
): Promise<ImportedFile | null> {
  const content = await contentOfBytes(new Uint8Array(data));
  const existing = appState.assets.findByFp(content.fp);
  const assetId = existing ?? newId();
  const wasRetained = existing ? appState.assets.isRetained(existing) : false;
  if (existing) appState.assets.activate(existing);

  let buf: AudioBuffer;
  try {
    // decode 会 detach 传进去的 buffer，所以给它一份自己的 slice
    buf = await decodeAudio(data.slice(0));
  } catch {
    appState.flash(tr('err.audio.unreadable', { name }), 'error');
    return null;
  }

  appState.player.register(assetId, buf);
  appState.waveforms = { ...appState.waveforms, [assetId]: await computeWaveform(buf) };
  /*
   * 素材字节进仓（**当前工程**的仓）。不存的话保存工程只留下一个 assetId
   * —— 引用还在、文件没有，重开就是一段哑音。用独立拷贝：上面 decode 那一支
   * 已经吃掉了自己的 slice，这份要留给保存，不能被任何下游 detach。
   */
  const input = { kind: 'audio' as const, name, originName: name };
  const copy = new Uint8Array(data.slice(0));
  if (linkedPath) {
    appState.assets.putLinkedBytesAt(assetId, copy, linkedPath, input, content);
  } else if (linkedHandle) {
    appState.assets.putLinkedBytes(assetId, copy, input, content);
    void putAssetHandle(assetId, linkedHandle);
  } else {
    appState.assets.put(assetId, copy, input, content);
  }
  const declared = appState.store.project.assets[assetId];
  if (!declared) {
    appState.store.commit(tr('tl.importAudio'), (p) => {
      p.assets[assetId] = { id: assetId, kind: 'audio', name, durationSec: buf.duration };
    });
  }
  if (existing) {
    appState.flash(
      tr(wasRetained ? 'pool.reusedRestored' : 'pool.reusedAsset', { name }),
      'info',
    );
  }

  const out = finish(
    assetId,
    'audio',
    declared?.name ?? name,
    { durationSec: buf.duration },
    target,
  );

  // 拍网格还是默认值（120/0）时顺手估一次 —— 用户没动过它，就是在等这个。
  // 动过就绝不覆盖：手调过的卡点比自动估计更值钱。
  await appState.autoEstimateIfDefault();
  return out;
}

/* ------------------------------------------------------------------ 批量 */

/**
 * 一次落下一批文件（系统拖拽进时间轴 / 媒体池）。
 *
 * 认不出的文件**逐条提示**并继续（拖一整个文件夹进来时，里面混着 .txt 是常态，
 * 整批作废等于让用户自己挑文件）。
 *
 * 多个文件在时间轴上是**首尾相接**落下去的（不重新吸附：用户拖进来一串就是
 * 想要一条接一条），所以循环里把上一段的末尾当作下一个的起点。
 *
 * 返回成功登记的条数。
 */
export async function importFiles(
  files: readonly File[],
  target: ImportTarget = {},
): Promise<number> {
  /*
   * **先同步取完路径，再开始 await。**
   *
   * Electron 的 `webUtils.getPathForFile(file)` 只在 drop 事件期间可靠；
   * 循环里第一次 await 之后，`File` 与本机路径的映射可能已经失效 ——
   * 那样拖进来的素材会悄悄退化成「复制一份进工程」。
   */
  // `pathForFile` 在 preload 里同步完成 allowlist 登记（见 preload.cjs）。
  const paths = files.map((f) => platform.pathForFile?.(f) ?? null);

  let start = target.start ?? 0;
  let ok = 0;

  for (let i = 0; i < files.length; i++) {
    const file = files[i]!;
    const kind = kindOfFile(file.name, file.type);
    if (!kind) {
      appState.flash(tr('err.file.unsupported', { name: file.name }), 'error');
      continue;
    }
    const step: ImportTarget = { ...target, start };
    const path = paths[i];

    // 桌面版拖入：默认 linked（与右键「导入」同一条模型）。
    // 路径导入失败时退回字节导入 —— 用户已经松手了，不该什么都不发生。
    const done = path
      ? ((await importLinkedPath(kind, file.name, path, file.size, step)) ??
        (await importFromBytes(file, kind, step)))
      : await importFromBytes(file, kind, step);

    if (!done) continue;
    ok += 1;
    if (done.end !== null) start = done.end;
  }

  return ok;
}

/** 没有本机路径时的兜底：字节导入（拖拽 / 剪贴板 / 浏览器）。 */
async function importFromBytes(
  file: File,
  kind: PoolKind,
  target: ImportTarget,
): Promise<ImportedFile | null> {
  if (kind === 'video') return importVideoFile(file, target);
  const data = await file.arrayBuffer();
  return (kind === 'image' ? importImageBlob : importAudioBlob)(file.name, data, target);
}

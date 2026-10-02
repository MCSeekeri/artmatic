/**
 * asset-store.ts — 运行期素材仓（M5a）。
 *
 * 存的是**素材字节**，不是对象 URL。对象 URL 那边是
 * `typography/image-assets.ts` 的事，两者职责不同：
 *
 * ```
 * 导入 ──┬─→ assetStore.put(id, bytes)     ← 持久化用（保存时写进 assets/）
 *        └─→ putImageBytes(id, url)       ← 渲染用（snapDOM 要能取到 <img>）
 * ```
 *
 * 分开是因为**渲染期解引用是各类型自己的事**（图片给 objectURL、音频给
 * AudioBuffer、视频给 VideoFrame 源），而「存字节」对所有类型都一样。
 * 把两者塞进一个模块会让它同时依赖 typography 与 audio，位置就错了。
 *
 * 字节在内存里是**只读的**：`put()` 整体替换而不是原地改。
 * 哈希缓存的键就是那个 `Uint8Array` 的对象引用，所以原地改会让缓存
 * 悄悄失效（算出旧哈希）。这条不是洁癖——它是增量哈希能成立的前提。
 *
 * ## 走「拷贝进工程」而不是「引用外部路径」
 *
 * M5 原本写的是「素材用引用而非拷贝：绝对路径 + 内容哈希」。在纯浏览器上
 * 这条路走不通，原因是 API 边界而不是设计选择：
 *  - `<input type=file>` 只给字节，不给句柄 → 不拷就没法留
 *  - `showOpenFilePicker()` / 拖放给的句柄**不能被序列化成可移植路径**
 *    → 存进工程就绑死这台机器，工程目录搬走即失效
 *
 * 所以 Web 上的「引用」只能是「工程根相对路径 + 内容哈希」，
 * 前提是字节得留在工程里。代价是视频素材要占一份空间（见 AGENTS.md 的取舍记录）。
 */

import { hashIfReasonable } from './hash';
import { assetRelPath } from './layout';
import { createLedger, type AssetEntry, type AssetLedger, type AssetMode } from './ledger';
import { readAssetBytes } from './io';
import type { FsDirHandle } from './fs';
import type { Project } from '../core/schema';

export interface AssetInput {
  kind: 'audio' | 'image' | 'video';
  /** 展示名，会写进 `Project.assets[id].name`。 */
  name: string;
  /** 原始文件名。**决定落盘的扩展名**，所以别拿展示名代替它。 */
  originName: string;
  mode?: AssetMode;
}

interface Item {
  input: AssetInput;
  bytes: Uint8Array | null;
  addedAt: number;
}

export class AssetStore {
  private items = new Map<string, Item>();
  /**
   * 增量哈希缓存。键是字节对象的**引用**：`put()` 换掉字节就自然失效，
   * 不需要任何显式的 invalidate 调用——那种调用迟早会有人忘记加。
   */
  private hashCache = new Map<string, { ref: Uint8Array; hash: string | null }>();

  put(id: string, bytes: Uint8Array, input: AssetInput): void {
    const prev = this.items.get(id);
    this.items.set(id, {
      input: { ...input, mode: input.mode ?? 'bundled' },
      bytes,
      addedAt: prev?.addedAt ?? Date.now(),
    });
  }

  /**
   * 登记一份「由代码确定性生成、无需落盘」的素材。
   * 演示工程的节拍音频走这条：它是几行代码算出来的，存进 assets/ 反而
   * 让工程目录带着一份可以随时重建的字节。
   */
  putGenerated(id: string, input: AssetInput): void {
    const prev = this.items.get(id);
    this.items.set(id, {
      input: { ...input, mode: 'generated' },
      bytes: null,
      addedAt: prev?.addedAt ?? Date.now(),
    });
  }

  get(id: string): Uint8Array | null {
    return this.items.get(id)?.bytes ?? null;
  }

  has(id: string): boolean {
    return this.items.has(id);
  }

  input(id: string): AssetInput | null {
    return this.items.get(id)?.input ?? null;
  }

  remove(id: string): void {
    this.items.delete(id);
    this.hashCache.delete(id);
  }

  clear(): void {
    this.items.clear();
    this.hashCache.clear();
  }

  ids(): string[] {
    return [...this.items.keys()];
  }

  /** 磁盘占用估算（generated 不计）。 */
  totalBytes(): number {
    let n = 0;
    for (const it of this.items.values()) n += it.bytes?.byteLength ?? 0;
    return n;
  }

  /**
   * 构建完整台账。哈希是增量的：字节引用没变就复用上次的结果。
   *
   * 首次保存要给所有素材算一遍 sha256，之后每次保存几乎零成本 ——
   * 「每次保存都重算全部哈希」是这类实现最常见的性能悬崖，
   * 素材一多就会让保存从毫秒变成秒级。
   */
  async buildLedger(): Promise<AssetLedger> {
    const ledger = createLedger();
    for (const [id, item] of this.items) {
      const mode = item.input.mode ?? 'bundled';
      let hash: string | null = null;
      if (item.bytes && mode === 'bundled') {
        const cached = this.hashCache.get(id);
        if (cached && cached.ref === item.bytes) {
          hash = cached.hash;
        } else {
          hash = await hashIfReasonable(item.bytes);
          this.hashCache.set(id, { ref: item.bytes, hash });
        }
      }
      const entry: AssetEntry = {
        id,
        kind: item.input.kind,
        path: mode === 'generated' ? null : assetRelPath(id, item.input.originName),
        hash,
        bytes: item.bytes?.byteLength ?? null,
        originName: item.input.originName,
        mode,
        addedAt: item.addedAt,
      };
      ledger.entries[id] = entry;
    }
    return ledger;
  }

  /**
   * 从磁盘台账把素材读回内存（打开工程时调）。
   *
   * 磁盘上的哈希直接灌进缓存，省掉一次「读一遍再算一遍」——
   * 打开工程时 `auditLedger` 刚刚算过同一个哈希。
   */
  async loadFrom(
    dir: FsDirHandle,
    ledger: AssetLedger,
    project?: Project,
  ): Promise<{ loaded: number; missing: string[] }> {
    const missing: string[] = [];
    let loaded = 0;
    for (const entry of Object.values(ledger.entries)) {
      const declared = project?.assets[entry.id];
      if (entry.mode === 'generated') {
        this.putGenerated(entry.id, {
          kind: entry.kind,
          name: declared?.name ?? entry.originName,
          originName: entry.originName,
        });
        continue;
      }
      const bytes = await readAssetBytes(dir, entry);
      if (!bytes) {
        missing.push(entry.id);
        continue;
      }
      const input: AssetInput = {
        kind: entry.kind,
        name: declared?.name ?? entry.originName,
        originName: entry.originName,
        mode: 'bundled',
      };
      this.items.set(entry.id, { input, bytes, addedAt: entry.addedAt });
      this.hashCache.set(entry.id, { ref: bytes, hash: entry.hash });
      loaded++;
    }
    return { loaded, missing };
  }

  /** 台账里有、内存里没有的 id（保存前提示用，正常情况下应为空）。 */
  missingFromMemory(ledger: AssetLedger): string[] {
    const out: string[] = [];
    for (const [id, e] of Object.entries(ledger.entries)) {
      if (e.mode === 'generated') continue;
      const it = this.items.get(id);
      if (!it?.bytes) out.push(id);
    }
    return out;
  }
}

/**
 * 造一个素材仓。
 *
 * **不是单例。** 一个网页里可以同时打开多个工程，每个工程有自己的素材表 ——
 * 共用一份的话，保存 A 工程会把 B 工程导入的素材一起写进 A 的 `assets/`，
 * 而台账里会凭空多出几条不属于它的记录。所以按工程实例化。
 *
 * 取当前激活那个的入口是 `appState.assets`。
 */
export function createAssetStore(): AssetStore {
  return new AssetStore();
}

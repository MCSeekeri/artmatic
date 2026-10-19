/**
 * package.ts — `.artmatic` 工程包：把「工程 + 全部未移除素材」收成一个文件。
 *
 * ## 它解决的是「不自包含」的出口
 *
 * linked 素材让日常编辑不复制字节，但工程因此依赖本机文件。要发给别人、
 * 换机器、或者只是存档，就得**显式收集**一次。这个动作就是打包：
 * 包里每一条素材都在 `assets/` 下有一份（包括当前只有本地引用的、以及
 * 「未使用素材」；排除 `.trash/`、`thumbs/`、`analysis/`）。
 *
 * ## 清单先于数据
 *
 * `manifest.json` 在包的最前面，列出工程与素材的路径 / 大小 / 指纹。
 * 导入时先校验清单，再解包 —— 坏包/别人的包在写盘之前就被拒绝。
 *
 * ## 不导入插件
 *
 * 插件是可执行 JS，导入别人的工程包不该顺手执行代码。包里的 `plugins/`
 * 会被**跳过并告警**，需要的话用户在本地重新安装（W0.4 的确认流程）。
 */

import { assetRelPath } from './layout';
import { ZipWriter, crc32, listZip, readZipEntry, safeArchivePath, type ZipChunkSink } from './archive';
import {
  createLedger,
  parseLedger,
  projectPath,
  serializeLedger,
  type AssetEntry,
  type AssetLedger,
} from './ledger';
import { resolveDir, writeBytesAtomic, writeStreamAtomic, type FsDirHandle } from './fs';
import { migrateProject, type Project } from '../core/schema';
import { formatBytes } from '../core/format';
import { tr } from '../i18n/index.svelte';

export const PACK_KIND = 'artmatic/project';
export const PACK_FORMAT = 1;
export const MANIFEST_FILE = 'manifest.json';

export interface PackAsset {
  id: string;
  kind: AssetEntry['kind'];
  originName: string;
  /** 包内路径（`assets/...`）。 */
  path: string;
  bytes: number;
  fp: string | null;
  retained?: boolean;
}

export interface PackManifest {
  kind: typeof PACK_KIND;
  format: number;
  appVersion: string;
  createdAt: number;
  project: { path: string; bytes: number; crc: number };
  assets: PackAsset[];
}

export interface PackInput {
  project: Project;
  store: { buildLedger(): Promise<AssetLedger>; open(id: string): AsyncIterable<Uint8Array> | null };
  sink: ZipChunkSink;
  appVersion?: string;
  createdAt?: number;
}

export interface PackReport {
  assets: number;
  bytes: number;
  /** 素材有台账、但拿不到字节（linked 的来源丢了）。 */
  missing: string[];
}

/**
 * 打包用的台账：**每个非 generated 条目都物化为工程内副本**，本地位置丢弃。
 *
 * 丢弃 local 是安全要求：别人的机器上那条绝对路径毫无意义，留着只会让
 * 导入方的 resolve 去碰一个不属于它的文件。
 */
export function packLedger(ledger: AssetLedger): AssetLedger {
  const out = createLedger();
  for (const [id, e] of Object.entries(ledger.entries)) {
    if (e.mode === 'generated') {
      out.entries[id] = { ...e, locations: [] };
      continue;
    }
    const path = assetRelPath(id, e.originName);
    out.entries[id] = {
      ...e,
      mode: 'bundled',
      locations: [
        {
          kind: 'project',
          path,
          seen: { size: e.content?.size ?? null, fp: e.content?.fp ?? null, mtime: null },
        },
      ],
    };
  }
  return out;
}

export async function packProject(input: PackInput): Promise<PackReport> {
  const projectText = `${JSON.stringify(input.project, null, 2)}\n`;
  const projectBytes = new TextEncoder().encode(projectText);
  const sourceLedger = await input.store.buildLedger();
  const missing: string[] = [];

  /*
   * 先确认每一条都拿得到字节。拿不到的不进清单 —— 写一个「清单里有、包里没有」
   * 的包等于制造一个必然导入失败的坏包，比少一条素材更糟。
   */
  const available = new Set<string>();
  for (const e of Object.values(sourceLedger.entries)) {
    if (e.mode === 'generated') continue;
    if (!input.store.open(e.id) || !e.content || e.content.size <= 0) {
      missing.push(e.originName);
      continue;
    }
    available.add(e.id);
  }
  const keptLedger = createLedger();
  for (const [id, e] of Object.entries(sourceLedger.entries)) {
    if (e.mode !== 'generated' && !available.has(id)) continue;
    keptLedger.entries[id] = e;
  }
  const packedLedger = packLedger(keptLedger);
  const assetsText = serializeLedger(packedLedger);
  const assetEntries = Object.values(packedLedger.entries).filter((e) => e.mode !== 'generated');

  const assets: PackAsset[] = assetEntries.map((e) => ({
    id: e.id,
    kind: e.kind,
    originName: e.originName,
    path: assetRelPath(e.id, e.originName),
    bytes: e.content?.size ?? 0,
    fp: e.content?.fp ?? null,
    ...(e.retained ? { retained: true } : {}),
  }));
  const seen = new Set<string>();
  for (const a of assets) {
    if (seen.has(a.path)) throw new Error(tr('err.pack.duplicatePath', { path: a.path }));
    seen.add(a.path);
  }

  const manifest: PackManifest = {
    kind: PACK_KIND,
    format: PACK_FORMAT,
    appVersion:
      input.appVersion ??
      (typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : 'dev'),
    createdAt: input.createdAt ?? Date.now(),
    project: {
      path: 'project.json',
      bytes: projectBytes.byteLength,
      crc: crc32([projectBytes]),
    },
    assets,
  };
  const manifestBytes = new TextEncoder().encode(`${JSON.stringify(manifest, null, 2)}\n`);

  const writer = new ZipWriter(input.sink);
  await writer.add({
    name: MANIFEST_FILE,
    size: manifestBytes.byteLength,
    open: () => one(manifestBytes),
  });
  await writer.add({
    name: 'project.json',
    size: projectBytes.byteLength,
    open: () => one(projectBytes),
  });
  const assetsBytes = new TextEncoder().encode(assetsText);
  await writer.add({
    name: 'assets.json',
    size: assetsBytes.byteLength,
    open: () => one(assetsBytes),
  });

  let total = manifestBytes.byteLength + projectBytes.byteLength + assetsBytes.byteLength;
  for (const a of assets) {
    const open = input.store.open(a.id);
    if (!open) {
      missing.push(a.originName);
      continue;
    }
    await writer.add({
      name: a.path,
      size: a.bytes,
      // 每次重新取：`open()` 返回的是 generator（只能消费一次）。
      open: () => input.store.open(a.id) ?? empty(),
    });
    total += a.bytes;
  }
  await writer.close();
  return { assets: assets.length - missing.length, bytes: total, missing };
}

async function* one(bytes: Uint8Array): AsyncGenerator<Uint8Array> {
  yield bytes;
}
async function* empty(): AsyncGenerator<Uint8Array> {
  /* 空 */
}

/* ------------------------------------------------------------ 导入 */

export interface UnpackResult {
  project: Project;
  ledger: AssetLedger;
  warnings: string[];
  assets: number;
  bytes: number;
}

export async function readManifest(blob: Blob): Promise<PackManifest> {
  let entries;
  try {
    entries = await listZip(blob);
  } catch {
    // 不是 ZIP / 文件截断：对用户来说与「不是工程包」是同一件事。
    throw new Error(tr('err.pack.notZip'));
  }
  const e = entries.find((x) => x.name === MANIFEST_FILE);
  if (!e) throw new Error(tr('err.pack.noManifest'));
  const chunks: Uint8Array[] = [];
  for await (const c of readZipEntry(blob, e)) chunks.push(c);
  let raw: unknown;
  try {
    raw = JSON.parse(new TextDecoder().decode(concatBytes(chunks)));
  } catch {
    throw new Error(tr('err.pack.badManifest'));
  }
  const m = raw as Partial<PackManifest>;
  if (m.kind !== PACK_KIND || typeof m.format !== 'number') {
    throw new Error(tr('err.pack.badManifest'));
  }
  if (m.format > PACK_FORMAT) throw new Error(tr('err.pack.tooNew', { format: m.format }));
  if (!m.project || typeof m.project.path !== 'string' || !Array.isArray(m.assets)) {
    throw new Error(tr('err.pack.badManifest'));
  }
  return m as PackManifest;
}

/**
 * 解包到一个**空目录**。返回后调用方负责 `openProjectDirectory(dir)`。
 *
 * 写盘顺序与保存一致：素材 → 台账 → 工程。中途失败时目录里没有
 * `project.json`，不会被误认成一份半成品工程。
 */
export async function unpackProject(
  blob: Blob,
  dir: FsDirHandle,
  opts: { maxBytes?: number } = {},
): Promise<UnpackResult> {
  const warnings: string[] = [];
  const manifest = await readManifest(blob);
  if (!safeArchivePath(manifest.project.path) || manifest.project.path !== 'project.json') {
    throw new Error(tr('err.pack.badManifest'));
  }

  const entries = await listZip(blob);
  const byName = new Map(entries.map((e) => [e.name, e]));
  const projectEntry = byName.get('project.json');
  if (!projectEntry) throw new Error(tr('err.pack.noProject'));

  // 先读工程本体并校验（写盘之前就要确定这不是一份坏包）。
  const projectBytes = await readAll(blob, projectEntry);
  if (projectBytes.byteLength !== manifest.project.bytes || crc32([projectBytes]) !== manifest.project.crc) {
    throw new Error(tr('err.pack.corruptProject'));
  }
  let rawProject: unknown;
  try {
    rawProject = JSON.parse(new TextDecoder().decode(projectBytes));
  } catch {
    throw new Error(tr('err.pack.corruptProject'));
  }
  const project = migrateProject(rawProject as Record<string, unknown>);

  // 包里的未知条目：只允许 assets.json / plugins/（后者跳过并告警）。
  const allowed = new Set<string>([MANIFEST_FILE, 'project.json', 'assets.json']);
  for (const a of manifest.assets) {
    const safe = safeArchivePath(a.path);
    if (!safe) throw new Error(tr('err.pack.unsafePath', { path: a.path }));
    allowed.add(safe);
  }
  let ignoredPlugins = 0;
  for (const e of entries) {
    if (allowed.has(e.name)) continue;
    if (e.name.startsWith('plugins/')) {
      ignoredPlugins += 1;
      continue;
    }
    throw new Error(tr('err.pack.unknownEntry', { path: e.name }));
  }
  if (ignoredPlugins) warnings.push(tr('err.pack.pluginsIgnored', { n: ignoredPlugins }));

  const total = manifest.assets.reduce((n, a) => n + a.bytes, 0);
  const cap = opts.maxBytes ?? Infinity;
  if (total > cap) {
    throw new Error(tr('err.pack.tooLarge', { size: formatBytes(total), limit: formatBytes(cap) }));
  }

  // ① 素材。边写边算 CRC；对不上就删掉刚写的半成品并拒绝整包。
  let written = 0;
  for (const a of manifest.assets) {
    const e = byName.get(a.path);
    if (!e) throw new Error(tr('err.pack.missingAsset', { path: a.path }));
    if (e.size !== a.bytes) throw new Error(tr('err.pack.corruptAsset', { path: a.path }));
    const zipEntry = e;
    const segs = a.path.split('/');
    const name = segs.pop()!;
    const parent = await resolveDir(dir, segs, true);
    let crc = 0;
    let size = 0;
    async function* checked(): AsyncGenerator<Uint8Array> {
      for await (const c of readZipEntry(blob, zipEntry)) {
        crc = crc32([c], crc);
        size += c.byteLength;
        yield c;
      }
    }
    await writeStreamAtomic(parent, name, checked(), { verify: false });
    if (size !== a.bytes || crc !== zipEntry.crc) {
      await parent.remove(name).catch(() => {});
      throw new Error(tr('err.pack.corruptAsset', { path: a.path }));
    }
    written += size;
  }
  if (written !== total) throw new Error(tr('err.pack.corruptAsset', { path: '' }));

  /*
   * ② 台账。
   *
   * 优先用包里的 `assets.json`：它保留了 **generated 素材**（演示工程的节拍音频
   * 没有文件，但工程引用着它）以及 retained / addedAt 等细节。但它**不被信任**：
   * 任何指向 manifest 之外路径的条目都拒绝整包；写盘只按 manifest 来。
   * 没有这个文件时按 manifest 重建（也能打开）。
   */
  const assetsEntry = byName.get('assets.json');
  let ledger: AssetLedger;
  if (assetsEntry) {
    const parsed = parseLedger(new TextDecoder().decode(await readAll(blob, assetsEntry)));
    ledger = parsed.ledger;
    warnings.push(...parsed.warnings);
    const declared = new Set(manifest.assets.map((a) => a.path));
    for (const e of Object.values(ledger.entries)) {
      const p = projectPath(e);
      if (p && !declared.has(p)) throw new Error(tr('err.pack.unknownEntry', { path: p }));
    }
  } else {
    ledger = ledgerFromManifest(manifest);
  }
  await writeBytesAtomic(dir, 'assets.json', serializeLedger(ledger), { verify: true });
  // ③ 工程本体（原样写入，打开时再迁移一次，保证与保存路径同一口径）。
  await writeBytesAtomic(dir, 'project.json', projectBytes, { verify: true });
  return { project, ledger, warnings, assets: manifest.assets.length, bytes: total };
}

function ledgerFromManifest(manifest: PackManifest): AssetLedger {
  const ledger = createLedger();
  for (const a of manifest.assets) {
    ledger.entries[a.id] = {
      id: a.id,
      kind: a.kind,
      originName: a.originName,
      mode: 'bundled',
      addedAt: manifest.createdAt,
      ...(a.retained ? { retained: true } : {}),
      content: a.fp ? { size: a.bytes, fp: a.fp } : null,
      locations: [
        {
          kind: 'project',
          path: a.path,
          seen: { size: a.bytes, fp: a.fp, mtime: null },
        },
      ],
    };
  }
  return ledger;
}

async function readAll(blob: Blob, entry: Parameters<typeof readZipEntry>[1]): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  for await (const c of readZipEntry(blob, entry)) chunks.push(c);
  return concatBytes(chunks);
}

function concatBytes(chunks: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(chunks.reduce((n, c) => n + c.byteLength, 0));
  let o = 0;
  for (const c of chunks) {
    out.set(c, o);
    o += c.byteLength;
  }
  return out;
}



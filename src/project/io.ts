/**
 * io.ts — 保存 / 打开编排（M5a）。
 *
 * ## 写入顺序是安全性的全部
 *
 * 两个文件（`project.json` / `assets.json`）加一个目录（`assets/`）没法做成
 * 一次原子提交 —— 没有事务。所以只能选「崩在哪一步损失最小」：
 *
 * ```
 * ① 新增/变化的素材字节 → assets/
 * ② assets.json
 * ③ project.json（原子 + .bak）
 * ④ 删掉已移除的素材文件
 * ```
 *
 * 逐步崩的后果：
 *
 * | 崩在 | 磁盘状态 | 后果 |
 * |---|---|---|
 * | ① 后 ② 前 | assets/ 里多几个文件 | **无害**（台账没记，下次当成 untracked 提示） |
 * | ② 后 ③ 前 | 台账新、工程旧 | **无害**（旧工程引用的素材都还在，因为 ④ 还没跑） |
 * | ③ 后 ④ 前 | 工程不再引用某些素材，但文件还在 | **无害**（孤儿文件占点空间） |
 *
 * 把 ④ 放最后是刻意的：先删文件再写工程，一旦写失败就会留下
 * 「工程引用了已经删掉的素材」——那是**有害**的，用户打开就是一堆 missing。
 * 孤儿文件只是浪费空间，缺失引用是数据丢失，两者不对等。
 *
 * ## project.json 里不写 savedAt
 *
 * 写进去会让「内容没变 → 字节没变」失效：每次保存都生成不同的文件，
 * git diff 永远有噪声，也没法用「序列化结果相同就跳过写入」来省一次磁盘操作。
 * 保存时间属于会话状态（在 `session.ts` 里），不属于工程内容。
 */

import {
  ensureDirs,
  exists,
  isNotFound,
  readBytesIfExists,
  readTextIfExists,
  resolveDir,
  writeBytesAtomic,
  type FsDirHandle,
} from './fs';
import { hashIfReasonable } from './hash';
import {
  ASSET_LEDGER_FILE,
  PROJECT_BACKUP,
  PROJECT_DIRS,
  PROJECT_FILE,
  ASSETS_DIR,
  assetRelPath,
  splitRelPath,
} from './layout';
import {
  auditLedger,
  createLedger,
  detectPathConflicts,
  diffLedger,
  parseLedger,
  relinkPaths,
  serializeLedger,
  type AssetEntry,
  type AssetIssue,
  type AssetLedger,
} from './ledger';
import { migrateProject, type Project } from '../core/schema';

/** 目录里没有 `project.json` —— 打开时用它给用户一句能看懂的话。 */
export class NotAProjectError extends Error {
  constructor(name: string) {
    super(`「${name}」不是一个 Artmatic 工程目录（里面没有 ${PROJECT_FILE}）`);
    this.name = 'NotAProjectError';
  }
}

export async function isProjectDir(dir: FsDirHandle): Promise<boolean> {
  return exists(dir, PROJECT_FILE, 'file');
}

/* ------------------------------------------------------------ 保存 */

export interface SaveInput {
  dir: FsDirHandle;
  project: Project;
  ledger: AssetLedger;
  /** 取素材字节；返回 null = 内存里没有（generated，或素材已丢失）。 */
  bytesFor: (assetId: string) => Uint8Array | null;
}

export interface SaveReport {
  project: { bytes: number; verified: 'hash' | 'size' | 'none'; backup: string | null };
  ledgerBytes: number;
  assetsWritten: number;
  assetsRemoved: number;
  assetBytes: number;
  warnings: string[];
  durationMs: number;
}

export async function saveProject(input: SaveInput): Promise<SaveReport> {
  const t0 = Date.now();
  const { dir, project, ledger, bytesFor } = input;
  const warnings: string[] = [];

  // 两个素材撞同一个文件名会静默互相覆盖（症状：「换了素材但画面没变」）。
  // 这属于调用方构造出的非法台账，宁可不保存。
  const conflicts = detectPathConflicts(ledger);
  if (conflicts.length) {
    const detail = conflicts.map((c) => `${c.path} ← ${c.ids.join(', ')}`).join('；');
    throw new Error(`素材文件名冲突，已中止保存：${detail}`);
  }

  await ensureDirs(dir, PROJECT_DIRS);

  const prev = await readLedgerOrDefault(dir);
  const diff = diffLedger(prev.ledger, ledger);
  const assetsDir = await resolveDir(dir, [ASSETS_DIR], true);

  let assetsWritten = 0;
  let assetBytes = 0;
  const toWrite = [...diff.added, ...diff.changed];
  for (const id of toWrite) {
    const entry = ledger.entries[id]!;
    if (entry.mode === 'generated' || !entry.path) continue;
    const bytes = bytesFor(id);
    if (!bytes) {
      warnings.push(`素材 ${entry.originName}（${id}）在内存里没有字节，跳过写入`);
      continue;
    }
    const segs = splitRelPath(entry.path);
    const name = segs.pop();
    if (!name) continue;
    const parent = await resolveDir(dir, segs, true);
    await writeBytesAtomic(parent, name, bytes, { verify: false });
    assetsWritten++;
    assetBytes += bytes.byteLength;
  }

  // ② 台账。放在工程之前：若之后写工程失败，磁盘上是「新台账 + 旧工程」，
  //    而旧工程引用的素材一个都没被删（④ 还没跑），仍然自洽。
  const ledgerText = serializeLedger(ledger);
  await writeBytesAtomic(dir, ASSET_LEDGER_FILE, ledgerText, { verify: true });

  // ③ 工程本体。
  const projectText = `${JSON.stringify(project, null, 2)}\n`;
  const pr = await writeBytesAtomic(dir, PROJECT_FILE, projectText, {
    backup: PROJECT_BACKUP,
    verify: true,
  });
  warnings.push(...pr.warnings);

  // ④ 用户主动移除的素材才删文件。仅仅「没被片段引用」不算 —— 那多半是
  //    临时从时间轴上拿下来的，自动删掉会让人丢素材。
  let assetsRemoved = 0;
  for (const id of diff.removed) {
    const entry = prev.ledger.entries[id]!;
    if (!entry.path) continue;
    try {
      const segs = splitRelPath(entry.path);
      const name = segs.pop();
      if (!name) continue;
      const parent = await resolveDir(dir, segs, false);
      await parent.remove(name);
      assetsRemoved++;
    } catch (e) {
      if (!isNotFound(e)) warnings.push(`删除旧素材失败（不影响工程）：${entry.path}`);
    }
  }

  return {
    project: { bytes: pr.bytes, verified: pr.verified, backup: pr.backup?.name ?? null },
    ledgerBytes: new TextEncoder().encode(ledgerText).byteLength,
    assetsWritten,
    assetsRemoved,
    assetBytes,
    warnings,
    durationMs: Date.now() - t0,
  };
}

/* ------------------------------------------------------------ 打开 */

export interface OpenResult {
  project: Project;
  ledger: AssetLedger;
  issues: AssetIssue[];
  warnings: string[];
}

export async function openProject(dir: FsDirHandle): Promise<OpenResult> {
  const warnings: string[] = [];

  const rawText = await readTextIfExists(dir, PROJECT_FILE);
  if (rawText === null) throw new NotAProjectError(dir.name);

  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(rawText) as Record<string, unknown>;
  } catch (e) {
    throw new Error(`${PROJECT_FILE} 不是合法 JSON：${e instanceof Error ? e.message : String(e)}`);
  }
  // 迁移 + 校验都在这里发生（schema.ts 的 MIGRATIONS 是那张表）。
  const project = migrateProject(raw);

  const parsed = parseLedger(await readTextIfExists(dir, ASSET_LEDGER_FILE));
  warnings.push(...parsed.warnings);

  let ledger = parsed.ledger;
  const diskPaths = await listAssetPaths(dir);
  if (Object.keys(ledger.entries).length === 0 && diskPaths.length > 0) {
    // 台账丢了不算灾难：文件名就是 `<assetId>.<ext>`，从目录本身重建。
    const rebuilt = await rebuildLedgerFromDir(dir, project, diskPaths);
    ledger = rebuilt.ledger;
    warnings.push(...rebuilt.warnings);
  } else {
    // 台账里的 path 可能因 assetId 或原始文件名变化而过期，落盘前重算一遍。
    ledger = relinkPaths(ledger);
  }

  const issues = await auditLedger(
    ledger,
    (path, needHash) => probe(dir, path, needHash),
    diskPaths,
  );

  return { project, ledger, issues, warnings };
}

/** 打开工程后把 bundled 素材读回内存。丢失的返回 null（`issues` 里已经有记录）。 */
export async function readAssetBytes(dir: FsDirHandle, entry: AssetEntry): Promise<Uint8Array | null> {
  if (entry.mode === 'generated' || !entry.path) return null;
  const segs = splitRelPath(entry.path);
  const name = segs.pop();
  if (!name) return null;
  try {
    const parent = await resolveDir(dir, segs, false);
    return await readBytesIfExists(parent, name);
  } catch (e) {
    if (isNotFound(e)) return null;
    throw e;
  }
}

/* ------------------------------------------------------------ 辅助 */

async function readLedgerOrDefault(dir: FsDirHandle): Promise<{ ledger: AssetLedger; warnings: string[] }> {
  return parseLedger(await readTextIfExists(dir, ASSET_LEDGER_FILE));
}

/** `assets/` 下所有文件的相对路径（`assets/xxx.png`）。目录不存在返回 []。 */
export async function listAssetPaths(dir: FsDirHandle): Promise<string[]> {
  try {
    const assetsDir = await resolveDir(dir, [ASSETS_DIR], false);
    const items = await assetsDir.list();
    return items.filter((i) => i.kind === 'file').map((i) => `${ASSETS_DIR}/${i.name}`);
  } catch (e) {
    if (isNotFound(e)) return [];
    throw e;
  }
}

async function probe(dir: FsDirHandle, relPath: string, needHash: boolean): Promise<{ bytes: number; hash: string | null } | null> {
  const segs = splitRelPath(relPath);
  const name = segs.pop();
  if (!name) return null;
  try {
    const parent = await resolveDir(dir, segs, false);
    const fh = await parent.openFile(name, { create: false });
    const bytes = await (await fh.get()).readBytes();
    return { bytes: bytes.byteLength, hash: needHash ? await hashIfReasonable(bytes) : null };
  } catch (e) {
    if (isNotFound(e)) return null;
    throw e;
  }
}

/**
 * 从 `assets/` 目录重建台账。
 *
 * 这是「台账可丢」的实现：文件名是 `<assetId>.<ext>`，assetId 直接读出来；
 * kind / name 从 `Project.assets` 取（工程本身还活着，它是真相）；
 * 哈希现场算。
 *
 * 认不出的文件（assetId 不在工程里）**照样列进 diskPaths**，
 * 于是会被 `auditLedger` 标成 untracked 提示用户，而不是被静默忽略或删掉。
 */
async function rebuildLedgerFromDir(
  dir: FsDirHandle,
  project: Project,
  diskPaths: string[],
): Promise<{ ledger: AssetLedger; warnings: string[] }> {
  const warnings = ['assets.json 缺失或不完整，已从 assets/ 目录重建台账'];
  const ledger = createLedger();
  for (const rel of diskPaths) {
    const name = rel.slice(rel.lastIndexOf('/') + 1);
    const dot = name.lastIndexOf('.');
    const id = dot > 0 ? name.slice(0, dot) : name;
    const known = project.assets[id];
    const bytes = await probe(dir, rel, true);
    const entry: AssetEntry = {
      id,
      kind: known?.kind ?? 'image',
      path: rel,
      hash: bytes?.hash ?? null,
      bytes: bytes?.bytes ?? null,
      // 原始文件名无从得知（台账才是记它的地方），先用重建出来的名字。
      originName: name,
      mode: 'bundled',
      addedAt: 0,
    };
    ledger.entries[id] = entry;
    if (!known) warnings.push(`assets/${name} 不在工程的素材表里，已标为未跟踪`);
  }
  return { ledger, warnings };
}

/** 素材在磁盘上的相对路径（写台账时用，保证 path 与 layout 规则一致）。 */
export function relPathFor(id: string, originName: string): string {
  return assetRelPath(id, originName);
}

export { createLedger };

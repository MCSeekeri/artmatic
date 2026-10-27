/**
 * drafts.ts — 本地草稿（OPFS `drafts/<key>.json`）。
 *
 * ## 为什么草稿不是「另一份工程」
 *
 * 没有目录句柄的工程（新开、还没保存过）本来一个字节都不在磁盘上。
 * 自动保存对它唯一的落点就是浏览器自己的存储。草稿的语义严格小于正式工程：
 * **只有 `Project` JSON**，没有 `assets/`、没有台账、没有 `.bak`。
 * 所以从草稿恢复出来的工程里，导入过的素材会显示为缺失 —— 那是实话，
 * 不是 bug（素材字节只在「保存到目录」之后才落到磁盘）。
 *
 * ## 为什么文件里要包一层信封
 *
 * 恢复横幅要回答「这是哪个工程、多久以前」，那两个字段不属于 `Project`
 *（写进工程会让「内容没变 → 字节没变」失效，见 `io.ts` 文件头）。
 * 信封只在草稿这一层存在，读的时候剥掉。
 *
 * 目录与文件都**不自动清理**：草稿是崩溃恢复的唯一凭据，删错一次就是丢工作。
 * 只有「手动保存到目录成功」与「用户恢复并接受了这份草稿」两处会删。
 */

import { readTextIfExists, resolveDir, writeBytesAtomic, type FsDirHandle } from './fs';
import { safeAssetId } from './layout';

export const DRAFTS_DIR = 'drafts';
const FORMAT = 1;

export interface DraftMeta {
  /** 草稿文件名（不含扩展名）。恢复与删除都用它定位。 */
  key: string;
  name: string;
  /** 写这份草稿的时刻（毫秒）。 */
  savedAt: number;
}

export interface DraftRecord extends DraftMeta {
  project: unknown;
}

/** 草稿文件的段数组。key 走 assetId 的清洗规则（同一层文件系统，同一套规则）。 */
export function draftPathSegments(key: string): string[] {
  return [DRAFTS_DIR, `${safeAssetId(key, 'draft')}.json`];
}

function stamp(): number {
  return Date.now();
}

/** 写草稿。失败会抛 —— 调用方（自动保存）据此把状态置成 error。 */
export async function writeDraftFile(
  root: FsDirHandle,
  key: string,
  name: string,
  project: unknown,
): Promise<void> {
  const segs = draftPathSegments(key);
  const file = segs.pop()!;
  const dir = await resolveDir(root, segs, true);
  const payload = JSON.stringify({ format: FORMAT, key, name, savedAt: stamp(), project });
  await writeBytesAtomic(dir, file, payload, { verify: true });
}

/**
 * 读一份草稿。**永不抛**：坏文件返回 null（一个坏草稿不该挡住启动，
 * 也不该让「恢复」按钮变成一个红框）。
 */
export async function readDraftFile(root: FsDirHandle, key: string): Promise<DraftRecord | null> {
  const segs = draftPathSegments(key);
  const file = segs.pop()!;
  try {
    const dir = await resolveDir(root, segs, false);
    const text = await readTextIfExists(dir, file);
    if (!text) return null;
    return parseDraft(text, key);
  } catch {
    return null;
  }
}

/** 列出全部草稿（按写入时间倒序）。坏文件跳过，不中断整张列表。 */
export async function listDraftFiles(root: FsDirHandle): Promise<DraftRecord[]> {
  let dir: FsDirHandle;
  try {
    dir = await resolveDir(root, [DRAFTS_DIR], false);
  } catch {
    return [];
  }
  let names: string[];
  try {
    names = (await dir.list()).filter((i) => i.kind === 'file' && i.name.endsWith('.json')).map((i) => i.name);
  } catch {
    return [];
  }
  const out: DraftRecord[] = [];
  for (const name of names) {
    try {
      const text = await readTextIfExists(dir, name);
      const rec = text ? parseDraft(text, name.slice(0, -'.json'.length)) : null;
      if (rec) out.push(rec);
    } catch {
      /* 单个坏草稿跳过 */
    }
  }
  return out.sort((a, b) => b.savedAt - a.savedAt);
}

export async function removeDraftFile(root: FsDirHandle, key: string): Promise<void> {
  const segs = draftPathSegments(key);
  const file = segs.pop()!;
  try {
    const dir = await resolveDir(root, segs, false);
    await dir.remove(file);
  } catch {
    /* 删不掉就留着：最坏是下次启动多问一句，而不是丢内容 */
  }
}

function parseDraft(text: string, fallbackKey: string): DraftRecord | null {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as { format?: unknown; key?: unknown; name?: unknown; savedAt?: unknown; project?: unknown };
  /*
   * 兼容「裸 Project」形态：万一有人把手写的 project.json 丢进 drafts/，
   * 它照样能被恢复，而不是变成一条永远读不出来的坏草稿。
   */
  const project =
    o.project && typeof o.project === 'object'
      ? o.project
      : (o as { schemaVersion?: unknown }).schemaVersion !== undefined
        ? raw
        : null;
  if (!project) return null;
  return {
    key: typeof o.key === 'string' && o.key ? o.key : fallbackKey,
    name: typeof o.name === 'string' && o.name ? o.name : fallbackKey,
    savedAt: typeof o.savedAt === 'number' ? o.savedAt : 0,
    project,
  };
}


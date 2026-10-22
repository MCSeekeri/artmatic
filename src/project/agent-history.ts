/**
 * agent-history.ts — 工程目录里 `agent/sessions/` 的读写。
 *
 * 只管**字节怎么进出工程目录**，不认识会话语义（上限 / 排序 / 清洗都在
 * `src/agent/history.ts`）。与 `plugins.ts` 同一分工。
 *
 * ## 为什么一个会话一个文件
 *
 * - 一轮对话只重写**自己那一个**文件：整份历史（30 × 400 条）不该跟着每次落盘。
 * - 删一个会话 = unlink 一个文件，不需要「读全量 → 过滤 → 重写」。
 * - 一个文件坏掉只丢那一个会话（`failed` 里能看到文件名），其余照常打开。
 *
 * ## 为什么不做索引文件
 *
 * 索引要么是第二份真相（删文件忘了删索引 = 幽灵条目），要么要在每次写入时
 * 同步两份。目录列表本身就是索引：30 个小文件，打开工程时全读一遍是毫秒级。
 *
 * ## 失败策略
 *
 * **永不因为历史而挡打开 / 保存**：读不出来的文件只记进 `failed`；
 * 写失败由调用方记日志。历史是日志，不是工程真相。
 */

import {
  HISTORY_FORMAT_VERSION,
  sanitizeAgentSession,
  sanitizeAgentSessions,
  type AgentSessionRecord,
} from '../agent/history';
import { isNotFound, resolveDir, writeBytesAtomic, type FsDirHandle } from './fs';
import { AGENT_DIR, AGENT_SESSIONS_DIR, agentSessionSegments } from './layout';

export interface ReadAgentHistoryResult {
  /** 已按 `updatedAt` 倒序（清洗函数定的序）。 */
  sessions: AgentSessionRecord[];
  /** 读不出来的文件。**不抛** —— 一个坏文件不该让工程打不开。 */
  failed: { name: string; detail: string }[];
}

/** `agent/sessions/` 目录；`create=false` 且不存在时返回 null。 */
async function sessionsDir(dir: FsDirHandle, create = false): Promise<FsDirHandle | null> {
  try {
    return await resolveDir(dir, [AGENT_DIR, AGENT_SESSIONS_DIR], create);
  } catch {
    return null;
  }
}

/** 是不是一个会话文件（`<id>.json`）。 */
function isSessionFileName(name: string): boolean {
  const lower = name.toLowerCase();
  return lower.endsWith('.json') && !lower.startsWith('.');
}

/**
 * 读出全部会话。
 *
 * 目录不存在 = **正常状态**（还没聊过 / 从旧版工程升上来），返回空集而不是错误。
 * 目录项顺序由文件系统给，所以这里不保证顺序 —— `sanitizeAgentSessions` 会按
 * `updatedAt` 排，那才是唯一的排序口径。
 */
export async function readAgentHistory(dir: FsDirHandle): Promise<ReadAgentHistoryResult> {
  const out: ReadAgentHistoryResult = { sessions: [], failed: [] };
  const adir = await sessionsDir(dir, false);
  if (!adir) return out;

  let entries;
  try {
    entries = await adir.list();
  } catch (e) {
    out.failed.push({ name: `${AGENT_DIR}/${AGENT_SESSIONS_DIR}`, detail: errText(e) });
    return out;
  }

  for (const entry of entries) {
    if (entry.kind !== 'file' || !isSessionFileName(entry.name)) continue;
    try {
      const fh = await adir.openFile(entry.name, { create: false });
      const text = new TextDecoder().decode(await (await fh.get()).readBytes());
      const record = sanitizeAgentSession(JSON.parse(text));
      // 解析成功但内容不可用（没有 id / 没有消息）= 一个空壳文件，丢掉即可。
      if (record) out.sessions.push(record);
    } catch (e) {
      out.failed.push({ name: entry.name, detail: errText(e) });
    }
  }
  // 交给清洗函数定序并截断（它的规则就是唯一口径，别在这里再写一份 30 / 400）。
  out.sessions = sanitizeAgentSessions(out.sessions);
  return out;
}

/** 写一个会话文件（覆盖）。中途失败会留下旧文件还是新文件由原子写决定，不会是半截 JSON。 */
export async function writeAgentSession(dir: FsDirHandle, record: AgentSessionRecord): Promise<void> {
  const adir = await sessionsDir(dir, true);
  if (!adir) throw new Error(`${AGENT_DIR}/${AGENT_SESSIONS_DIR}`);
  const segments = agentSessionSegments(record.id);
  const fileName = segments[segments.length - 1]!;
  const json = `${JSON.stringify({ version: HISTORY_FORMAT_VERSION, ...record }, null, 2)}\n`;
  // 默认的读回校验保留：文件很小（上限 400 条摘要），一次读回的代价远低于
  // 「历史文件半截、下次打开少一段对话」这种事后无法复原的损失。
  await writeBytesAtomic(adir, fileName, json);
}

/** 删掉一个会话文件。文件不存在算成功（幂等：用户可能已在资源管理器里删了）。 */
export async function removeAgentSession(dir: FsDirHandle, sessionId: string): Promise<void> {
  const adir = await sessionsDir(dir, false);
  if (!adir) return;
  const segments = agentSessionSegments(sessionId);
  try {
    await adir.remove(segments[segments.length - 1]!);
  } catch (e) {
    if (!isNotFound(e)) throw e;
  }
}

/** 清空全部会话（只删 `.json`，目录与将来可能存在的其它文件不动）。 */
export async function clearAgentHistory(dir: FsDirHandle): Promise<{ removed: number }> {
  const adir = await sessionsDir(dir, false);
  if (!adir) return { removed: 0 };
  let removed = 0;
  const entries = await adir.list();
  for (const entry of entries) {
    if (entry.kind !== 'file' || !isSessionFileName(entry.name)) continue;
    try {
      await adir.remove(entry.name);
      removed += 1;
    } catch (e) {
      if (!isNotFound(e)) throw e;
    }
  }
  return { removed };
}

function errText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

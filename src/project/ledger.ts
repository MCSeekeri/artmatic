/**
 * ledger.ts — 素材台账（`assets.json`）。
 *
 * ## 为什么素材信息不全都塞进 `project.json`
 *
 * `Project.assets` 是**逻辑**引用（id / kind / name / 时长 / 尺寸），
 * 它会进撤销栈、会被 diff、要跟着工程一起频繁重写。
 * 台账是**物理**信息（落盘路径、内容哈希、原始文件名、字节数）——
 * 它只在导入/重定位素材时变，而且需要单独校验。
 *
 * 混在一起有两个坏处：每次保存都要重算哈希写进工程（哈希变化会让
 * 「内容没变」的判定失效），以及工程文件里混入了与创意无关的机器细节。
 *
 * ## 台账是可以丢的
 *
 * 素材文件名就是 `<assetId>.<ext>`，所以**从 `assets/` 目录本身就能重建台账**
 * （哈希现场算）。因此 `parseLedger` 对损坏输入一律降级成空台账 + 警告，
 * 而不是抛错 —— 为一份可重建的派生数据挡住用户打开工程，是错的取舍。
 * 重建逻辑在 `io.ts`（它需要文件系统，本文件保持纯函数）。
 */

import { LAYOUT_VERSION, assetRelPath } from './layout';

export type AssetMode = 'bundled' | 'generated';

export interface AssetEntry {
  id: string;
  kind: 'audio' | 'image' | 'video';
  /**
   * 相对工程根的路径（POSIX 分隔符），如 `assets/ab12cd.png`。
   *
   * **不是绝对路径。** File System Access 不向页面暴露真实路径（安全设计，
   * 句柄是不透明引用），所以「素材用引用而非拷贝」在 Web 上必然落成
   * 「工程根相对路径」—— 反而比绝对路径好：整个工程目录可以搬走，不绑机器。
   *
   * `null` = 没有字节文件（`mode === 'generated'`）。
   */
  path: string | null;
  /** sha256 小写十六进制；null = 未算（超过阈值或环境不支持）。 */
  hash: string | null;
  bytes: number | null;
  /** 导入时的原始文件名。重定位对话框里要拿它提示用户「找的是这个」。 */
  originName: string;
  mode: AssetMode;
  /** 首次导入时间（毫秒）。只用于展示排序。 */
  addedAt: number;
}

export interface AssetLedger {
  layoutVersion: number;
  entries: Record<string, AssetEntry>;
}

export function createLedger(): AssetLedger {
  return { layoutVersion: LAYOUT_VERSION, entries: {} };
}

/**
 * 解析台账。**永不抛**：
 *  - 不是对象 / 缺 entries → 空台账
 *  - 单条 entry 形状不对 → 丢掉那一条（其余保留，尽量少损失）
 *  - layoutVersion 高于本应用 → 报 warning 但照常读（字段是增量的，多余字段无害）
 */
export function parseLedger(json: string | null | undefined): { ledger: AssetLedger; warnings: string[] } {
  const warnings: string[] = [];
  const empty = createLedger();
  if (!json) return { ledger: empty, warnings };
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    warnings.push('assets.json 不是合法 JSON，已按空台账处理（将从 assets/ 重建）');
    return { ledger: empty, warnings };
  }
  if (!raw || typeof raw !== 'object') {
    warnings.push('assets.json 不是对象，已按空台账处理');
    return { ledger: empty, warnings };
  }
  const obj = raw as { layoutVersion?: unknown; entries?: unknown };
  const lv = typeof obj.layoutVersion === 'number' ? obj.layoutVersion : 0;
  if (lv > LAYOUT_VERSION) warnings.push(`assets.json 的 layoutVersion ${lv} 高于本应用支持的 ${LAYOUT_VERSION}`);
  const entries: Record<string, AssetEntry> = {};
  const src = obj.entries && typeof obj.entries === 'object' ? (obj.entries as Record<string, unknown>) : {};
  for (const [id, v] of Object.entries(src)) {
    const e = normalizeEntry(id, v);
    if (e) entries[id] = e;
    else warnings.push(`assets.json 里的 ${id} 形状不对，已忽略`);
  }
  return { ledger: { layoutVersion: LAYOUT_VERSION, entries }, warnings };
}

function normalizeEntry(id: string, v: unknown): AssetEntry | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Partial<AssetEntry>;
  const kind = o.kind === 'audio' || o.kind === 'image' || o.kind === 'video' ? o.kind : null;
  if (!kind) return null;
  const mode: AssetMode = o.mode === 'generated' ? 'generated' : 'bundled';
  const originName = typeof o.originName === 'string' ? o.originName : id;
  return {
    id: typeof o.id === 'string' && o.id ? o.id : id,
    kind,
    path: typeof o.path === 'string' ? o.path : null,
    hash: typeof o.hash === 'string' ? o.hash : null,
    bytes: typeof o.bytes === 'number' ? o.bytes : null,
    originName,
    mode,
    addedAt: typeof o.addedAt === 'number' ? o.addedAt : 0,
  };
}

/**
 * 序列化。**按 id 排序**，这样「台账逻辑内容没变 → 字节完全一致」。
 * 不排序的话，Map 的插入顺序会让每次导入一个新素材就整份重写，
 * 于是 git 里全是噪声 diff、时间戳也一直在变。
 */
export function serializeLedger(ledger: AssetLedger): string {
  const sorted: Record<string, AssetEntry> = {};
  for (const id of Object.keys(ledger.entries).sort()) sorted[id] = ledger.entries[id]!;
  return `${JSON.stringify({ layoutVersion: LAYOUT_VERSION, entries: sorted }, null, 2)}\n`;
}

/* ------------------------------------------------------------ 变更 */

export interface LedgerDiff {
  /** 新增的素材 id（要写字节）。 */
  added: string[];
  /** 消失的素材 id（要从 assets/ 删文件）。 */
  removed: string[];
  /** 内容变了（哈希或字节数不同）的素材 id（要重写字节）。 */
  changed: string[];
  /** 逻辑内容没变。 */
  unchanged: string[];
}

/**
 * 比较两份台账。
 *
 * 判据是 **hash 优先、退化到 bytes**：`hash === null`（超大文件）时
 * 只能靠字节数，那是弱指纹，会让「换了个同尺寸的文件」漏过去 ——
 * 这种漏检是刻意的降级，不是 bug，`auditLedger` 会把它标成 `unhashed` 提醒用户。
 */
export function diffLedger(prev: AssetLedger, next: AssetLedger): LedgerDiff {
  const added: string[] = [];
  const removed: string[] = [];
  const changed: string[] = [];
  const unchanged: string[] = [];
  for (const [id, n] of Object.entries(next.entries)) {
    const p = prev.entries[id];
    if (!p) {
      added.push(id);
      continue;
    }
    if (sameAsset(p, n)) unchanged.push(id);
    else changed.push(id);
  }
  for (const id of Object.keys(prev.entries)) if (!next.entries[id]) removed.push(id);
  return { added, removed, changed, unchanged };
}

function sameAsset(a: AssetEntry, b: AssetEntry): boolean {
  if (a.path !== b.path) return false;
  if (a.mode !== b.mode) return false;
  if (a.hash && b.hash) return a.hash === b.hash;
  return a.bytes === b.bytes;
}

/**
 * 台账里有没有两条记录指向同一个文件。
 *
 * `safeAssetId` 会清洗掉非法字符，清洗**可能让两个不同 id 撞成同一个文件名**
 * （`a/b` 与 `a:b` 都变成 `ab`）。撞了必须报错而不是静默去重 ——
 * 去重的后果是两份素材共用一个文件，症状是「换了素材但画面没变」。
 */
export function detectPathConflicts(ledger: AssetLedger): { path: string; ids: string[] }[] {
  const byPath = new Map<string, string[]>();
  for (const e of Object.values(ledger.entries)) {
    if (!e.path) continue;
    const list = byPath.get(e.path) ?? [];
    list.push(e.id);
    byPath.set(e.path, list);
  }
  return [...byPath.entries()].filter(([, ids]) => ids.length > 1).map(([path, ids]) => ({ path, ids }));
}

/** 把台账里的 path 重算一遍（改了 assetId 或原始文件名之后调）。 */
export function relinkPaths(ledger: AssetLedger): AssetLedger {
  const entries: Record<string, AssetEntry> = {};
  for (const [id, e] of Object.entries(ledger.entries)) {
    entries[id] = e.mode === 'generated' ? e : { ...e, path: assetRelPath(id, e.originName) };
  }
  return { layoutVersion: LAYOUT_VERSION, entries };
}

/* ------------------------------------------------------------ 磁盘审计 */

export interface DiskProbe {
  bytes: number;
  hash: string | null;
}

export type IssueKind = 'missing' | 'changed' | 'unhashed' | 'untracked';
export type IssueSeverity = 'error' | 'warning' | 'info';

export interface AssetIssue {
  assetId: string;
  kind: IssueKind;
  severity: IssueSeverity;
  path: string | null;
  message: string;
}

/**
 * 拿台账与磁盘实际状态对一遍。`probe` 由调用方提供（它需要文件系统）。
 *
 * `probe` 返回 null = 文件不在。
 *
 * `needHash` 是**性能开关**：只有当台账记了哈希、需要用哈希比对时才传 true。
 * 否则每次打开工程都要给所有素材重算一遍 sha256 —— 几十个素材就是
 * 几百 MB 的读取与哈希，而绝大多数情况下只比大小就够了。
 *
 * `untracked` 是反向检查：`assets/` 里有台账不知道的文件（用户手动放进去的，
 * 或上次保存中途崩了留下的）—— 只提示不处理，绝不自动删用户的东西。
 */
export async function auditLedger(
  ledger: AssetLedger,
  probe: (path: string, needHash: boolean) => Promise<DiskProbe | null>,
  diskPaths: string[] = [],
): Promise<AssetIssue[]> {
  const issues: AssetIssue[] = [];
  const tracked = new Set<string>();

  for (const e of Object.values(ledger.entries)) {
    if (e.mode === 'generated' || !e.path) continue;
    tracked.add(e.path);
    const found = await probe(e.path, !!e.hash);
    if (!found) {
      issues.push({
        assetId: e.id,
        kind: 'missing',
        severity: 'error',
        path: e.path,
        message: `素材文件不在：${e.path}`,
      });
      continue;
    }
    if (e.hash && found.hash) {
      if (e.hash !== found.hash) {
        issues.push({
          assetId: e.id,
          kind: 'changed',
          severity: 'warning',
          path: e.path,
          message: `${e.path} 的内容与工程记录不一致（文件被替换过）`,
        });
      }
      continue;
    }
    if (e.bytes !== null && found.bytes !== e.bytes) {
      issues.push({
        assetId: e.id,
        kind: 'changed',
        severity: 'warning',
        path: e.path,
        message: `${e.path} 的大小变了（${e.bytes} → ${found.bytes} 字节）`,
      });
      continue;
    }
    if (!e.hash) {
      issues.push({
        assetId: e.id,
        kind: 'unhashed',
        severity: 'info',
        path: e.path,
        message: `${e.path} 没有内容哈希，只能靠大小判断有没有被改`,
      });
    }
  }

  for (const p of diskPaths) {
    if (tracked.has(p)) continue;
    issues.push({
      assetId: '',
      kind: 'untracked',
      severity: 'info',
      path: p,
      message: `assets/ 里有一份台账没记录的文件：${p}（不会自动删除）`,
    });
  }

  return issues;
}

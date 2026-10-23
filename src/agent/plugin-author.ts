/**
 * plugin-author.ts — 让 agent **写插件**的那一层：校验 → 试挂 → 安装 / 移除。
 *
 * ## 为什么「试挂」不是「直接写盘」
 *
 * 插件是运行在主 realm 的任意代码（`src/plugins/AGENTS.md` 的安全边界）。把
 * 「生成 → 执行」交给模型一步做完，等于让它在你不知情时跑代码。所以分两级：
 *
 *   1. `pluginTry`   —— 载入内存 + 真 GL 编译校验，可立刻加到时间轴上预览；
 *      模型拿得到结构化错误，能自修复（这是「生成可用插件」的关键闭环）。
 *   2. `pluginInstall` —— 写进 `<工程>/plugins/<id>.js`，**必须**显式确认。
 *
 * 两级都要经过面板上的告知（插件没有沙箱）。控制平面这一侧只负责「没确认就
 * 返回 `needs-approval`」，不自己弹框 —— 它不知道界面长什么样。
 *
 * ## 草稿区
 *
 * 草稿（源码字节）只活在控制平面实例的内存里：它是「这一次会话正在迭代的那份」，
 * 不是工程数据。写进工程之后磁盘才是真源（与 `project/plugins.ts` 同一立场：
 * 不做台账、不做哈希）。
 */

import { isValidPluginSegment } from '../core/plugin-id';
import { listEffects } from '../effects/registry';
import { listGenerators } from '../algos/registry';
import { listTypoHooks } from '../typography/hook-registry';
import { tr } from '../i18n/index.svelte';
import { ControlFailure } from './types';
import type { AgentPluginHost, PluginInfoView, PluginIssueView, PluginTryResult } from './types';

/** 单文件插件的体积上限。超过这个数多半是模型把整段 base64 塞进来了。 */
export const MAX_PLUGIN_BYTES = 256 * 1024;

export interface PluginDraft {
  pluginId: string;
  name: string;
  source: string;
  bytes: Uint8Array;
}

export type DraftStore = Map<string, PluginDraft>;

function encode(source: string): Uint8Array {
  return new TextEncoder().encode(source);
}

/** 同一份清单可能同时报 manifest 与 compile 的问题，去重后按 path 排序。 */
function mergeIssues(...lists: PluginIssueView[][]): PluginIssueView[] {
  const seen = new Set<string>();
  const out: PluginIssueView[] = [];
  for (const list of lists) {
    for (const i of list) {
      const key = `${i.code}|${i.path ?? ''}|${i.detail ?? ''}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ code: i.code, ...(i.path ? { path: i.path } : {}), ...(i.detail ? { detail: i.detail } : {}) });
    }
  }
  return out.sort((a, b) => (a.path ?? '').localeCompare(b.path ?? ''));
}

/** 这个插件注册进注册表的**限定 id**（`${pluginId}/${localId}`）。 */
function qualifiedIds(pluginId: string): {
  effects: string[];
  generators: string[];
  hooks: string[];
} {
  return {
    effects: listEffects().filter((e) => e.pluginId === pluginId).map((e) => e.id),
    generators: listGenerators().filter((g) => g.pluginId === pluginId).map((g) => g.id),
    hooks: listTypoHooks().filter((h) => h.pluginId === pluginId).map((h) => h.key),
  };
}

function infoOf(host: AgentPluginHost, pluginId: string): PluginInfoView | null {
  const info = host.get(pluginId);
  if (!info) return null;
  return {
    id: info.id,
    name: info.name,
    enabled: info.enabled,
    status: info.status,
    effectCount: info.effectCount,
    generatorCount: info.generatorCount,
    hookCount: info.hookCount ?? 0,
    issues: mergeIssues(info.issues),
    fileName: info.fileName,
    draft: false,
  };
}

/* --------------------------------------------------------------- 试挂 */

export async function tryPlugin(opts: {
  host: AgentPluginHost | null;
  projectKey: string | null;
  drafts: DraftStore;
  input: { id: string; name: string; source: string };
  /** 用户已确认「这次可以在页面里执行」。默认 false = 返回 needs-approval。 */
  confirm?: boolean;
}): Promise<PluginTryResult> {
  const { host, projectKey, drafts, input } = opts;
  if (!host) throw new ControlFailure('not-ready', tr('agent.plugin.noHost'));
  if (!isValidPluginSegment(input.id)) {
    throw new ControlFailure('invalid-argument', tr('agent.plugin.badId', { id: String(input.id) }), {
      pattern: '[a-z0-9][a-z0-9._-]*',
    });
  }
  if (typeof input.source !== 'string' || !input.source.trim()) {
    throw new ControlFailure('invalid-argument', tr('agent.plugin.noSource'));
  }
  const bytes = encode(input.source);
  if (bytes.byteLength > MAX_PLUGIN_BYTES) {
    throw new ControlFailure('invalid-argument', tr('agent.plugin.tooLarge', { bytes: bytes.byteLength, max: MAX_PLUGIN_BYTES }));
  }

  /*
   * 确认必须挡在 `host.importBytes` **之前**（W0.4）。
   *
   * 试挂不是「先建个对象看看」：`importBytes` 会 `import()` 这份源码，
   * 也就是**立刻在主世界执行它**。晚一步再拦，代码已经跑过了，
   * 「未确认时没有产生实例」这条判据根本不可能成立。
   *
   * 控制平面永远要求显式 confirm；「本次会话允许试挂」只活在 UI 会话里
   * （`agent-state` 自己决定要不要弹卡），不进入协议。
   */
  if (opts.confirm !== true) {
    throw new ControlFailure('needs-approval', tr('agent.plugin.tryRisk'), {
      kind: 'try',
      pluginId: input.id,
      name: input.name || input.id,
      sourceBytes: bytes.byteLength,
    });
  }

  // 文件名用清单 id 的猜测值；真正的 id 以清单为准（outcome.pluginId）。
  const outcome = await host.importBytes(`${input.id}.js`, bytes, projectKey);
  const info = host.get(outcome.pluginId);

  const registered = qualifiedIds(outcome.pluginId);
  const issues = mergeIssues(outcome.issues, info?.issues ?? []);
  const status = info?.status ?? (outcome.ok ? 'ok' : 'failed');
  const ok = status === 'ok' || status === 'partial';

  /*
   * 校验没过也留着源码：模型下一步要基于它改，而面板要能显示「哪一行」。
   * 草稿 ≠ 已安装 —— 安装必须走 `installPlugin` 的确认。
   */
  drafts.set(outcome.pluginId, {
    pluginId: outcome.pluginId,
    name: input.name || info?.name || outcome.pluginId,
    source: input.source,
    bytes,
  });

  return {
    pluginId: outcome.pluginId,
    ok,
    status,
    effects: registered.effects,
    generators: registered.generators,
    hooks: registered.hooks,
    issues,
    verified: info?.verified ?? false,
    draft: true,
  };
}

/* --------------------------------------------------------------- 安装 */

export interface InstallResult {
  pluginId: string;
  /** 有没有写进工程目录。false = 仅本次会话可用（未绑定目录）。 */
  persisted: boolean;
  effects: string[];
  generators: string[];
  /** 已注册的文档钩子限定 id。 */
  hooks: string[];
}

export async function installPlugin(opts: {
  host: AgentPluginHost | null;
  drafts: DraftStore;
  projectKey: string | null;
  persist: ((pluginId: string, source: string) => Promise<boolean>) | null;
  pluginId: string;
  confirm: boolean;
}): Promise<InstallResult> {
  const { host, drafts, pluginId, confirm } = opts;
  if (!host) throw new ControlFailure('not-ready', tr('agent.plugin.noHost'));
  const draft = drafts.get(pluginId);
  if (!draft) throw new ControlFailure('not-found', tr('agent.plugin.noDraft', { id: pluginId }), { pluginId });

  const info = host.get(pluginId);
  if (!info || (info.status !== 'ok' && info.status !== 'partial')) {
    throw new ControlFailure('unsupported', tr('agent.plugin.blocked', { id: pluginId, status: info?.status ?? 'missing' }), {
      pluginId,
      issues: info?.issues ?? [],
    });
  }
  if (!confirm) {
    throw new ControlFailure('needs-approval', tr('agent.plugin.needsApproval'), {
      kind: 'install',
      pluginId,
      name: draft.name,
      effectCount: info.effectCount,
      generatorCount: info.generatorCount,
      sourceBytes: draft.bytes.byteLength,
    });
  }
  if (!opts.projectKey) throw new ControlFailure('no-project', tr('agent.plugin.noProject'));

  let persisted = false;
  if (opts.persist) persisted = await opts.persist(pluginId, draft.source);
  /*
   * 只有真写进磁盘才 `markPersisted`。内存安装也记成「有文件名」的话，
   * `plugin_discard` 会以为它已经装过而拒绝卸载（表现是「丢弃了但还在」）。
   */
  if (persisted) host.markPersisted(pluginId, `${pluginId}.js`);

  const registered = qualifiedIds(pluginId);
  return {
    pluginId,
    persisted,
    effects: registered.effects,
    generators: registered.generators,
    hooks: registered.hooks,
  };
}

/* --------------------------------------------------------------- 丢弃 / 移除 */

export async function discardPlugin(opts: {
  host: AgentPluginHost | null;
  drafts: DraftStore;
  unload: ((pluginId: string) => Promise<void>) | null;
  pluginId: string;
}): Promise<{ discarded: boolean; stillInstalled: boolean }> {
  const { host, drafts, pluginId } = opts;
  drafts.delete(pluginId);
  const info = host?.get(pluginId) ?? null;
  // 已经写进磁盘的插件不能被「丢弃草稿」顺手卸掉 —— 用户装过它。
  const stillInstalled = Boolean(info?.fileName);
  if (info && !stillInstalled && opts.unload) await opts.unload(pluginId);
  return { discarded: true, stillInstalled };
}

export async function removePlugin(opts: {
  host: AgentPluginHost | null;
  drafts: DraftStore;
  remove: ((pluginId: string) => Promise<void>) | null;
  pluginId: string;
}): Promise<{ removed: boolean }> {
  const { host, drafts, pluginId } = opts;
  if (!host?.get(pluginId) && !drafts.has(pluginId)) {
    throw new ControlFailure('not-found', tr('agent.plugin.notFound', { id: pluginId }));
  }
  drafts.delete(pluginId);
  if (opts.remove) await opts.remove(pluginId);
  return { removed: true };
}

export function listPlugins(host: AgentPluginHost | null, drafts: DraftStore): PluginInfoView[] {
  if (!host) return [];
  const out: PluginInfoView[] = [];
  for (const p of host.list()) {
    const info = infoOf(host, p.id);
    if (info) out.push({ ...info, draft: drafts.has(p.id) });
  }
  return out;
}

/** 面板审批卡要显示源码（用户得看一眼自己批准了什么）。 */
export function draftSource(drafts: DraftStore, pluginId: string): string | null {
  return drafts.get(pluginId)?.source ?? null;
}

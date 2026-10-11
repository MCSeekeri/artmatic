/**
 * host.ts — 插件的**运行期宿主**：加载、注册、编译校验、引用计数、卸载。
 *
 * 它是插件系统里唯一持有可变状态的地方，所以职责边界要划清楚：
 *
 *   `project/plugins.ts`   字节怎么进出工程目录
 *   `plugins/manifest.ts`  一个导出物是不是合法的插件清单
 *   `plugins/loader.ts`    字节 → ES 模块
 *   **`plugins/host.ts`**  把上面三件事接起来，并决定**谁在什么时候被卸载**
 *
 * ## 引用计数：为什么必须有
 *
 * 顶栏选项卡就是工程（AGENTS §5.2），一个页面可以同时开多份工程，而插件是
 * **工程级**的。注册表却是**进程级单例**。于是：
 *
 *   工程 A 打开 → 挂上 my-plugin      （注册表：有）
 *   工程 B 打开 → 也挂 my-plugin      （注册表：已经有，什么都不用做）
 *   工程 A 关闭 → **不能卸载**         （B 还在用）
 *   工程 B 关闭 → 这时候才能卸载
 *
 * 按 pluginId 记账而不是按工程整体记账：两个工程可以各自带一份插件集，
 * 交集部分共用同一份注册。
 *
 * ## 编译校验：错误必须落在「加载」这一刻
 *
 * 着色器是惰性编译的 —— 语法错误在你点到它之前不报（见 `compile-all.ts` 的
 * 文件头）。对内置特效那只意味着「晚一点发现」，对插件却**不可接受**：
 * 用户装了一个坏插件，表现会是「这个特效没反应」，而他没有任何线索指向插件。
 * 所以挂载时就用**与运行期同名**的 `Kit.quad` 编一遍，编不过的 def
 * **直接从注册表里撤掉** —— 渲染层的既有降级（passthrough / null）会自动接管，
 * 画面不会崩，而问题清清楚楚落在插件面板上。
 *
 * Kit 是预览时才有的（`appState.attachPreview` 惰性装配），所以校验分两段：
 * 挂载时若还没有 Kit 就标成「待校验」，`attachKit()` 时补做。
 */

import {
  registerPluginGenerators,
  unregisterPluginGenerators,
  type PluginGeneratorInput,
} from '../algos/registry';
import {
  registerPluginEffects,
  unregisterPlugin,
  type PluginEffectInput,
} from '../effects/registry';
import { compileAlgoShader, compileEffect } from '../effects/compile-all';
import { pluginDefId } from '../core/plugin-id';
import type { Kit } from '../engine/kit';
import type { Project } from '../core/schema';
import {
  pluginIdFromFileName,
  pluginsDir,
  readPluginFiles,
  removePluginFile,
  removePluginFileByName,
  renamePluginFile,
  writePluginFile,
} from '../project/plugins';
import { pluginFileName } from '../project/layout';
import type { FsDirHandle } from '../project/fs';
import { importPluginModule } from './loader';
import { findMissingPlugins, type MissingPluginRef } from './missing';
import {
  manifestFromModule,
  validateManifest,
  type PluginIssue,
  type PluginManifest,
} from './manifest';

/** 停用的插件文件后缀。与 `project/plugins.ts` 的 `PLUGIN_DISABLED_EXT` 一致。 */
export const DISABLED_EXT = '.disabled';

export interface PluginFailure {
  code: 'import-failed' | 'timeout' | 'not-a-plugin' | 'invalid-manifest' | 'read-failed';
  /** 非文案的细节（错误名、超时毫秒数、字段名）。句子由 UI 按 code 拼。 */
  detail: string;
}

export type PluginStatus = 'ok' | 'partial' | 'failed' | 'disabled';

export interface LoadedPlugin {
  id: string;
  /** 清单里的展示名。加载失败 / 停用时为 null（那时没有清单可读）。 */
  name: string | null;
  author: string | null;
  version: string | null;
  license: string | null;
  /**
   * **磁盘上的**文件名（含扩展名）。
   *
   * `null` = 还没有写进磁盘（内存导入、还没保存过工程）。
   *
   * ⚠️ 停用 / 启用 / 移除**必须按它来寻址**，不能按 `${id}.js` 拼：
   * 磁盘上的文件名可以与插件 id 不同（外部放进去的文件、用户改过名、
   * 我们自己写进去时用的是 id 而用户选的文件叫别的）。按 id 拼的表现是
   * 「点了停用，文件没改名，重开工程又回来了」—— 而且没有任何报错。
   * 见 `findFile`。
   */
  fileName: string | null;
  enabled: boolean;
  status: PluginStatus;
  /** 真正进了注册表的条目数（编译失败的已剔除）。 */
  effectCount: number;
  generatorCount: number;
  /** 被降级 / 被丢掉的条目，以及加载失败的原因。 */
  issues: PluginIssue[];
  failure: PluginFailure | null;
  /** 有没有跑过着色器编译校验（没有 Kit 时会推迟到 `attachKit`）。 */
  verified: boolean;
}

export interface PluginImportOutcome {
  /** 失败时也会给一个 id（由文件名推出来），好让面板上有一行可看。 */
  pluginId: string;
  ok: boolean;
  issues: PluginIssue[];
}

/** 内部记录：比 `LoadedPlugin` 多出「重放注册需要的东西」。 */
interface PluginRecord {
  info: LoadedPlugin;
  /** 实际进了注册表的那部分。停用 / 重新启用时用它重放。 */
  registeredEffects: PluginEffectInput[];
  registeredGenerators: PluginGeneratorInput[];
  holders: Set<string>;
}

export class PluginHost {
  private readonly records = new Map<string, PluginRecord>();
  private kit: Kit | null = null;
  private listeners = new Set<() => void>();
  private rev = 0;

  /* --------------------------------------------------------- 订阅 */

  /** 版本号。UI 把它镜像进 `$state` 即可获得响应式（见 `ui/registry-revision`）。 */
  revision(): number {
    return this.rev;
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }

  private bump(): void {
    this.rev++;
    for (const fn of [...this.listeners]) fn();
  }

  /* --------------------------------------------------------- 查询 */

  list(): LoadedPlugin[] {
    return [...this.records.values()]
      .map((r) => r.info)
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  }

  get(pluginId: string): LoadedPlugin | null {
    return this.records.get(pluginId)?.info ?? null;
  }

  /**
   * 已**安装**的插件 id（含加载失败与停用的）。
   *
   * 与「已注册进注册表」是两件事，别混：缺失提示问的是「用户装没装这个插件」。
   * 装了一个坏插件不该提示「请导入插件」—— 那会把人引到完全错误的方向。
   */
  installedIds(): Set<string> {
    return new Set(this.records.keys());
  }

  /** 某个工程引用了、但没装的插件。 */
  missing(project: Project): MissingPluginRef[] {
    return findMissingPlugins(project, this.installedIds());
  }

  /* --------------------------------------------------------- 校验 */

  /**
   * 接上渲染上下文。装配完预览后调用一次；此后挂载的插件立即校验，
   * 之前挂载过的补做。
   *
   * 传 `null` 表示预览被销毁：已校验的状态保留，之后的挂载重新变成「待校验」。
   */
  attachKit(kit: Kit | null): void {
    /*
     * 换了一台 Kit：旧上下文里的 program 已经随它一起没了，之前校验通过的状态
     * 不再成立，得重编一遍。实践中几乎不会发生（Kit 与 canvas 同生共死，
     * 而主界面的 canvas 不卸载），但把判据写在这里比「相信它不会发生」便宜。
     *
     * 之前**被剔除**的 def 不在这里复位：同一份源码在同一个实现上还会编不过，
     * 重试只会让它们重新污染注册表。
     */
    const swapped = kit !== null && this.kit !== null && kit !== this.kit;
    this.kit = kit;
    if (!kit) return;
    if (swapped) {
      for (const rec of this.records.values()) {
        if (rec.info.enabled) rec.info.verified = false;
      }
    }
    let changed = false;
    for (const rec of this.records.values()) {
      if (rec.info.verified || !rec.info.enabled) continue;
      this.verify(rec);
      changed = true;
    }
    if (changed) this.bump();
  }

  /**
   * 用真 GL 编译这个插件带来的每一个 def。
   *
   * 名字走 `effectProgramName` / `algoProgramName`（与运行期同源），所以这里
   * 编好的就是运行期要用的那一份 program —— 不是「另编一份看看」。
   */
  private verify(rec: PluginRecord): void {
    const kit = this.kit;
    if (!kit) return;
    rec.info.verified = true;

    const okEffects: PluginEffectInput[] = [];
    const okGenerators: PluginGeneratorInput[] = [];

    for (const def of rec.registeredEffects) {
      const id = pluginDefId(rec.info.id, def.id);
      const r = compileEffect(kit, id);
      if (r.ok) {
        okEffects.push(def);
        for (const d of r.dropped ?? []) {
          rec.info.issues.push({ code: 'dropped-uniform', path: `effects:${def.id}`, detail: d });
        }
      } else {
        rec.info.issues.push({ code: 'compile-failed', path: `effects:${def.id}`, detail: r.error ?? '' });
      }
    }

    for (const def of rec.registeredGenerators) {
      const id = pluginDefId(rec.info.id, def.id);
      const r = compileAlgoShader(kit, id);
      if (r.ok) {
        okGenerators.push(def);
        /*
         * `dropped` 是「声明了但被链接器丢掉」的 uniform。**只报参数对应的那些**。
         *
         * `compileAlgoShader` 原本把 head 自己提供的 `u_time` / `u_delta` /
         * `u_seed` / `u_resolution` / `u_aspect` 也算进去，那对**内置**生成器是有
         * 意义的（它们总会读其中几个，一个都没读说明写错了）。但一个插件生成器
         * 完全可以合法地什么都不读（比如纯色、纯程序化图案）—— 那样会凭空得到
         * 5 条「参数不会有反应」，把状态打成「部分可用」。
         *
         * 这条检查的本意是「**参数**拨了没反应」，所以判据就是参数名。
         */
        const paramUniforms = new Set(def.params.map((p) => `u_${p.key}`));
        for (const d of r.dropped ?? []) {
          if (!paramUniforms.has(d)) continue;
          rec.info.issues.push({ code: 'dropped-uniform', path: `generators:${def.id}`, detail: d });
        }
      } else {
        rec.info.issues.push({ code: 'compile-failed', path: `generators:${def.id}`, detail: r.error ?? '' });
      }
    }

    // 有 def 被剔除 ⇒ 重新灌一遍（注册表是「整插件替换」语义）。
    if (okEffects.length !== rec.registeredEffects.length) {
      registerPluginEffects(rec.info.id, okEffects);
    }
    if (okGenerators.length !== rec.registeredGenerators.length) {
      registerPluginGenerators(rec.info.id, okGenerators);
    }
    rec.registeredEffects = okEffects;
    rec.registeredGenerators = okGenerators;
    rec.info.effectCount = okEffects.length;
    rec.info.generatorCount = okGenerators.length;
    rec.info.status = this.statusOf(rec);
  }

  private statusOf(rec: PluginRecord): PluginStatus {
    if (!rec.info.enabled) return 'disabled';
    if (rec.info.failure) return 'failed';
    if (rec.info.effectCount + rec.info.generatorCount === 0) return 'failed';
    return rec.info.issues.length > 0 ? 'partial' : 'ok';
  }

  /* ----------------------------------------------------- 挂载 / 卸载 */

  /**
   * 把 `plugins/` 下的全部插件挂到一个工程上。
   *
   * **不抛**：单个文件失败只记在那个 id 上（见 `readPluginFiles` 的注释），
   * 打开工程这条路上不允许出现「一个坏插件毁掉一次打开」。
   */
  async mountFromDirectory(dir: FsDirHandle, projectKey: string): Promise<void> {
    const res = await readPluginFiles(dir);

    for (const f of res.files) {
      const rec = await this.importRecord(f.name, f.bytes, true);
      rec.holders.add(projectKey);
    }
    for (const f of res.failed) {
      const rec = this.recordFailure(pluginIdFromFileName(f.name), f.name, {
        code: 'read-failed',
        detail: f.detail,
      });
      rec.holders.add(projectKey);
    }
    for (const name of res.disabled) {
      const rec = this.recordDisabled(pluginIdFromFileName(name), name);
      rec.holders.add(projectKey);
    }
    if (res.files.length + res.failed.length + res.disabled.length > 0) this.bump();
  }

  /**
   * 导入一个插件文件（用户从本地选的）。**只加载，不落盘** ——
   * 落盘由调用方决定（`ui/plugin-actions.ts`），因为「有没有工程目录」
   * 只有 UI 知道，而「先挂到内存里看看它是不是好的」在任何情况下都成立。
   */
  async importBytes(
    fileName: string,
    bytes: Uint8Array,
    projectKey: string | null,
  ): Promise<PluginImportOutcome> {
    // `onDisk: false` —— 此刻磁盘上还没有它。文件名只用来在**加载失败**时
    // 给面板一行可看的 id（那时读不到清单里的 id）。
    const rec = await this.importRecord(fileName, bytes, false);
    if (projectKey) rec.holders.add(projectKey);
    this.bump();
    const ok = rec.info.status === 'ok' || rec.info.status === 'partial';
    return { pluginId: rec.info.id, ok, issues: rec.info.issues };
  }

  /**
   * 告诉宿主「这个插件刚被写进磁盘，叫这个名字」。
   *
   * 调用点在 `ui/plugin-actions.ts::confirmImport`：那里才知道磁盘名
   * （`plugins/<清单 id>.js`，而用户选的文件可能叫别的）。不调这一下的后果
   * 不是「插件不能用」，而是**停用 / 移除找不到文件** —— 见 `fileName` 的注释。
   */
  markPersisted(pluginId: string, fileName: string): void {
    const rec = this.records.get(pluginId);
    if (rec) rec.info.fileName = fileName;
  }

  /**
   * 释放一个工程持有的全部插件；没人再持有时真正卸载。
   *
   * 关闭工程时调用。**不删磁盘上的文件** —— 插件属于工程，关掉工程不等于
   * 卸载插件。
   */
  release(projectKey: string): void {
    let changed = false;
    for (const [id, rec] of [...this.records]) {
      if (!rec.holders.delete(projectKey)) continue;
      changed = true;
      if (rec.holders.size > 0) continue;
      this.unregister(id);
      this.records.delete(id);
    }
    if (changed) this.bump();
  }

  /**
   * 把一个插件彻底移除：注册表 + 记录 + （有目录时）磁盘上的文件。
   *
   * 顺序是刻意的：**先摘注册表再删文件**。反过来的话，删文件失败会留下
   * 「记录还在、文件没了」的状态 —— 下次打开工程时它要么又冒出来，
   * 要么更糟：记录还在注册表里，而用户以为删掉了。先摘注册表的话，
   * 最坏结果是磁盘上留一个孤儿文件（无害，下次打开会照常加载，用户可再删）。
   */
  async remove(pluginId: string, dir: FsDirHandle | null): Promise<void> {
    const rec = this.records.get(pluginId);
    this.unregister(pluginId);
    this.records.delete(pluginId);
    if (dir) {
      /*
       * 删**所有可能的**名字：记录里那个（外部放进来 / 用户改过名）、
       * `<id>.js` 与 `<id>.js.disabled`（我们自己写的两种形态）。
       * 多试几个名字的代价是一次多余的 NotFound，而漏掉一个的代价是
       * 「点了移除，重开工程它又回来了」—— 后者会被当成「移除坏了」。
       */
      const names = new Set<string>([pluginFileName(pluginId)]);
      if (rec?.info.fileName) names.add(rec.info.fileName);
      for (const n of names) {
        await removePluginFileByName(dir, n).catch(() => {});
        await removePluginFileByName(dir, n + DISABLED_EXT).catch(() => {});
      }
    }
    this.bump();
  }

  /**
   * 停用一个插件（保留文件）。
   *
   * **实现方式是把文件改名成 `<id>.js.disabled`**，而不是在工程 json 里记一份
   * 停用清单。理由：停用是「这个工程用哪些扩展」的一部分，而工程目录里已经
   * 有一个天然的真源 —— 文件在不在。另记一份 json 会立刻带来「两边不一致时
   * 听谁的」的问题，那正是最难查的一类 bug。
   *
   * 代价（面板上要写明）：停用后再打开工程，那一行只剩 id —— 因为**不导入**
   * 它就读不到它的名字。这是刻意的：用户停用插件，本来就不该再执行它的代码。
   */
  async disable(pluginId: string, dir: FsDirHandle | null): Promise<void> {
    const rec = this.records.get(pluginId);
    if (!rec) return;
    this.unregister(pluginId);
    // 按**记录里的**磁盘名寻址；没有（内存导入）就退回 `<id>.js` 猜一次。
    const from = rec.info.fileName ?? pluginFileName(pluginId);
    // 文件可能本来就不在（内存导入、还没保存过工程）：先问一句再改，
    // 免得把一次「本来就没有」当成错误吞掉 —— 那种吞法会让真正的改名失败
    // （权限、被占用）也一起消失。
    if (dir && (await this.hasFile(dir, from))) {
      await renamePluginFile(dir, from, from + DISABLED_EXT).catch(() => {});
    }
    rec.info.fileName = from + DISABLED_EXT;
    rec.info.enabled = false;
    rec.info.status = 'disabled';
    this.bump();
  }

  /**
   * 重新启用。
   *
   * 停用期间被改过的文件**不会**被重新导入（我们手上只有当初那份清单）——
   * 想换版本就走「移除 + 重新导入」。理由：重新导入要再执行一次插件代码，
   * 而用户没要求重新加载。
   */
  async enable(pluginId: string, dir: FsDirHandle | null): Promise<void> {
    const rec = this.records.get(pluginId);
    if (!rec || rec.info.enabled) return;
    const current = rec.info.fileName ?? pluginFileName(pluginId) + DISABLED_EXT;
    const target = current.endsWith(DISABLED_EXT) ? current.slice(0, -DISABLED_EXT.length) : current;
    if (dir && (await this.hasFile(dir, current))) {
      await renamePluginFile(dir, current, target).catch(() => {});
    }
    rec.info.fileName = target;
    rec.info.enabled = true;
    rec.info.failure = null;
    rec.info.issues = rec.info.issues.filter(
      (i) => i.code !== 'compile-failed' && i.code !== 'dropped-uniform',
    );
    rec.info.verified = false;
    this.replay(rec);
    this.bump();
  }

  /** 把（已校验的）清单重新灌进注册表。 */
  private replay(rec: PluginRecord): void {
    const id = rec.info.id;
    registerPluginEffects(id, rec.registeredEffects);
    registerPluginGenerators(id, rec.registeredGenerators);
    this.verify(rec);
    rec.info.status = this.statusOf(rec);
  }

  private unregister(pluginId: string): void {
    unregisterPlugin(pluginId);
    unregisterPluginGenerators(pluginId);
  }

  /* --------------------------------------------------------- 内部 */

  /**
   * @param onDisk 这个文件此刻**已经在工程目录里**了吗。
   *   挂载时有（`mountFromDirectory`），用户在文件选择器里挑的没有 ——
   *   后者要等 `confirmImport` 写盘成功之后调 `markPersisted` 才知道磁盘名。
   */
  private async importRecord(fileName: string, bytes: Uint8Array, onDisk: boolean): Promise<PluginRecord> {
    const fallbackId = pluginIdFromFileName(fileName);
    const diskName = onDisk ? fileName : null;

    /*
     * 同一个 id 已经有**健康的**记录：只挂到新工程上，不重新导入。
     * 两个工程带了同一份插件时走的就是这条路。重新注册虽然结果相同，
     * 但会白白让注册表 revision 增长一次（所有选择器重算一遍）。
     *
     * 失败记录**重试**：上一次失败可能是「预览还没装配、Kit 还没接上」之外的
     * 偶发原因（比如文件正被写到一半），重开工程时再试一次是划算的。
     */
    const existing = this.records.get(fallbackId);
    if (existing && existing.info.status !== 'failed') return existing;

    const imported = await importPluginModule(bytes);
    if (!imported.ok) {
      return this.recordFailure(fallbackId, diskName, { code: imported.code, detail: imported.detail });
    }

    const raw = manifestFromModule(imported.mod);
    if (raw === null) {
      return this.recordFailure(fallbackId, diskName, { code: 'not-a-plugin', detail: 'plugin|default' });
    }

    const validated = validateManifest(raw);
    if (!validated.ok) {
      const rec = this.recordFailure(fallbackId, diskName, {
        code: 'invalid-manifest',
        detail: String(validated.issues[0]?.code ?? ''),
      });
      rec.info.issues = validated.issues;
      return rec;
    }

    return this.install(validated.manifest, diskName, validated.warnings);
  }

  /** 清单合法：注册 + 校验 + 建档。 */
  private install(manifest: PluginManifest, fileName: string | null, warnings: PluginIssue[]): PluginRecord {
    const id = manifest.id;
    this.unregister(id);

    const eff = registerPluginEffects(id, manifest.effects);
    const gen = registerPluginGenerators(id, manifest.generators);

    const rec: PluginRecord = {
      info: {
        id,
        name: manifest.name,
        author: manifest.author,
        version: manifest.version,
        license: manifest.license,
        fileName,
        enabled: true,
        status: 'ok',
        effectCount: eff.added.length,
        generatorCount: gen.added.length,
        issues: [
          ...warnings,
          ...eff.issues.map((i) => ({ code: 'bad-def' as const, path: `effects:${i.id}`, detail: i.code })),
          ...gen.issues.map((i) => ({ code: 'bad-def' as const, path: `generators:${i.id}`, detail: i.code })),
        ],
        failure: null,
        verified: false,
      },
      registeredEffects: manifest.effects,
      registeredGenerators: manifest.generators,
      holders: new Set(),
    };
    this.records.set(id, rec);

    // 有 Kit 就立刻校验；没有就留给 `attachKit` 补做。
    if (this.kit) this.verify(rec);
    rec.info.status = this.statusOf(rec);
    return rec;
  }

  private recordFailure(id: string, fileName: string | null, failure: PluginFailure): PluginRecord {
    this.unregister(id);
    const rec = this.record(id, fileName, { enabled: true, failure });
    this.records.set(id, rec);
    return rec;
  }

  private recordDisabled(id: string, fileName: string | null): PluginRecord {
    const rec = this.record(id, fileName, { enabled: false, failure: null });
    this.records.set(id, rec);
    return rec;
  }

  private record(
    id: string,
    fileName: string | null,
    opts: { enabled: boolean; failure: PluginFailure | null },
  ): PluginRecord {
    return {
      info: {
        id,
        name: null,
        author: null,
        version: null,
        license: null,
        fileName,
        enabled: opts.enabled,
        status: opts.failure ? 'failed' : 'disabled',
        effectCount: 0,
        generatorCount: 0,
        issues: [],
        failure: opts.failure,
        verified: true,
      },
      registeredEffects: [],
      registeredGenerators: [],
      holders: new Set(),
    };
  }

  /* --------------------------------------------------- 磁盘（薄封装） */

  /** `plugins/` 下有没有这个文件（停用/启用时判断用，避免无谓报错）。 */
  async hasFile(dir: FsDirHandle, fileName: string): Promise<boolean> {
    const pdir = await pluginsDir(dir, false);
    if (!pdir) return false;
    try {
      const items = await pdir.list();
      return items.some((i) => i.name === fileName && i.kind === 'file');
    } catch {
      return false;
    }
  }
}

/** 复导出：UI 侧写盘时要用（避免它再 import 一次 `project/plugins`）。 */
export { writePluginFile };

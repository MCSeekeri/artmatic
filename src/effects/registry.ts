/**
 * registry.ts — 特效注册表：defs/<id>.ts 与 glsl/<id>.ts 按文件名自动配对。
 *
 * 「新增特效 = 两个文件」的纪律落地：少任何一半，启动直接报错
 * （一个文件是 UI 定义，一个文件是着色器实现——缺一就是半成品）。
 *
 * ## 双层结构（内置 + 插件）
 *
 * 内置层在**模块加载时**由 `import.meta.glob` 建好，之后不再变动 —— 上面那条
 * 「少一半就 throw」的纪律只对内置生效（它是构建期的约定）。
 * 插件层是**运行期**可写的：`registerPluginEffects()` / `unregisterPlugin()`，
 * 由 `plugins/host.ts` 在工程打开时挂载、关闭时卸载。
 *
 * 两层用**不同的 Map** 而不是一张表，理由有三条：
 *   1. 卸载插件必须是精确的 —— 从一张混合表里按前缀删，删错一个前缀就毁掉内置；
 *   2. 测试与工具（`effect-catalog.test.ts` 那一批）要能只问内置层；
 *   3. `listEffects()` 的调用方（选择器）需要知道**这个条目是不是插件的**，
 *      才能决定标签/缩略图/说明从哪里取。
 *
 * ## 插件 id 的命名空间
 *
 * 插件里的 def 注册后，对外 id 是 `${pluginId}/${局部id}`。这样：
 *   - 与内置的 program 名（`fx-${id}`）天然不撞；
 *   - 「这个 id 属于哪个插件」可以直接从字符串读出来，不必反查表 —— 缺失
 *     插件提示（`plugins/missing.ts`）正是靠这一条工作的。
 *
 * 分隔符选 `/`：它不可能出现在内置 id 里（内置 id 与文件名一致，而文件名里
 * 不可能有路径分隔符），所以「含 `/` ⟺ 插件」这个判据是**单向确定**的。
 */

import type { ParamDef } from './types';
import { defaultValues } from './types';
import type { EffectShaderDef } from './shader-def';
import type { EffectCategory, EffectTag } from './catalog';
import type { Label } from '../i18n/label';
import { pluginDefId, type PluginDefIssue } from '../core/plugin-id';

/** 插件注册时随条目一起带进来的展示元数据（内置为 null，回落到 EFFECT_CATALOG）。 */
export interface EffectMeta {
  desc: Label | null;
  category: EffectCategory | null;
  /** 插件自报的标签。结构标签由 `structuralTags()` 从 shader 推导，不在这里。 */
  tags: EffectTag[];
}

export interface EffectEntry {
  id: string;
  /** 展示名。内置是文案键、插件是字面量 —— 读取点必须走 `resolveLabel()`。 */
  nameKey: Label;
  params: ParamDef[];
  shader: EffectShaderDef;
  /** 展示元数据。内置为 null（说明/分类在 `EFFECT_CATALOG` 里）。 */
  meta: EffectMeta | null;
  /** 提供者：`null` = 内置，否则是插件 id。 */
  pluginId: string | null;
}

interface DefModule {
  id: string;
  nameKey: Label;
  params: ParamDef[];
}
interface GlslModule {
  shader: EffectShaderDef;
}

const defModules = import.meta.glob<DefModule>('./defs/*.ts', { eager: true });
const glslModules = import.meta.glob<GlslModule>('./glsl/*.ts', { eager: true });

function basename(path: string): string {
  return path.replace(/^.*\//, '').replace(/\.ts$/, '');
}

const BUILTIN = new Map<string, EffectEntry>();
const PLUGIN = new Map<string, EffectEntry>();
/** pluginId → 它注册的全部 def id（含命名空间）。卸载时按它精确删除。 */
const PLUGIN_OWNED = new Map<string, Set<string>>();

for (const [path, def] of Object.entries(defModules)) {
  const key = basename(path);
  const glsl = glslModules[`./glsl/${key}.ts`];
  if (!glsl) throw new Error(`特效 ${key} 缺少 glsl/${key}.ts（两个文件纪律）`);
  if (def.id !== key) throw new Error(`特效文件名 ${key} 与 def.id ${def.id} 不一致`);
  BUILTIN.set(key, {
    id: def.id,
    nameKey: def.nameKey,
    params: def.params,
    shader: glsl.shader,
    meta: null,
    pluginId: null,
  });
}
for (const path of Object.keys(glslModules)) {
  const key = basename(path);
  if (!defModules[`./defs/${key}.ts`]) throw new Error(`特效 ${key} 缺少 defs/${key}.ts（两个文件纪律）`);
}

/* --------------------------------------------------------- 变更通知 */

let revision = 0;
const listeners = new Set<() => void>();

/**
 * 注册表版本号。**只在插件挂载/卸载时增长**（内置层是常量）。
 *
 * UI 的用法：把 `revision` 读进 `$derived`，插件挂载后选择器/菜单自动重算。
 * 参照 `typography/font-registry.ts` 的 `revision` —— 那条路已经验证过。
 */
export function effectRegistryRevision(): number {
  return revision;
}

/** 订阅注册表变化。返回退订函数。 */
export function onEffectRegistryChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

function bump(): void {
  revision++;
  // 复制一份再遍历：回调里退订（组件卸载）不应该跳过其它监听者。
  for (const fn of [...listeners]) fn();
}

/* ------------------------------------------------------------- 查询 */

export function getEffect(id: string): EffectEntry | null {
  return PLUGIN.get(id) ?? BUILTIN.get(id) ?? null;
}

/**
 * 全部特效（内置在前、插件在后）。
 *
 * `pluginId` 是给 UI 用的：插件条目要显示来源、要取 `entry.meta` 里的说明，
 * 而内置条目要去 `EFFECT_CATALOG` 里取。调用方拿 `id` 再 `getEffect(id)` 也行，
 * 但那样是两次查表，而这里是热路径（选择器一打开就遍历一遍）。
 */
export function listEffects(): { id: string; nameKey: Label; pluginId: string | null }[] {
  return [
    ...[...BUILTIN.values()].map((e) => ({ id: e.id, nameKey: e.nameKey, pluginId: null })),
    ...[...PLUGIN.values()].map((e) => ({ id: e.id, nameKey: e.nameKey, pluginId: e.pluginId })),
  ];
}

/** 只要内置层。守卫类测试用（它们说的是「内置特效必须有目录条目」）。 */
export function listBuiltinEffects(): { id: string; nameKey: Label }[] {
  return [...BUILTIN.values()].map((e) => ({ id: e.id, nameKey: e.nameKey }));
}

export function defaultEffectValues(id: string): Record<string, number | string> {
  const e = getEffect(id);
  return e ? defaultValues(e.params) : {};
}

/* ----------------------------------------------------------- 插件层 */

/** 插件注册一个特效时给的数据。`id` 是**插件内部**的局部 id。 */
export interface PluginEffectInput {
  id: string;
  name: Label;
  desc?: Label | null;
  category?: EffectCategory | null;
  tags?: readonly EffectTag[];
  params: ParamDef[];
  shader: EffectShaderDef;
}

/**
 * 挂载一个插件的全部特效。
 *
 * 重复调用同一个 pluginId 会**先卸载旧的**（热重载语义：用户在插件源码上迭代，
 * 重新导入就应该看到新的）。局部 id 重复、或命名空间后与已有条目撞车，
 * 都记一条 issue 并跳过那一条 —— 不因为一个坏条目丢掉整个插件。
 */
export function registerPluginEffects(
  pluginId: string,
  defs: readonly PluginEffectInput[],
): { added: string[]; issues: PluginDefIssue[] } {
  unregisterPlugin(pluginId);

  const issues: PluginDefIssue[] = [];
  const added: string[] = [];
  const owned = new Set<string>();

  for (const def of defs) {
    const local = String(def?.id ?? '');
    if (!local) {
      issues.push({ code: 'missing-id', id: '' });
      continue;
    }
    const id = pluginDefId(pluginId, local);
    if (owned.has(id)) {
      issues.push({ code: 'duplicate-id', id: local });
      continue;
    }
    if (BUILTIN.has(id)) {
      // 理论上不可达（含 `/` 的 id 不可能出现在内置层），留作防御。
      issues.push({ code: 'builtin-conflict', id: local });
      continue;
    }
    owned.add(id);
    PLUGIN.set(id, {
      id,
      nameKey: def.name,
      params: def.params ?? [],
      shader: def.shader,
      meta: {
        desc: def.desc ?? null,
        category: def.category ?? null,
        tags: [...(def.tags ?? [])],
      },
      pluginId,
    });
    added.push(id);
  }

  if (owned.size > 0) PLUGIN_OWNED.set(pluginId, owned);
  bump();
  return { added, issues };
}

/**
 * 卸载一个插件的全部条目。**只删它自己注册的那些** —— 靠 `PLUGIN_OWNED`
 * 精确记账，不按前缀扫描（前缀扫描会在两个插件 id 互为前缀时删错：
 * `foo` 与 `foo/bar`）。
 */
export function unregisterPlugin(pluginId: string): void {
  const owned = PLUGIN_OWNED.get(pluginId);
  if (!owned) return;
  PLUGIN_OWNED.delete(pluginId);
  for (const id of owned) PLUGIN.delete(id);
  bump();
}

/** 当前已挂载的插件 id。 */
export function listPluginIds(): string[] {
  return [...PLUGIN_OWNED.keys()];
}

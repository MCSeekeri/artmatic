/**
 * registry.ts — 算法生成器注册表。
 *
 * 新增一个**内置**生成器 = 一个 def 文件 + 这里一行 import。
 * bake 型额外要在 bake.worker.ts 的 BAKERS 里登记（那里有注释提醒）。
 *
 * ## 双层结构（内置 + 插件）
 *
 * 与 `effects/registry.ts` 同构（那边的文件头有完整理由）：内置层在模块加载时
 * 冻结，插件层运行期可写；插件 def 的对外 id 是 `${pluginId}/${局部id}`。
 *
 * ## 插件只支持 realtime
 *
 * `bake` 跑在 Worker 里、`sim` 要满足「seek(f) ≡ 从 0 顺序 step f 次」的
 * 确定性契约 —— 两者都把实现函数交给宿主去另一个上下文里跑。插件的函数对象
 * 没法被结构化克隆进 Worker，而 sim 的确定性契约也无法在加载时自动校验。
 * 所以本期只开放 `realtime`（一段不含头的 fragment + `setUniforms`），
 * 它与内置 realtime 生成器走**完全相同**的编译与派发路径。
 */

import { rule110Def } from './rule110';
import { gameOfLifeDef } from './game-of-life';
import { mandelbrotDef } from './mandelbrot';
import { bifurcationDef } from './bifurcation';
import { langtonsAntDef } from './langtons-ant';
import { lsystemDef } from './lsystem';
import { mengerDef } from './menger';
import { mandelbulbDef } from './mandelbulb';
import { apollonianDef } from './apollonian';
import { newtonDef } from './newton';
import { kleinianDef } from './kleinian';
import { lyapunovDef } from './lyapunov';
import { buddhabrotDef } from './buddhabrot';
import { chaosGameDef } from './chaos-game';
import { dlaDef } from './dla';
import { briansBrainDef } from './brians-brain';
import { cyclicCaDef } from './cyclic-ca';
import { snowflakeDef } from './snowflake';
import { leniaDef } from './lenia';
import { wireworldDef } from './wireworld';
import { sandpileDef } from './sandpile';
import { reactionDiffusionDef } from './reaction-diffusion';
import { sceneDefs } from './scenes';
import { smokeDef } from './smoke';
// 闪回：`recall` 型 —— 内容来自时间轴上更早的那一帧，不是算法（见 flashback.ts）
import { flashbackDef } from './flashback';
import { barsDef } from './bars';
import { gridDef } from './grid';
import { gradientDef } from './gradient';
import { defaultValues } from '../effects/types';
import { pluginDefId, pluginIdOf, type PluginDefIssue } from '../core/plugin-id';
import type { GeneratorDef } from './types';
import type { ParamDef } from '../effects/types';
import type { AlgoSetUniforms } from './shader-lib';
import type { Label } from '../i18n/label';

const DEFS = new Map<string, GeneratorDef>(
  [
    rule110Def,
    gameOfLifeDef,
    mandelbrotDef,
    bifurcationDef,
    langtonsAntDef,
    lsystemDef,
    mengerDef,
    mandelbulbDef,
    apollonianDef,
    newtonDef,
    kleinianDef,
    lyapunovDef,
    buddhabrotDef,
    chaosGameDef,
    dlaDef,
    reactionDiffusionDef,
    briansBrainDef,
    cyclicCaDef,
    sandpileDef,
    snowflakeDef,
    leniaDef,
    wireworldDef,
    // 基础图案（彩条 / 网格 / 渐变）：从试炼场的测试图产品化而来
    barsDef,
    gridDef,
    gradientDef,
    // 程序化场景家族（angel-echo scenes.js）—— 一个文件，五个 def
    ...sceneDefs,
    // 体积烟雾：唯一会写 a < 1 的生成器（可压到别的轨道上）
    smokeDef,
    // 闪回：把片段之前的画面倒着放回来（唯一的 `recall` 型）
    flashbackDef,
  ].map((d) => [d.id, d]),
);

const PLUGIN = new Map<string, GeneratorDef>();
const PLUGIN_OWNED = new Map<string, Set<string>>();

/* --------------------------------------------------------- 变更通知 */

let revision = 0;
const listeners = new Set<() => void>();

/** 注册表版本号。只在插件挂载/卸载时增长。见 `effects/registry.ts` 的同名函数。 */
export function algoRegistryRevision(): number {
  return revision;
}

export function onAlgoRegistryChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

function bump(): void {
  revision++;
  for (const fn of [...listeners]) fn();
}

/* ------------------------------------------------------------- 查询 */

export function getGenerator(id: string): GeneratorDef | null {
  return PLUGIN.get(id) ?? DEFS.get(id) ?? null;
}

export interface GeneratorListEntry {
  id: string;
  nameKey: Label;
  kind: GeneratorDef['kind'];
  /** 一句话说明。内置为 undefined（在 `ALGO_CATALOG` 里），插件写在自己身上。 */
  desc?: Label;
  pluginId: string | null;
}

export function listGenerators(): GeneratorListEntry[] {
  return [
    ...[...DEFS.values()].map((d) => ({
      id: d.id,
      nameKey: d.nameKey,
      kind: d.kind,
      desc: d.desc,
      pluginId: null,
    })),
    ...[...PLUGIN.values()].map((d) => ({
      id: d.id,
      nameKey: d.nameKey,
      kind: d.kind,
      desc: d.desc,
      pluginId: pluginIdOf(d.id),
    })),
  ];
}

/** 只要内置层。守卫类测试与「批量导出内置缩略图」用。 */
export function listBuiltinGenerators(): { id: string; nameKey: Label; kind: GeneratorDef['kind'] }[] {
  return [...DEFS.values()].map((d) => ({ id: d.id, nameKey: d.nameKey, kind: d.kind }));
}

export function defaultParams(id: string): Record<string, number | string> {
  const def = getGenerator(id);
  return def ? defaultValues(def.params) : {};
}

/** 当前已挂载的插件 id。 */
export function listPluginIds(): string[] {
  return [...PLUGIN_OWNED.keys()];
}

/* ----------------------------------------------------------- 插件层 */

/**
 * 插件注册一个生成器时给的数据。
 *
 * 只收 `realtime` 的那几项（见文件头）：`fragment` **不含头**，运行时会拼
 * `ALGO_HEAD`；`setUniforms` 负责把参数派发到 `u_<key>`。
 */
export interface PluginGeneratorInput {
  id: string;
  name: Label;
  desc?: Label | null;
  params: ParamDef[];
  fragment: string;
  setUniforms: AlgoSetUniforms;
}

/**
 * 挂载一个插件的全部生成器。重复调用同一 pluginId 先卸载旧的（热重载语义）。
 * 语义与 `effects/registry.ts::registerPluginEffects` 完全一致。
 */
export function registerPluginGenerators(
  pluginId: string,
  defs: readonly PluginGeneratorInput[],
): { added: string[]; issues: PluginDefIssue[] } {
  unregisterPluginGenerators(pluginId);

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
    if (DEFS.has(id)) {
      issues.push({ code: 'builtin-conflict', id: local });
      continue;
    }
    owned.add(id);
    PLUGIN.set(id, {
      id,
      nameKey: def.name,
      desc: def.desc ?? undefined,
      params: def.params ?? [],
      kind: 'realtime',
      fragment: def.fragment,
      setUniforms: def.setUniforms,
    });
    added.push(id);
  }

  if (owned.size > 0) PLUGIN_OWNED.set(pluginId, owned);
  bump();
  return { added, issues };
}

export function unregisterPluginGenerators(pluginId: string): void {
  const owned = PLUGIN_OWNED.get(pluginId);
  if (!owned) return;
  PLUGIN_OWNED.delete(pluginId);
  for (const id of owned) PLUGIN.delete(id);
  bump();
}

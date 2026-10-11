/**
 * plugin-id.ts — 插件 id 的命名空间规则。
 *
 * 放在 `core/` 而不是 `plugins/`：它是**数据模型**的一部分（会写进 `project.json`
 * 的片段参数里、会被注册表与渲染层读），而不是插件子系统的实现细节。
 * 两个注册表都要用它，放在任一边都会让另一边反向依赖。
 *
 * ## 规则
 *
 *   - **插件 id**：`[a-z0-9][a-z0-9._-]*`，小写，长度 ≤ 64
 *   - **局部 id**：同上
 *   - **对外 id**：`${pluginId}/${localId}`
 *
 * 分隔符用 `/` 是刻意的：内置 id 与文件名一致，而文件名里不可能出现路径
 * 分隔符，所以「含 `/` ⟺ 插件」是**单向确定**的 —— 缺失插件的判定不必反查表。
 *
 * `safeAssetId`（`project/layout.ts`）会把 `/` 洗掉，但那是**文件名**的规则；
 * 插件 id 不进文件名（落盘文件名用的是插件 id 本身，见 `project/layout.ts`）。
 */

export const PLUGIN_ID_SEP = '/';

/** 插件 id / 局部 id 的合法形态。同时挡下 `.`、`..` 与空串。 */
const SEGMENT_RE = /^[a-z0-9][a-z0-9._-]{0,63}$/;

/** 单段 id 是否合法。`..` 与 `.` 因首字符不是 `[a-z0-9]` 被拒。 */
export function isValidPluginSegment(id: unknown): id is string {
  return typeof id === 'string' && SEGMENT_RE.test(id);
}

/** 插件内局部 id → 对外 id。命名空间规则的唯一实现点。 */
export function pluginDefId(pluginId: string, localId: string): string {
  return `${pluginId}${PLUGIN_ID_SEP}${localId}`;
}

/**
 * 注册一个插件 def 时的**问题**。
 *
 * 只带机器可读的 `code` 与**非文案**的细节（id），不带整句 —— 文案由 UI 层
 * 按 code 查表。两条理由：
 *   1. 注册表是纯数据层，不该依赖 i18n 的运行期模块（`tr` 住在 `.svelte.ts` 里）；
 *   2. `src/` 下不许出现面向用户的中日韩字面量（`i18n.test.ts` 守卫），
 *      把句子写在这里会立刻变红。
 */
export interface PluginDefIssue {
  code: 'missing-id' | 'duplicate-id' | 'builtin-conflict';
  /** 出问题的**局部** id（`missing-id` 时为空串）。 */
  id: string;
}

/** 这个 id 是不是插件提供的（含 `/`）。 */
export function isPluginDefId(id: unknown): id is string {
  return typeof id === 'string' && id.includes(PLUGIN_ID_SEP);
}

/** 从插件 def id 里取插件 id；内置 id 返回 null。 */
export function pluginIdOf(id: unknown): string | null {
  if (!isPluginDefId(id)) return null;
  const at = id.indexOf(PLUGIN_ID_SEP);
  const pluginId = id.slice(0, at);
  return isValidPluginSegment(pluginId) ? pluginId : null;
}

/** 从插件 def id 里取局部 id；内置 id 返回 null。 */
export function localDefIdOf(id: unknown): string | null {
  if (!isPluginDefId(id)) return null;
  return id.slice(id.indexOf(PLUGIN_ID_SEP) + 1);
}

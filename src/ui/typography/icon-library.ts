/**
 * icon-library.ts — Lucide 全量图标清单 + 按需加载。
 *
 * ## 为什么不是 `import { X } from '@lucide/svelte/icons/x'`
 *
 * 项目自己的 UI 图标走 `ui/icons.ts` 的**具名直连**（tree-shaking 友好，
 * 但只有几十个）。图标选择器要的是**全量**（1800+）：具名直连会让主 bundle
 * 立刻膨胀到几 MB。
 *
 * 这里用 `import.meta.glob` 对 `@lucide/svelte` 的图标源文件取 `?raw`：
 *
 *  - **清单是免费的**：glob 的 key 在构建期静态解析成路径字符串数组，
 *    不 eager 就不会打包任何图标内容 —— 搜索索引（名字）是纯字符串；
 *  - **内容是懒加载的**：每个 `modules[path]()` 是一个独立的动态 import，
 *    滚动到哪、搜到哪才加载哪些。网格里的 `<button>` 全部先渲染，
 *    内容由 `IconPickerModal` 的可见性观察按需填。
 *
 * ## 为什么读 `.svelte` 源文件而不是编译产物
 *
 * 每个图标文件里有一行由 lucide 构建模板写死的
 * `const iconData = { "name": ..., "node": [...] };` —— 结构化的 iconNode
 * （标签 + 属性），比 `?raw` 一个 `.svg` 更可控：颜色 / 线宽由我们决定
 * （见 `icon-shapes.ts`），而不是从别人写死的 `stroke="currentColor"` 里抠。
 *
 * 解析失败（依赖升级把模板改了）不会让选择器开不出来：那一格留空并
 * 在控制台警告一次。
 */

import { iconNodeToPath, type IconNode } from '../../typography/icon-shapes';

/** 路径 → 懒加载器。`?raw` + default 导出 = 图标 `.svelte` 的源码文本。 */
const modules = import.meta.glob('/node_modules/@lucide/svelte/dist/icons/*.svelte', {
  query: '?raw',
  import: 'default',
}) as Record<string, () => Promise<string>>;

function baseName(path: string): string {
  const file = path.slice(path.lastIndexOf('/') + 1);
  return file.endsWith('.svelte') ? file.slice(0, -'.svelte'.length) : file;
}

/** 图标名 → 加载器。名字即 kebab-case 文件名（`arrow-up` 这样）。 */
const loaders = new Map<string, () => Promise<string>>();
for (const [path, load] of Object.entries(modules)) loaders.set(baseName(path), load);

/** 全部图标名（字母序）。**只有名字**，内容是懒加载的。 */
export const ICON_NAMES: readonly string[] = [...loaders.keys()].sort();

/* ------------------------------------------------------------ 搜索 */

/**
 * 压缩键：小写 + 去掉全部非字母数字。
 *
 * 于是 `arrow-down`、`arrow_down`、`arrow down`、`arrowdown` 都是 `arrowdown` ——
 * 用户凭记忆敲的四种写法命中同一批图标（子串搜索只此一份归一化，没有第二处）。
 */
function compact(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * 名字过滤 + 排序（纯函数）。
 *
 * 多词是 **AND** 语义（`arrow down` 同时命中 `arrow-down-big` 与 `down-arrow`）；
 * 排序是「前缀命中 → 名字短 → 字母序」—— 搜 `search` 时 `search` 自己该排在
 * `file-search-2` 前面。
 *
 * 查询里没有字母数字（中文 / 纯符号）⇒ 返回空：它不可能命中任何一个
 * kebab-case 名字，返回全量反而是「搜索没反应」的假象。
 */
export function searchIcons(names: readonly string[], query: string): string[] {
  if (!query.trim()) return [...names];
  const terms = query.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  if (!terms.length) return [];

  const hits: string[] = [];
  for (const name of names) {
    const key = compact(name);
    if (terms.every((t) => key.includes(t))) hits.push(name);
  }

  const first = terms[0]!;
  const rank = (name: string): number => (compact(name).startsWith(first) ? 0 : 1);
  return hits.sort((a, b) => rank(a) - rank(b) || a.length - b.length || (a < b ? -1 : 1));
}

/* ------------------------------------------------------------ 加载 */

const paths = new Map<string, string | null>();
const inflight = new Map<string, Promise<string | null>>();
let warned = false;

/** 图标数据是 lucide 构建模板写死的单行 JSON。 */
const ICON_DATA_RE = /const iconData = (\{[\s\S]*?\});/;

function parseIconData(raw: string): IconNode | null {
  const m = ICON_DATA_RE.exec(raw);
  if (!m) return null;
  try {
    const data = JSON.parse(m[1]!) as { node?: IconNode };
    return Array.isArray(data.node) ? data.node : null;
  } catch {
    return null;
  }
}

/**
 * 加载一个图标并转成 `ShapeElement.path`（0..100 authored）。
 *
 * 返回值 `null` = 这个名字不存在或数据解析失败（那一格留空）。
 * 重复调用共享同一次加载与缓存。
 */
export function loadIconPath(name: string): Promise<string | null> {
  const cached = paths.get(name);
  if (cached !== undefined) return Promise.resolve(cached);
  const pending = inflight.get(name);
  if (pending) return pending;

  const load = loaders.get(name);
  const task = (load ? load() : Promise.resolve(null))
    .then((raw) => {
      const node = raw ? parseIconData(raw) : null;
      // 只对「文件在、但模板解析不出来」告警；名字不存在是调用方的正常输入。
      if (raw && !node && !warned) {
        warned = true;
        console.warn(`[artmatic] 图标数据解析失败：${name}（@lucide/svelte 的模板可能变了）`);
      }
      const d = node ? iconNodeToPath(node) : null;
      paths.set(name, d);
      inflight.delete(name);
      return d;
    })
    .catch(() => {
      paths.set(name, null);
      inflight.delete(name);
      return null;
    });

  inflight.set(name, task);
  return task;
}

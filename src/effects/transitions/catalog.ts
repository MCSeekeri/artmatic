/**
 * transitions/catalog.ts — 把 gl-transitions 的原始集合做成我们的转场目录。
 *
 * 四件事，顺序不能换：
 *   1. **CJS interop 归一**（`normalizeCatalog`）—— 全项目唯一一处 import 这个包
 *   2. **许可过滤** —— 非宽松许可的条目直接不进目录（AGENTS §1.8 的纪律：
 *      「不在禁止清单」不等于「查过」。这里是查过之后的落地）
 *   3. **形状过滤** —— 缺 glsl / 没有 `vec4 transition(` 的条目剔除
 *   4. **派生** —— 参数扁平化 + body 包装成可编译的 fragment
 *
 * 被剔除的条目进 `CATALOG_ISSUES`，由单测与 `CREDITS.md` 共用。
 * 剔除是**静默不加载**，不是「加载了再降级」—— 一条许可不明的着色器不应该
 * 有任何机会被编译进产物。
 */

import catalogModule from 'gl-transitions';
import type { GLTransition } from 'gl-transitions';
import { scanDeclaredUniforms, wrapTransitionFragment } from './glsl';
import { deriveTransitionParams } from './params';
import type { TransitionEntry } from './types';

/**
 * 规范提供的四个上下文 uniform。body 允许引用它们（不必自己声明），
 * 除此之外的 uniform 必须能在 `paramsTypes` 里找到 —— 否则它运行时恒为 0，
 * 而 0 往往是退化取值。
 */
const SPEC_UNIFORMS = new Set(['from', 'to', 'progress', 'ratio']);

/**
 * 只靠 from / to / progress / ratio 撑不起来的条目，在这里被拒。
 *
 * 实测（`gl-transitions@1.71.0`）三条，都不动手改上游源码，只拒收：
 *
 * | id | 声明的额外 uniform | 为什么给不出 |
 * |---|---|---|
 * | `luma` | `sampler2D luma` | 需要一张额外的贴图输入，规范里没有这个位置 |
 * | `displacement` | `sampler2D displacementMap` | 同上 |
 * | `burn` | `vec3 color` | 上游生成器漏了 metadata（它只认 `// =`，
 *   不认规范同样支持的 `/* = *\/`），拿不到可信默认值 |
 *
 * 这不是黑名单：判据是**数据驱动**的（见 `whyUnsupported`），上游改了就会自动放行。
 * `burn` 将来若补上 metadata 也可以回来 —— 顺带一提 `burn0` 是同一个意图的
 * 完整实现（有 `burnColor` + fbm 噪声），所以拒掉 `burn` 的损失很小。
 */
function whyUnsupported(
  name: string,
  declaredType: string,
  paramsTypes: Record<string, string>,
): string | null {
  if (SPEC_UNIFORMS.has(name)) return null;
  if (declaredType === 'sampler2D') {
    return `声明了额外贴图输入 sampler2D ${name} —— 规范只提供 from / to，给不出这张图`;
  }
  if (!(name in paramsTypes)) {
    return `声明了 uniform ${name} 但 paramsTypes 里没有它（拿不到可信默认值，运行时恒为 0）`;
  }
  return null;
}

/**
 * 允许进入目录的许可证。全部是宽松许可（署名即可）。
 * 逐条核对过 `gl-transitions@1.71.0`：125 条 = MIT 123 + BSD 3 Clause 1 + BSD 2 Clause 1。
 * 这是**白名单**：将来上游加了一条 GPL 的，它会自动被挡在门外并进
 * `CATALOG_ISSUES`，而不是悄悄混进来。
 */
export const PERMISSIVE_LICENSES = new Set([
  'MIT',
  'BSD 2 Clause',
  'BSD 3 Clause',
  'ISC',
  'Apache-2.0',
  'CC0',
  'Unlicense',
]);

export interface CatalogIssue {
  id: string;
  reason: string;
}

/**
 * CJS 边界。
 *
 * 上游是 `module.exports = [...]` 的 CJS 包（且只有 default 导出，
 * 因为 `cjs-module-lexer` 解析不了一个巨大的数组字面量）。
 * dev 的 dep optimizer 与 build 的 commonjs 插件都会把它变成 `{ default: [...] }`，
 * 形态若有出入，**只改这一个函数**。
 */
export function normalizeCatalog(mod: unknown): GLTransition[] {
  if (Array.isArray(mod)) return mod as GLTransition[];
  const dflt = (mod as { default?: unknown } | null | undefined)?.default;
  if (Array.isArray(dflt)) return dflt as GLTransition[];
  return [];
}

function buildCatalog(): { entries: TransitionEntry[]; issues: CatalogIssue[] } {
  const raw = normalizeCatalog(catalogModule);
  const issues: CatalogIssue[] = [];
  const entries: TransitionEntry[] = [];
  const seen = new Set<string>();
  /** 认不出的参数类型：丢弃该 uniform 并记账（测试断言必须是空的）。 */
  const unsupportedTypes = new Set<string>();

  for (const t of raw) {
    if (!t || typeof t.name !== 'string' || !t.name) {
      issues.push({ id: String(t?.name ?? '<无名>'), reason: '缺少 name' });
      continue;
    }
    if (seen.has(t.name)) {
      issues.push({ id: t.name, reason: 'name 与前面的条目重复（只保留第一条）' });
      continue;
    }
    if (!PERMISSIVE_LICENSES.has(t.license)) {
      issues.push({ id: t.name, reason: `许可证「${t.license}」不在宽松白名单里` });
      continue;
    }
    if (typeof t.glsl !== 'string' || !/vec4\s+transition\s*\(/.test(t.glsl)) {
      issues.push({ id: t.name, reason: 'glsl 里没有 vec4 transition(vec2) 入口' });
      continue;
    }

    // 先扫 body 声明的 uniform：有些条目声明的参数上游根本没进 paramsTypes，
    // 那种条目在我们这个上下文里要么恒为 0、要么结构性给不出（sampler2D）。
    const paramsTypes = t.paramsTypes ?? {};
    const unbacked = scanDeclaredUniforms(t.glsl)
      .map((u) => whyUnsupported(u.name, u.glslType, paramsTypes))
      .filter((r): r is string => r !== null);
    if (unbacked.length > 0) {
      issues.push({ id: t.name, reason: unbacked.join('；') });
      continue;
    }

    const { params, uniforms, unsupported } = deriveTransitionParams(paramsTypes, t.defaultParams ?? {});
    for (const u of unsupported) unsupportedTypes.add(u.type);

    seen.add(t.name);
    entries.push({
      id: t.name,
      author: typeof t.author === 'string' ? t.author : '',
      license: t.license,
      params,
      uniforms,
      // uniform 名集合给 glsl.ts 用：它据此识别「依赖 uniform 的全局初始化」
      // 并改写成 #define（ES 1.00 合法 / ES 3.00 非法的写法，见 glsl.ts）。
      fragment: wrapTransitionFragment(
        t.glsl,
        new Set([...SPEC_UNIFORMS, ...Object.keys(paramsTypes)]),
      ),
    });
  }

  // 名字排序：选择器要可预测，不能依赖上游数组顺序（上游是自动生成的，会变）。
  entries.sort((a, b) => a.id.localeCompare(b.id));
  return { entries, issues };
}

const built = buildCatalog();

/**
 * 上游原始条目（含被剔除的），未经任何过滤。
 *
 * 导出的理由只有一个：单测要拿**原始 glsl** 做一致性检查（扫描
 * `uniform <type> <name>` 并断言它落在规范四件套 ∪ paramsTypes 里，
 * 挡住「参数漏进 UI → 运行时恒为 0」）。`TransitionEntry` 里已经没有原始
 * body 了，所以这条断言没有别的数据源。
 */
export const RAW_CATALOG: readonly GLTransition[] = normalizeCatalog(catalogModule);

/** 目录里所有可用的转场，按 id 排序。 */
export const TRANSITIONS: readonly TransitionEntry[] = built.entries;

/** 被剔除的条目及原因。空数组是期望状态；单测会断言它，`CREDITS.md` 记录它。 */
export const CATALOG_ISSUES: readonly CatalogIssue[] = built.issues;

/** 上游原始条目数（含被剔除的）。单测用它守「过滤器没有把整个集合吃掉」。 */
export const RAW_CATALOG_SIZE = RAW_CATALOG.length;

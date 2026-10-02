/**
 * i18n — 文案的唯一入口。全项目只有两个函数需要记：`tr()` 与 `setLocale()`。
 *
 * ## 为什么这个文件是 `.svelte.ts` 而不是普通 `.ts`
 *
 * locale 是一个 `$state`，而 `tr()` 每次调用都读它。于是**模板里任何一处
 * `tr()` 都自动建立依赖**，切换语言时整个界面跟着重渲，不需要在几十个组件里
 * 手动订阅。反过来的做法（普通模块 + 订阅回调）有一个很明确的失败形态：
 * 加了新文案却忘了订阅那处 → 界面静默停在旧语言，控制台一片安静 ——
 * 正是 AGENTS §7 记的那一类 bug。这里用 rune 做成**结构性免疫**。
 *
 * 代价是 `core/` 的模块会间接依赖 svelte 的响应式运行时。这**不违反**
 * 「core 无 DOM / 无 WebGL、必须可单测」—— svelte 的 `state()` 是纯 JS，
 * 在 node 里照样跑（`tests/unit/schema.test.ts` 就覆盖着这条路）。
 *
 * ## 为什么叫 `tr` 而不是 `t`
 *
 * `t` 在本项目里是**时间**（帧号）的专名 —— 硬约束 1.1 的原话就是
 * 「唯一时钟是 `t`」。拿 `t` 当翻译函数，等于在每个渲染函数里制造一次命名冲突。
 *
 * ## 用法
 *
 * ```ts
 * tr('tl.importAudio')                       // 取词
 * tr('proj.opened', { name, loaded })        // 带占位符，模板里写 {name}
 * ```
 * 占位符缺席时**原样保留** `{name}` 而不是变空 —— 见 `format.ts` 的注释。
 */
import { LOCALES, type LocaleId, type MessageKey } from './locales';
import { interpolate, type MessageVars } from './format';

export type { LocaleId, MessageKey, MessageVars };

const DEFAULT_LOCALE: LocaleId = 'zh-CN';
const STORAGE_KEY = 'artmatic.locale';

/**
 * 初始语言。存 localStorage 合规：语言偏好是纯 UI 状态，与工程内容无关，
 * 丢了也只是回到默认值（同 theme.svelte.ts 的判据）。
 * 全程 try/catch —— 隐私模式、以及 node 单测里没有 localStorage，都不该让应用起不来。
 */
function initialLocale(): LocaleId {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw && raw in LOCALES) return raw as LocaleId;
  } catch {
    /* 非浏览器环境 / 隐私模式 */
  }
  return DEFAULT_LOCALE;
}

let active = $state<LocaleId>(initialLocale());

/** 当前语言。 */
export function locale(): LocaleId {
  return active;
}

/** 切换语言。界面会跟着重渲，**不需要刷新页面**。 */
export function setLocale(id: LocaleId): void {
  active = id;
  try {
    localStorage.setItem(STORAGE_KEY, id);
  } catch {
    /* 存不下不影响本次会话 */
  }
}

/**
 * 取文案。
 *
 * 键不存在时返回 key 本身（而不是空串）：界面上出现 `tl.importAudio` 这种
 * 字面量，一眼就知道是键写错了或漏登记；返回空串则会变成「按钮是空白的」，
 * 反而更难归因。
 */
export function tr(key: MessageKey, vars?: MessageVars): string {
  const table = LOCALES[active] ?? LOCALES[DEFAULT_LOCALE];
  return interpolate(table[key] ?? key, vars);
}

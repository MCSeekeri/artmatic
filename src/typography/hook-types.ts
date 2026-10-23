/**
 * hook-types.ts — 插件文档钩子的**类型契约**（零依赖，只 import 类型）。
 *
 * 单独一个文件的原因：`plugins/manifest.ts` 是**纯校验层**（要能在 Node 里
 * 单测、不许拖 DOM / GL / 注册表进来），而 `hook-registry.ts` 要调
 * `coerceDocument`。把类型放在这里，两边都只依赖它。
 */

import type { Label } from '../i18n/label';
import type { TypographyDocument } from './document';

/** 钩子阶段：打开 / 保存 / 渲染。 */
export type TypoHookPhase = 'open' | 'render' | 'save';

export interface TypoHookContext {
  phase: TypoHookPhase;
  /** 渲染阶段才有：片段内本地秒 / 帧号 / fps / 片段时长。 */
  t?: number;
  frame?: number;
  fps?: number;
  duration?: number;
  /** 工程种子（确定性随机的来源）。 */
  seed?: number;
  /** 文本片段的 id（打开 / 保存阶段给，便于按片段区分）。 */
  clipId?: string;
}

/** 输入是**冻结的深拷贝**；返回整份文档（或 `undefined` = 不改）。 */
export type TypoHookRun = (doc: TypographyDocument, ctx: TypoHookContext) => unknown;

export interface TypoHookDef {
  id: string;
  name: Label;
  phase: TypoHookPhase;
  run: TypoHookRun;
}

export const TYPO_HOOK_PHASES: readonly TypoHookPhase[] = ['open', 'render', 'save'];

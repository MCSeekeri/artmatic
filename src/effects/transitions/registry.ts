/**
 * transitions/registry.ts — 转场目录的查询 API。
 *
 * 只做查表，不做派生（派生在 `catalog.ts`，那是模块加载时算一次的）。
 * 单独一层是为了让 UI 与 runner 都只依赖一个窄接口，而不是各自 import catalog。
 */

import { CATALOG_ISSUES, TRANSITIONS } from './catalog';
import { defaultTransitionValues as defaultsOf } from './params';
import type { TransitionEntry, TransitionParamDef } from './types';

const BY_ID = new Map<string, TransitionEntry>(TRANSITIONS.map((e) => [e.id, e]));

export function listTransitions(): readonly TransitionEntry[] {
  return TRANSITIONS;
}

export function getTransition(id: string): TransitionEntry | null {
  return BY_ID.get(id) ?? null;
}

export function transitionCount(): number {
  return TRANSITIONS.length;
}

/** 被目录剔除的条目（许可 / 形状 / 重名）。正常情况下是空的。 */
export function catalogIssues(): readonly { id: string; reason: string }[] {
  return CATALOG_ISSUES;
}

export function transitionParams(id: string): TransitionParamDef[] {
  return getTransition(id)?.params ?? [];
}

/** 新建转场时的初值（上游作者的默认参数）。未知 id → 空表。 */
export function defaultTransitionValues(id: string): Record<string, number> {
  const entry = getTransition(id);
  return entry ? defaultsOf(entry.params) : {};
}

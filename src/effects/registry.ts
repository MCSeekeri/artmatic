/**
 * registry.ts — 特效注册表：defs/<id>.ts 与 glsl/<id>.ts 按文件名自动配对。
 *
 * 「新增特效 = 两个文件」的纪律落地：少任何一半，启动直接报错
 * （一个文件是 UI 定义，一个文件是着色器实现——缺一就是半成品）。
 */

import type { ParamDef } from './types';
import { defaultValues } from './types';
import type { EffectShaderDef } from './shader-def';
import type { MessageKey } from '../i18n/locales';

export interface EffectEntry {
  id: string;
  /** 展示名。存文案键，由 UI 侧 `tr()` 解析（理由见 types.ts）。 */
  nameKey: MessageKey;
  params: ParamDef[];
  shader: EffectShaderDef;
}

interface DefModule {
  id: string;
  nameKey: MessageKey;
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

const ENTRIES = new Map<string, EffectEntry>();

for (const [path, def] of Object.entries(defModules)) {
  const key = basename(path);
  const glsl = glslModules[`./glsl/${key}.ts`];
  if (!glsl) throw new Error(`特效 ${key} 缺少 glsl/${key}.ts（两个文件纪律）`);
  if (def.id !== key) throw new Error(`特效文件名 ${key} 与 def.id ${def.id} 不一致`);
  ENTRIES.set(key, { id: def.id, nameKey: def.nameKey, params: def.params, shader: glsl.shader });
}
for (const path of Object.keys(glslModules)) {
  const key = basename(path);
  if (!defModules[`./defs/${key}.ts`]) throw new Error(`特效 ${key} 缺少 defs/${key}.ts（两个文件纪律）`);
}

export function getEffect(id: string): EffectEntry | null {
  return ENTRIES.get(id) ?? null;
}

export function listEffects(): { id: string; nameKey: MessageKey }[] {
  return [...ENTRIES.values()].map((e) => ({ id: e.id, nameKey: e.nameKey }));
}

export function defaultEffectValues(id: string): Record<string, number | string> {
  const e = ENTRIES.get(id);
  return e ? defaultValues(e.params) : {};
}

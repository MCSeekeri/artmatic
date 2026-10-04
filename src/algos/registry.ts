/**
 * registry.ts — 算法生成器注册表。
 *
 * 新增一个生成器 = 一个 def 文件 + 这里一行 import。
 * bake 型额外要在 bake.worker.ts 的 BAKERS 里登记（那里有注释提醒）。
 */

import { rule110Def } from './rule110';
import { gameOfLifeDef } from './game-of-life';
import { mandelbrotDef } from './mandelbrot';
import { bifurcationDef } from './bifurcation';
import { langtonsAntDef } from './langtons-ant';
import { lsystemDef } from './lsystem';
import { mengerDef } from './menger';
import { sceneDefs } from './scenes';
import { defaultValues } from '../effects/types';
import type { GeneratorDef } from './types';
import type { MessageKey } from '../i18n/locales';

const DEFS = new Map<string, GeneratorDef>(
  [
    rule110Def,
    gameOfLifeDef,
    mandelbrotDef,
    bifurcationDef,
    langtonsAntDef,
    lsystemDef,
    mengerDef,
    // 程序化场景家族（angel-echo scenes.js）—— 一个文件，七个 def
    ...sceneDefs,
  ].map((d) => [d.id, d]),
);

export function getGenerator(id: string): GeneratorDef | null {
  return DEFS.get(id) ?? null;
}

export function listGenerators(): { id: string; nameKey: MessageKey; kind: GeneratorDef['kind'] }[] {
  return [...DEFS.values()].map((d) => ({ id: d.id, nameKey: d.nameKey, kind: d.kind }));
}

export function defaultParams(id: string): Record<string, number | string> {
  const def = DEFS.get(id);
  return def ? defaultValues(def.params) : {};
}

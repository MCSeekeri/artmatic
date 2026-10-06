/**
 * bakers.ts — 「哪些生成器要在 Worker 里烘」这一张表的**唯一真源**。
 *
 * ## 为什么单独一个文件
 *
 * 这张表原来直接写在 `bake.worker.ts` 里，于是它有两个消费方却只有一个
 * 能被 import：Worker 自己（`self.onmessage` 一挂载就不能在 Node 里被引入），
 * 和「守卫测试」。结果是新增 bake 型生成器时**漏登记不会报错** ——
 * `BakeClient` 只在控制台打一行 `[bake] 未知生成器 xxx`，画面永远停在
 * 空帧。新增 `chaos-game` / `dla` 时正是这么踩的：批量导出缩略图，
 * 25 张成功、2 张是空的，而单测全绿。
 *
 * 抽到这里之后，`tests/unit/bake-registry.test.ts` 可以直接
 * 「注册表里的每个 bake 型生成器都在 BAKERS 里」—— 漏一行就是一条红的测试。
 *
 * ⚠️ 这里**没有**任何 `sim` 型。它们走主线程（固定步长 + 快照 + seek 重放），
 * 单步极便宜。别照上游 report 里「langtonsAnt 必须进 Worker」那句话往这里加
 * —— 那句针对的是「一次性烘 320k×96 步」的上游做法。
 */

import { rule110Def } from './rule110';
import { bifurcationDef } from './bifurcation';
import { lsystemDef } from './lsystem';
import { chaosGameDef } from './chaos-game';
import { dlaDef } from './dla';
import type { BakeFn, GeneratorDef } from './types';

const DEFS: GeneratorDef[] = [rule110Def, bifurcationDef, lsystemDef, chaosGameDef, dlaDef];

/** 生成器 id → 烘焙函数。 */
export const BAKERS: Readonly<Record<string, BakeFn>> = Object.freeze(
  Object.fromEntries(
    DEFS.flatMap((d) => (d.kind === 'bake' ? [[d.id, d.bake] as const] : [])),
  ),
);

/**
 * bake-registry.test.ts — 「注册表里的 bake 型生成器都被 Worker 认得」。
 *
 * ## 为什么需要这条
 *
 * `bake.worker.ts` 原来把 def 列表**硬编码在自己文件里**，而那个文件挂了
 * `self.onmessage`，在 Node 里 import 就炸 ⇒ 没有任何测试能读到那张表 ⇒
 * 新增 bake 生成器时漏登记**不会报错**。失败形态极其安静：`BakeClient`
 * 只在控制台打一行 `[bake] 未知生成器 xxx`，画面永远停在空帧。
 *
 * 实测代价：新增 `chaos-game` / `dla` 后跑批量导出缩略图，25 张成功、
 * 2 张是纯黑，而**整套单测全绿**。
 *
 * 表已经抽到 `algos/bakers.ts`（可以安全 import），所以这条守卫现在是可能的。
 */

import { describe, expect, it } from 'vitest';
import { BAKERS } from '../../src/algos/bakers';
import { listGenerators } from '../../src/algos/registry';

describe('烘焙登记表', () => {
  it('注册表里每个 bake 型生成器都在 BAKERS 里（漏登记 = 画面永远空帧且不报错）', () => {
    const missing = listGenerators()
      .filter((g) => g.kind === 'bake' && !BAKERS[g.id])
      .map((g) => g.id);
    expect(missing, '这些 bake 生成器没有登记进 bakers.ts').toEqual([]);
  });

  it('BAKERS 里没有孤儿（登记了已经不存在 / 改成 sim 的生成器）', () => {
    const byId = new Map(listGenerators().map((g) => [g.id, g.kind]));
    const orphans = Object.keys(BAKERS).filter((id) => byId.get(id) !== 'bake');
    expect(orphans, '这些 id 已经不再是 bake 型了').toEqual([]);
  });

  it('BAKERS 里没有 sim / realtime 混进来', () => {
    for (const id of Object.keys(BAKERS)) {
      expect(byIdKind(id), `${id} 不该在 Worker 里烘`).toBe('bake');
    }
  });
});

function byIdKind(id: string): string | undefined {
  return listGenerators().find((g) => g.id === id)?.kind;
}

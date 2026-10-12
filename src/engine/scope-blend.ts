/**
 * scope-blend.ts — 影响深度（作用域组）里「最底层那个 op 的混合模式怎么处理」。
 *
 * 纯数据变换，不碰 GL —— 所以能被单测直接钉住（判据见 `tests/unit/scope-blend.test.ts`）。
 *
 * 背景：作用域组是从**透明**起独立合成的（「只留下这几条轨道时的那幅画面」）。
 * 组内最底层那个 op 因此没有背景板：对着透明黑做 `add` / `multiply` / `screen`
 * 只会得到黑（alpha 却照常按本层覆盖度累积），贴回 acc 时就是一块不透明黑 ——
 * 实测「黑填充 + 线性加深(add)」的圆形在作用域里变成黑块，把下方画面盖住，
 * 而同样的片段不设影响深度时是对的。
 *
 * 处置：把最底层那个 source op 按 `normal` 收进组（拿到它的**原始内容**），
 * 它的混合模式留到「组贴回 acc」那一步、对着真正的背景板执行。
 */

import type { BlendMode } from '../core/schema';
import type { RenderOp } from './stack';

/** 作用域组里「贴在背景上的那一个 op」的混合模式（最底下的 source / transition）。 */
export function bottomScopeBlend(scope: readonly RenderOp[]): BlendMode {
  for (const op of scope) {
    if (op.type === 'source') return op.source.blend;
    if (op.type === 'transition') return op.blend;
  }
  return 'normal';
}

/**
 * 把作用域组里最底层那个 source op 的混合模式改成 `normal`。
 *
 * **只改最底层那一个**：更上面那些 op 在组内确实有东西可混（组内位于它下面的
 * 内容），它们的混合模式必须留在组内。转场不参与（它的混合在 drawTransition
 * 内部完成），所以遇到它只是跳过、继续找 source。
 */
export function neutralizeBottomBlend(scope: readonly RenderOp[]): RenderOp[] {
  let done = false;
  return scope.map((op) => {
    if (done || op.type !== 'source') return op;
    done = true;
    return { ...op, source: { ...op.source, blend: 'normal' satisfies BlendMode } };
  });
}

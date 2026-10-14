/**
 * feedback-detect.ts — 「这张画面是不是只能靠逐帧历史算出来」的**唯一判据**。
 *
 * ## 它回答的问题
 *
 * 预览是连续播放的：反馈类特效（`echo` / `kino-feedback` / `petri` …）在池子里
 * 攒着跨帧历史，观众看到的那一帧是「前面所有帧叠出来的」。而截屏 / 体积采样这类
 * **单帧取材**（`render/export-frame.ts`）在取材前会 `onSeek()` 清掉历史 ——
 * 于是同一时刻的这一帧与预览里那一帧**本来就该不一样**。
 *
 * 只有一条路能等价复现：在**同一个钉尺寸窗口内从第 0 帧顺序走到目标帧**，
 * 与导出循环（`exporters/export-runner.ts`）逐帧等价。这条查询就是那个分支的开关：
 * 栈里没有任何跨帧历史时，单帧与顺序渲染在数学上等价（而且廉价得多）。
 *
 * ## 判据只认注册表里的声明，不去猜特效名字
 *
 * 三类跨帧状态，全部来自 `EffectShaderDef`：
 *   - `shader.feedback`        → 主 pass 的 ping-pong 历史（`${instanceId}`）
 *   - `prePasses[].feedback`   → 某个 pre-pass 的私有历史（`${instanceId}:${i}`）
 *   - `prePasses[].delayedInput` → 该环读的是**上一帧的链输入**（`delayedInputFor`）
 *
 * 三者的存储都在 `Compositor` 里，被 `Renderer.onSeek()` 一并清掉（`clearFeedback`），
 * 所以三者都必须触发重放。**新增一类跨帧存储时，这里要一起改** —— 漏掉的症状是
 * 「预览里好好的，截图与预览对不上」，不报错。
 *
 * 反过来，有状态**算法**（生命游戏那类）不走这条：它们由 `AlgoRuntime` 管，
 * `onSeek()` 里的 `alignSims()` 会把句柄与帧号对齐，单帧取材本身就是对的
 * （AGENTS §1.3 的 `seek(f) ≡ 从 0 顺序 step f 次`）。
 */

import type { Project } from '../core/schema';
import { buildStack, walkOps } from '../engine/stack';
import { getEffect } from './registry';

/**
 * 时刻 `t` 的渲染栈里有没有任何跨帧历史。
 *
 * @param onlyTrackId 只渲染这条视觉轨时（与导出同参数），其它轨上的特效**不会跑**，
 *   所以它们的历史也就无所谓 —— 判定必须跟着这条参数走，否则「只导某轨」会因为
 *   一条不在范围里的反馈特效而白重放。
 */
export function stackNeedsReplay(project: Project, t: number, onlyTrackId?: string): boolean {
  const ops = buildStack(
    project,
    t,
    onlyTrackId !== undefined ? { onlyTrackId } : undefined,
  );
  let needs = false;
  walkOps(ops, (op) => {
    if (needs || op.type !== 'effect') return;
    for (const inst of op.clip.chain) {
      // 禁用的实例不跑，当然也没有历史。
      if (!inst.enabled) continue;
      const entry = getEffect(inst.defId);
      if (!entry) continue;
      const shader = entry.shader;
      if (shader.feedback) {
        needs = true;
        return;
      }
      for (const pp of shader.prePasses ?? []) {
        if (pp.feedback || pp.delayedInput) {
          needs = true;
          return;
        }
      }
    }
  });
  return needs;
}

/**
 * registry-revision.svelte.ts — 运行期注册表版本号的**响应式镜像**。
 *
 * 特效与算法两个注册表都是模块级单例，插件挂载/卸载时会增长各自的 `revision`。
 * 但 Svelte 的 `$derived` 追不到普通模块变量 —— 必须有一个 `$state` 才能建立
 * 依赖。这个文件就是那一个转换点。
 *
 * 用法（组件里）：
 * ```svelte
 * const items = $derived.by(() => {
 *   registryRevision();        // ← 只为了建立依赖，返回值不用
 *   return listEffects();
 * });
 * ```
 *
 * 为什么不放进 `appState`：注册表是 `effects/` 与 `algos/` 层的东西，
 * 而 `appState` 是 UI 状态。放这里，`lab/` 与将来的其它宿主也能直接用，
 * 不必先装配一个 appState。`appState` 仍然会镜像一份（供需要跨组件读的场景），
 * 但那不是唯一入口。
 *
 * 订阅在模块加载时建立一次、永不解绑：进程级单例本来就活到页面结束，
 * 解绑反而要处理「谁先谁后」的生命周期问题。
 */

import { effectRegistryRevision, onEffectRegistryChange } from '../effects/registry';
import { algoRegistryRevision, onAlgoRegistryChange } from '../algos/registry';

let effectsRev = $state(0);
let algosRev = $state(0);

onEffectRegistryChange(() => {
  effectsRev = effectRegistryRevision();
});
onAlgoRegistryChange(() => {
  algosRev = algoRegistryRevision();
});

/**
 * 当前版本号。**只用于建立响应式依赖** —— 不要拿它的数值做判断
 * （两个注册表的计数是独立的，加在一起没有除「变了没有」之外的含义）。
 */
export function registryRevision(): number {
  return effectsRev + algosRev;
}

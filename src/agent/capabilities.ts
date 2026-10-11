/**
 * capabilities.ts — 能力发现（方案 §3.2 的 `getCapabilities`）。
 *
 * **它是 agent 选择合法 id 的唯一依据**：工具面不接受「自由字符串当 defId」，
 * 网关侧也要按这份清单校验（方案 §4.4）。着色器是惰性编译的 —— 语法错误在你
 * 点到它之前不报 —— 所以「先看清单再挂特效」是 agent 唯一能提前发现自己选错
 * 的手段。
 */

import { BLEND_MODES } from '../core/schema';
import { effectRegistryRevision, listEffects } from '../effects/registry';
import { algoRegistryRevision, listGenerators } from '../algos/registry';
import { listTransitions } from '../effects/transitions/registry';
import type { Capabilities } from './types';

/** 允许的 fit / 曲线模式 / 源类型：与 `schema.ts` 的联合类型一一对应。 */
const FITS: Capabilities['fits'] = ['contain', 'cover', 'stretch'];
const CURVE_MODES: Capabilities['curveModes'] = ['keyframe', 'impulse', 'follower'];
const SOURCE_TYPES: Capabilities['sourceTypes'] = ['video', 'image', 'algo', 'text', 'solid'];

/**
 * 清单在**插件挂载之前**是常量（内置注册表在模块加载时建好，glob 是 eager 的），
 * 所以算一次就够 —— 但要跟着两个注册表的 `revision` 失效：插件挂载后 agent
 * 必须立刻能发现新的 id，否则它手里那份清单会把新特效/生成器当成非法 id 拒掉。
 *
 * 缓存的是**纯数据**，不是「运行期实例」—— 后者绝不能缓存。判断 `!==` 而不是
 * `>`：两个注册表的计数是独立的，任一个变了都得重算。
 */
let cached: Capabilities | null = null;
let cachedRevision = -1;

export function getCapabilities(): Capabilities {
  const revision = effectRegistryRevision() + algoRegistryRevision();
  if (!cached || cachedRevision !== revision) {
    cachedRevision = revision;
    cached = {
      generators: listGenerators().map((g) => ({ id: g.id, kind: g.kind })),
      effects: listEffects().map((e) => ({ id: e.id })),
      transitions: listTransitions().map((t) => ({ id: t.id })),
      blendModes: BLEND_MODES.map((b) => b.id),
      fits: FITS,
      curveModes: CURVE_MODES,
      sourceTypes: SOURCE_TYPES,
    };
  }
  return cached;
}

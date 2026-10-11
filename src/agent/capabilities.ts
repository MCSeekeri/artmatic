/**
 * capabilities.ts — 能力发现（方案 §3.2 的 `getCapabilities`）。
 *
 * **它是 agent 选择合法 id 的唯一依据**：工具面不接受「自由字符串当 defId」，
 * 网关侧也要按这份清单校验（方案 §4.4）。着色器是惰性编译的 —— 语法错误在你
 * 点到它之前不报 —— 所以「先看清单再挂特效」是 agent 唯一能提前发现自己选错
 * 的手段。
 */

import { BLEND_MODES } from '../core/schema';
import { listEffects } from '../effects/registry';
import { listGenerators } from '../algos/registry';
import { listTransitions } from '../effects/transitions/registry';
import type { Capabilities } from './types';

/** 允许的 fit / 曲线模式 / 源类型：与 `schema.ts` 的联合类型一一对应。 */
const FITS: Capabilities['fits'] = ['contain', 'cover', 'stretch'];
const CURVE_MODES: Capabilities['curveModes'] = ['keyframe', 'impulse', 'follower'];
const SOURCE_TYPES: Capabilities['sourceTypes'] = ['video', 'image', 'algo', 'text', 'solid'];

/**
 * 清单在一次会话里是不变的（注册表在模块加载时建好，glob 是 eager 的），
 * 所以算一次就够。**缓存的是纯数据**，不是「运行期实例」—— 后者绝不能缓存。
 */
let cached: Capabilities | null = null;

export function getCapabilities(): Capabilities {
  if (!cached) {
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

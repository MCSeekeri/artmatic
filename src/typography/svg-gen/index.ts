/**
 * svg-gen —— SVG 素材生成器的唯一入口。
 *
 * 只导出 UI / 测试需要的东西：注册表、按 id 生成、默认值、种子推进与类型。
 * 图元 IR（`prims.ts`）是**内部实现**，但单测要直接验它的序列化口径，所以
 * 也在这里 re-export —— 免得测试去 import 深层路径、把内部结构固化成公开 API。
 */

export type {
  ShapeGenState,
  SvgGenGroup,
  SvgGenParams,
  SvgGenResult,
  SvgGenSpec,
} from './types';
export { GEN_BOX, GEN_MAX_COMMANDS } from './types';

export {
  GEN_GROUPS,
  SVG_GENERATORS,
  buildFromSpec,
  buildGenerator,
  defaultsOf,
  generatorById,
  generatorsInGroup,
  mergeParams,
  nextSeed,
} from './registry';

export { serializePrims, polygonPoints, rectPoints, clipLineToBox, n, KAPPA } from './prims';
export type { Prim, Pt, SerializedPath } from './prims';

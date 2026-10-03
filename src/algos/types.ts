/**
 * types.ts — 算法生成器注册表协议（与特效共用 ParamDef 类型系统）。
 *
 * 三型生成器各自验证一条架构通路：
 *   bake    一次性烘焙（Worker 里跑）→ R8 纹理。例：Rule 110。
 *   sim     有状态模拟：固定步长 + 快照 + seek 重放（硬约束 1.3）。例：生命游戏。
 *   realtime 逐帧实时 shader，参数走关键帧。例：Mandelbrot。
 */

import type { ParamDef } from '../effects/types';
import type { MessageKey } from '../i18n/locales';
import type { AlgoSetUniforms } from './shader-lib';

export interface BakeResult {
  data: Uint8Array;
  w: number;
  h: number;
  /** 生长方向的总行数（reveal shader 的 front 以它归一）。 */
  frontMax: number;
}

export type BakeFn = (params: Record<string, number | string>, seed: number) => BakeResult;

/** 有状态模拟句柄：纯数据，不碰 GL（单测可以直接打）。 */
export interface SimHandle {
  readonly gridW: number;
  readonly gridH: number;
  readonly stepsPerSec: number;
  /** 第 simFrame 步的状态（0/255）。seek 必须满足：seek(f) ≡ 从 0 顺序 step f 次。 */
  seek(simFrame: number): void;
  current(): Uint8Array;
}

export type SimFactory = (params: Record<string, number | string>, seed: number) => SimHandle;

interface GeneratorBase {
  id: string;
  /** 展示名。存的是**文案键**而不是字符串——理由见 effects/types.ts 的注释。 */
  nameKey: MessageKey;
  params: ParamDef[];
}

export type GeneratorDef =
  | (GeneratorBase & { kind: 'bake'; bake: BakeFn })
  | (GeneratorBase & { kind: 'sim'; create: SimFactory })
  | (GeneratorBase & {
      kind: 'realtime';
      /** fragment **不含头** —— 由 `ALGO_HEAD` 拼在前面（见 shader-lib.ts）。 */
      fragment: string;
      /** 把求值后的参数派发到 `u_<key>`。缺了它参数永远拿不到值且不报错。 */
      setUniforms: AlgoSetUniforms;
    });

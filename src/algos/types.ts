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
  /** 生长方向的总量（reveal shader 的 front 以它归一）。口径随 `reveal` 变。 */
  frontMax: number;
}

export type BakeFn = (params: Record<string, number | string>, seed: number) => BakeResult;

/**
 * reveal pass 的揭示方式 —— 决定「生长」是沿哪个量推进的。
 *
 * 三种都由同一个 shape 表达（`cell * step(量, u_front)`），只是那个「量」不同：
 *
 * | 值 | 量 | frontMax 的口径 | 用在哪 |
 * |---|---|---|---|
 * | `'front-y'`（默认） | 输出空间的纵坐标 | 纹理行数 | Rule 110 那类「一代一行」的图 |
 * | `'front-x'` | 输出空间的横坐标 | 纹理列数 | 分岔图（横轴 r，逐列算出来） |
 * | `'value'` | 像素自身的值 | 255（R8 值域） | L-system 的离根距离场 —— 生长顺序**编在像素值里** |
 *
 * 三者共用 `cell` 乘子：值为 0 的像素（背景）在任何模式下都不会被点亮，
 * 所以 `'value'` 模式不必额外判「这里到底有没有东西」。
 */
export type BakeReveal = 'front-y' | 'front-x' | 'value';

/**
 * `BakeReveal` → reveal shader 的 `u_reveal` 取值。
 *
 * 放在这里而不是 `runtime.ts`：它是这个类型的一部分（协议），
 * 且 `types.ts` 不依赖 DOM/GL，单测可以直接断言「每个 bake 生成器的
 * `reveal` 都在表里」—— 拼错一个值会静默退回 `'front-y'`，没有任何报错。
 */
export const REVEAL_MODE: Record<BakeReveal, number> = {
  'front-y': 0,
  'front-x': 1,
  value: 2,
};

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
  | (GeneratorBase & { kind: 'bake'; bake: BakeFn; reveal?: BakeReveal })
  | (GeneratorBase & { kind: 'sim'; create: SimFactory })
  | (GeneratorBase & {
      kind: 'realtime';
      /** fragment **不含头** —— 由 `ALGO_HEAD` 拼在前面（见 shader-lib.ts）。 */
      fragment: string;
      /** 把求值后的参数派发到 `u_<key>`。缺了它参数永远拿不到值且不报错。 */
      setUniforms: AlgoSetUniforms;
    });

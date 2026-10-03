import type { ParamDef } from '../types';

export const id = 'petri';
export const nameKey = 'fx.petri';
export const params: ParamDef[] = [
  /*
   * reaction 默认 0.3（**上游是 0.5，这里下调过**）。
   *
   * `next = avg + avg·(g−b)·k` 对均匀态的 Jacobian 是 `I + v·k·A`，A 反对称
   * （特征值 0, ±i√3）→ `|λ| = √(1+3(v·k)²) > 1`：**任何扰动每步都在增长**，
   * 靠最后 clamp 到 [0,1] 才收住，于是变成翻搅而不是螺旋波。实测逐帧翻搅量
   * （0..255 上的平均绝对差）随 reaction 陡增：
   *   0.05 → 2.16、0.3 → 2.42、0.5 → 3.47、0.8 → 9.53、1.0 → 14.47
   * 0.5 已经在明显不稳的一侧，默认观感是「沸腾」而不是这个模拟本来要的螺旋。
   * 想要更凶的可以自己推上去 —— 旋钮的上半段本来就是失控区。
   */
  { key: 'reaction', labelKey: 'fx.petri.reaction', type: 'range', min: 0, max: 1, step: 0.01, defaultValue: 0.3 },
  { key: 'drift', labelKey: 'fx.petri.drift', type: 'range', min: 0, max: 1, step: 0.01, defaultValue: 0.72 },
  { key: 'scale', labelKey: 'fx.petri.scale', type: 'range', min: 0, max: 1, step: 0.01, defaultValue: 0.3 },
  { key: 'takeover', labelKey: 'fx.petri.takeover', type: 'range', min: 0, max: 1, step: 0.01, defaultValue: 0.45 },
];

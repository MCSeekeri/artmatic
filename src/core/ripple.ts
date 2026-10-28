/**
 * ripple.ts — 波纹删除（ripple delete）的纯几何。
 *
 * 只有一条规则：**删掉一段之后，同一轨道上起点在被删区间之后（含贴边）的
 * 片段整体前移「被删长度」**，把那段空白合上。
 *
 * 为什么按「同一条轨」而不是全工程：
 * 轨道在本项目里是**图层**，不同轨上的片段各自独立编排（音乐同步、叠画）。
 * 删一条轨上的一个片段就把别的轨一起挪，会静默毁掉卡点对齐 —— 那种偏差
 * 事后只能靠耳朵听出来。所以波纹只作用于**被删片段所在的那几条轨**
 * （视频 + 它分离出来的音频各算各的，两边都前移，同步仍然成立）。
 *
 * 已有空隙**不**被合上（只扣掉「被删掉的那几段」的长度），否则「删一个片段」
 * 会把用户故意留的呼吸空间也吃掉。
 *
 * 纯函数、无 DOM，可单测（`tests/unit/ripple.test.ts`）。
 */

/** 一个被删掉的区间（秒）。只用到起止，不关心是哪条轨。 */
export interface RemovedSpan {
  start: number;
  end: number;
}

/**
 * 波纹删除后一个片段的**前移量**（秒）。
 *
 * 判据是 `span.end <= start`：贴边（片段起点正好落在被删区间的末尾）也要前移，
 * 否则「删掉中间那一段」之后相邻两段之间会留下一个等长的空洞 —— 那正是
 * 波纹删除要消灭的东西。
 */
export function rippleShift(start: number, removals: readonly RemovedSpan[]): number {
  let shift = 0;
  for (const r of removals) {
    const len = r.end - r.start;
    if (!(len > 0)) continue;
    if (r.end <= start) shift += len;
  }
  return shift;
}

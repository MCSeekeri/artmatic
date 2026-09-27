/**
 * clock.ts — 确定性时钟。
 *
 * 硬约束 1.1：唯一时钟是 t（帧号 / fps）。任何渲染函数都不得接收
 * Date.now() / performance.now()——预览的 rAF 与导出的紧循环都只是
 * 「算出下一个 t 再调 renderFrame(project, t)」。
 *
 * 渲染函数签名里出现 Date / performance 是 code review 红线。
 */

import { hashSeed } from '../core/prng';

/** t → 帧号（四舍五入到最近的帧；t 本身来自 frame/fps 时精确还原）。 */
export function frameOf(t: number, fps: number): number {
  return Math.round(t * fps);
}

/** 帧号 → t。渲染入口只认这个换算。 */
export function timeOf(frame: number, fps: number): number {
  return frame / fps;
}

/**
 * 特效 / 生成器的帧级种子：由工程种子、实例 id、帧号共同派生。
 * 同一工程同一帧同一实例 → 永远同一个 seed，预览与导出是同一次随机。
 */
export function seedFor(projectSeed: number, instanceId: string, frame: number): number {
  return hashSeed(projectSeed, instanceId, frame);
}

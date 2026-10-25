/**
 * _anim-preset-check.ts — 动画预设的**共用守卫**（不是 spec，不会被收集）。
 *
 * 加一个预设有四处要动（id 清单 / 定义 + keyframes / 图标 / 文案），漏一处的
 * 表现全是**静默**的：卡片只有名字、点下去什么都不发生、动画在导出里消失。
 * 这份 helper 把它们变成一条带 id 的失败信息。
 *
 * 重点在**「预设 → 轨道」**这一段：预设最终是要被展开成结构化关键帧的
 * （`presetToTracks`），而解析器对写法有硬要求（见 `animation-presets/types.ts`
 * 的注释）。写成 `%` 位移、`steps()`、`-webkit-` 属性的预设**不会报错**，
 * 只会在面板里少一条轨道、在画面上少一段动作 —— 所以这里逐条断「没有丢弃」。
 */

import { expect } from 'vitest';
import {
  ANIM_PRESETS,
  createPresetAnimation,
  presetKeyframes,
  type AnimPreset,
} from '../../src/typography/animation';
import { parseKeyframeBody, presetToTracks } from '../../src/typography/animation-migrate';
import { animIconOf, animGroupOf } from '../../src/ui/typography/anim-catalog';
import { LOCALES } from '../../src/i18n/locales';

const LOCALE = LOCALES['zh-CN'] as Record<string, string>;

/** 逐条检查（按给定 id 列表），失败信息里一定带 id。 */
export function checkPresets(ids: readonly string[], group: string): void {
  const problems: string[] = [];

  for (const raw of ids) {
    const id = raw as AnimPreset;
    const def = ANIM_PRESETS.find((d) => d.id === id);
    if (!def) {
      problems.push(`${id}: 定义表里没有它（animation-presets/ 的 defs 漏了）`);
      continue;
    }
    if (!(def.duration > 0)) problems.push(`${id}: duration 必须 > 0`);

    // 1) keyframes 体必须存在且可解析
    const body = presetKeyframes(id, def.params ?? {});
    if (!body.trim()) {
      problems.push(`${id}: 没有 keyframes 体（定义与 keyframes 表错位）`);
      continue;
    }
    const frames = parseKeyframeBody(body);
    if (!frames || frames.length < 2) {
      problems.push(`${id}: keyframes 解析失败（检查选择器 / 分号 / 花括号）—— ${body}`);
      continue;
    }

    // 2) 必须能整条展开成轨道，且**一个声明都不许丢**
    const report = { dropAnimations: [] as string[], dropProps: [] as string[] };
    const tracks = presetToTracks(createPresetAnimation(id, `probe-${id}`), report);
    if (tracks.length === 0) problems.push(`${id}: 展开不出任何轨道`);
    if (report.dropAnimations.length || report.dropProps.length) {
      problems.push(
        `${id}: 展开时有丢弃（属性名/值过不了闸门，或 transform/filter 拆不动）` +
          ` → ${[...report.dropAnimations, ...report.dropProps].join(', ')}`,
      );
    }

    // 3) 每条轨道的关键帧数量 / 时间必须自洽
    const span = def.duration;
    for (const t of tracks) {
      if (t.keys.length < 2) problems.push(`${id}: 轨道 ${t.prop} 少于 2 帧`);
      let prev = -1;
      for (const k of t.keys) {
        if (!(k.t >= prev - 1e-9)) problems.push(`${id}: 轨道 ${t.prop} 的关键帧时间不是升序`);
        if (k.t < -1e-6 || k.t > span + 1e-6) {
          problems.push(`${id}: 轨道 ${t.prop} 的关键帧超出时长（${k.t} > ${span}）`);
        }
        prev = k.t;
      }
    }

    // 4) 展示信息：图标与文案
    if (animIconOf(id).length === 0) problems.push(`${id}: 没有图标（anim-icons/${group}.ts 漏了）`);
    if (animGroupOf(id) !== group) problems.push(`${id}: 分组不是 ${group}（anim-catalog 的 ANIM_PRESET_GROUP）`);
    if (!LOCALE[def.labelKey]) problems.push(`${id}: 缺文案 ${def.labelKey}（i18n/locales/zh-CN/media.ts）`);
  }

  expect(problems, `\n${problems.join('\n')}\n`).toEqual([]);
}

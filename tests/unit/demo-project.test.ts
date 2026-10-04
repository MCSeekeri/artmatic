import { describe, expect, it } from 'vitest';
import { createDemoProject, DEMO_DURATION } from '../../src/core/demo-project';
import { getGenerator } from '../../src/algos/registry';
import { getEffect } from '../../src/effects/registry';
import { getTransition } from '../../src/effects/transitions/registry';
import { resolveTransition } from '../../src/core/transitions';
import type { EffectClip, Project, SourceClip, VisualTrack } from '../../src/core/schema';

/**
 * 开箱 demo 的守卫 —— 守的全是**静默失效**那一类。
 *
 * demo 是每个新用户看到的第一个画面，也是所有 E2E 的默认舞台。它出错的方式
 * 从来不是抛异常，而是：
 *
 * | 写错什么 | 表现 | 谁会发现 |
 * |---|---|---|
 * | `generator` / `defId` 拼错 | 该片段整张黑（生成器查不到）或原样透传（特效查不到） | 没人，直到有人盯着看 |
 * | 特效参数曲线的键写错 | 曲线不生效，参数恒为基值 | 没人 —— 关键帧就那么安静地没了 |
 * | 源参数曲线的键写错 | 同上 | 同上 |
 * | 转场挂在不相邻 / 非 source 的剪切点上 | `resolveTransition` 返回 null，转场静默不做 | 没人 |
 * | `duration` 超过两侧可用量 | 被钳短，与工程里写的值对不上 | 只有点开检查器才看得到提示 |
 * | 同轨重叠 / 未按 start 排序 | 合成出来是错的，但谁也不知道「对的」长什么样 | 没人 |
 *
 * 所以这里逐条把它们变成明确的失败。**不写**的一条是「某个参数的具体数值好不好看」——
 * 那是眼睛的事，断言不了，也不该假装能断言。
 */

const P = createDemoProject();

function visualTracks(p: Project): VisualTrack[] {
  return p.tracks.filter((t): t is VisualTrack => t.kind === 'visual');
}

/** `SourceClip.curves` 里的保留字（其余键一律当作生成器参数）。 */
const RESERVED_SOURCE_CURVES = new Set([
  'opacity',
  'transform.x',
  'transform.y',
  'transform.sx',
  'transform.sy',
  'transform.rot',
]);

describe('开箱 demo：引用完整性', () => {
  it('每个算法源都指向真实存在的生成器', () => {
    const bad: string[] = [];
    for (const t of visualTracks(P)) {
      for (const c of t.clips) {
        if (c.kind !== 'source' || c.source.type !== 'algo') continue;
        if (!getGenerator(c.source.generator)) bad.push(`${c.label} → ${c.source.generator}`);
      }
    }
    expect(bad, '生成器 id 对不上 → 该片段整张黑，且不会有任何报错').toEqual([]);
  });

  it('每个特效实例都指向真实存在的特效', () => {
    const bad: string[] = [];
    for (const t of visualTracks(P)) {
      for (const c of t.clips) {
        if (c.kind !== 'effect') continue;
        for (const inst of (c as EffectClip).chain) {
          if (!getEffect(inst.defId)) bad.push(`${c.label} → ${inst.defId}`);
        }
      }
    }
    expect(bad, '未知 defId 会让特效原样透传（画面毫无变化），也不报错').toEqual([]);
  });

  it('转场都指向目录里的条目，且参数键真的存在', () => {
    const bad: string[] = [];
    for (const t of visualTracks(P)) {
      for (const c of t.clips) {
        if (c.kind !== 'source' || !c.transitionOut) continue;
        const entry = getTransition(c.transitionOut.defId);
        if (!entry) {
          bad.push(`${c.label} → 未知转场 ${c.transitionOut.defId}`);
          continue;
        }
        const keys = new Set(entry.params.map((p) => p.key));
        for (const k of Object.keys(c.transitionOut.values)) {
          if (!keys.has(k)) bad.push(`${c.transitionOut.defId} 没有参数 ${k}`);
        }
      }
    }
    expect(bad, '未知转场会被跳过；未知参数键会被静默忽略（恒为 0）').toEqual([]);
  });
});

describe('开箱 demo：关键帧真的会生效', () => {
  it('特效参数曲线的键 = 「真实实例 id」+「真实 range 参数」', () => {
    const bad: string[] = [];
    for (const t of visualTracks(P)) {
      for (const c of t.clips) {
        if (c.kind !== 'effect') continue;
        const byInstance = new Map((c as EffectClip).chain.map((i) => [i.instanceId, i]));
        for (const key of Object.keys(c.curves)) {
          const dot = key.lastIndexOf('.');
          const inst = byInstance.get(key.slice(0, dot));
          const paramKey = key.slice(dot + 1);
          if (!inst) {
            bad.push(`${key} → 实例不存在`);
            continue;
          }
          const p = getEffect(inst.defId)?.params.find((q) => q.key === paramKey);
          // 非 range 参数上的曲线在 `effects/runner.ts` 里根本不会求值 ——
          // 键对了但类型不对，同样是静默失效。
          if (!p || p.type !== 'range') bad.push(`${key} → ${inst.defId} 没有 range 参数 ${paramKey}`);
        }
      }
    }
    expect(bad, '键写错 = 关键帧安静地消失，参数一直停在基值').toEqual([]);
  });

  it('源参数曲线只落在保留字或真实的 range 参数上', () => {
    const bad: string[] = [];
    for (const t of visualTracks(P)) {
      for (const c of t.clips) {
        if (c.kind !== 'source') continue;
        const src = c as SourceClip;
        for (const key of Object.keys(src.curves)) {
          if (RESERVED_SOURCE_CURVES.has(key)) continue;
          if (src.source.type !== 'algo') {
            bad.push(`${key} → ${src.source.type} 源只能用保留字`);
            continue;
          }
          const p = getGenerator(src.source.generator)?.params.find((q) => q.key === key);
          if (!p || p.type !== 'range') bad.push(`${key} → ${src.source.generator} 没有 range 参数 ${key}`);
        }
      }
    }
    expect(bad).toEqual([]);
  });
});

describe('开箱 demo：片段几何', () => {
  it('转场都能落地，且不会被钳短', () => {
    let count = 0;
    for (const t of visualTracks(P)) {
      for (let i = 0; i < t.clips.length; i += 1) {
        const c = t.clips[i]!;
        if (c.kind !== 'source' || !c.transitionOut) continue;
        count += 1;
        const r = resolveTransition(t, i);
        expect(
          r,
          `${c.label} 的转场落不了地：下一片段必须是紧邻的 SourceClip，且两侧要够长`,
        ).not.toBeNull();
        // 生效值 = 存储值 ⇒ 这个转场是完整执行的，不是被挤短了半截。
        expect(r!.duration, `${c.label} 的转场被钳短了`).toBeCloseTo(c.transitionOut.duration, 9);
      }
    }
    expect(count, 'demo 必须展示转场').toBeGreaterThanOrEqual(3);
  });

  it('同轨不重叠，且按 start 升序', () => {
    const bad: string[] = [];
    for (const t of P.tracks) {
      const sorted = [...t.clips].sort((a, b) => a.start - b.start);
      if (sorted.map((c) => c.id).join() !== t.clips.map((c) => c.id).join()) {
        bad.push(`${t.name}: 片段没有按 start 排序`);
      }
      for (let i = 1; i < sorted.length; i += 1) {
        if (sorted[i]!.start < sorted[i - 1]!.end - 1e-9) {
          bad.push(`${t.name}: ${sorted[i - 1]!.label} 与 ${sorted[i]!.label} 重叠`);
        }
      }
    }
    expect(bad, '同轨重叠是数据模型不允许的（要叠请加轨道）').toEqual([]);
  });

  it('每一段都落在工程时长之内', () => {
    for (const t of P.tracks) {
      for (const c of t.clips) {
        expect(c.start, `${t.name} / ${c.label}`).toBeGreaterThanOrEqual(0);
        expect(c.end, `${t.name} / ${c.label}`).toBeLessThanOrEqual(DEMO_DURATION + 1e-9);
      }
    }
  });

  it('有且只有一轨音频，且铺满全片', () => {
    const audio = P.tracks.filter((t) => t.kind === 'audio');
    expect(audio).toHaveLength(1);
    const clips = audio[0]!.clips;
    expect(clips).toHaveLength(1);
    expect(clips[0]!.start).toBe(0);
    expect(clips[0]!.end).toBeCloseTo(DEMO_DURATION, 9);
  });
});

describe('开箱 demo：展示面覆盖', () => {
  it('三类生成器（bake / sim / realtime）各至少出现一次', () => {
    const kinds = new Set<string>();
    for (const t of visualTracks(P)) {
      for (const c of t.clips) {
        if (c.kind !== 'source' || c.source.type !== 'algo') continue;
        const def = getGenerator(c.source.generator);
        if (def) kinds.add(def.kind);
      }
    }
    expect(
      [...kinds].sort(),
      'demo 的意义就是把三条通路都走一遍；少一条，那条通路就没有开箱可见的兜底',
    ).toEqual(['bake', 'realtime', 'sim']);
  });

  it('排版 / 特效链 / 转场都真的有内容', () => {
    let textClips = 0;
    let algoClips = 0;
    let effectClips = 0;
    let fxInstances = 0;
    let transitions = 0;

    for (const t of visualTracks(P)) {
      for (const c of t.clips) {
        if (c.kind === 'source') {
          if (c.source.type === 'text') textClips += 1;
          if (c.source.type === 'algo') algoClips += 1;
          if (c.transitionOut) transitions += 1;
        } else {
          effectClips += 1;
          fxInstances += (c as EffectClip).chain.length;
        }
      }
    }

    expect(algoClips).toBeGreaterThanOrEqual(6);
    expect(textClips).toBeGreaterThanOrEqual(1);
    expect(effectClips).toBeGreaterThanOrEqual(2);
    expect(fxInstances).toBeGreaterThanOrEqual(6);
    expect(transitions).toBeGreaterThanOrEqual(3);
  });

  it('排版片段带一个非空文档（字 + 图形都算数）', () => {
    const text = visualTracks(P)
      .flatMap((t) => t.clips)
      .find((c): c is SourceClip => c.kind === 'source' && c.source.type === 'text');
    expect(text, 'demo 必须有排版片段').toBeDefined();
    const doc = (text!.source as { doc: { size: { w: number; h: number }; elements: unknown[] } }).doc;
    expect(doc.size.w).toBeGreaterThan(0);
    expect(doc.elements.length).toBeGreaterThanOrEqual(2);
  });
});

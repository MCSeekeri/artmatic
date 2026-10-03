import { describe, expect, test } from 'vitest';
import { getEffect, listEffects } from '../../src/effects/registry';
import { EFFECT_HEAD } from '../../src/effects/shader-def';
import type { EffectClip } from '../../src/core/schema';
import type { EffectUniformCtx } from '../../src/effects/shader-def';

/**
 * 特效接线自检：`setUniforms` 写出来的 uniform，**名字与类型**都要与 fragment 的声明对上。
 *
 * 起因是一次真实的静默失效（2026-10-03）：
 * `clockUniforms()` 用 `gl.uniform1i` 去写 `u_sync`，而 8 个 clock 特效的 fragment
 * 都声明成 `uniform float u_sync;`。对 float uniform 调 `uniform1i` 会触发 GL
 * `INVALID_OPERATION` 并且**不写入** —— uniform 保持 0，于是「按拍对齐」永远退回
 * `t * speed`，**没有任何报错**，看起来像功能没做。
 *
 * `compileAll`（lab.spec）只证明 shader **编得过**，这类「写 uniform 的类型不匹配」
 * 它看不见。这份测试用伪 gl 跑一遍 `setUniforms`，纯静态、不需要 GL 上下文。
 *
 * 它守的是**协议层**（`shader-def.ts` 那套 setter 助手），不是「某个特效好不好看」——
 * 新增一个 setter 助手、或改一个 fragment 的 uniform 声明，都会在这里被拦下。
 */

/** runner 自己负责写、`setUniforms` 不该碰的 uniform（见 effects/runner.ts）。 */
const HEAD_OWNED = new Set([
  'u_texture',
  'u_feedback',
  'u_original',
  'u_time',
  'u_delta',
  'u_seed',
  'u_resolution',
]);

/**
 * runner **能**绑定的 sampler。声明了别的就没人给它绑 —— 采样会读回未绑定纹理
 * （黑/垃圾），而 GL 自己不会说话。
 *
 * 特别是 `u_spectrum`（openmosh 的音频频谱通道）：Artmatic 还没做那条通道
 * （Phase 1f），现在移植任何声明它的特效都会静默变瞎。
 */
const BINDABLE_SAMPLERS = new Set(['u_texture', 'u_original', 'u_feedback']);

/** 写入函数 → 它允许写的 GLSL 类型。 */
const WRITER_TYPES: Record<string, string[]> = {
  uniform1f: ['float'],
  uniform1fv: ['float'],
  uniform1i: ['int', 'bool'],
  uniform2f: ['vec2'],
  uniform3f: ['vec3'],
  uniform3fv: ['vec3'],
  uniform4f: ['vec4'],
};

interface Probe {
  /** fragment 里声明的 uniform → GLSL 类型。 */
  declared: Map<string, string>;
  /** 实际被写过的 uniform → 写入函数名。 */
  written: Map<string, string>;
  /** 被 setUniforms 摸到、但 fragment 里根本没声明的名字（拼错就是这样）。 */
  undeclared: Set<string>;
  /** 这个特效的 fragment 有没有**用到** `u_feedback`（决定 runner 要不要绑它）。 */
  usesFeedback: boolean;
  /** 这个特效有没有声明 `feedback: true`。 */
  declaresFeedback: boolean;
}

function probeEffect(defId: string): Probe {
  const entry = getEffect(defId);
  if (!entry) throw new Error(`注册表里没有 ${defId}`);

  const declared = new Map<string, string>();
  // **必须按实际编译的源码来解析**（head + fragment）。只解析 fragment 的话，
  // `u_feedback` / `u_texture` / `u_delta` 这些 head 里的声明根本看不到，
  // 于是「声明了 u_feedback 就必须带 feedback: true」那条断言永远不会触发 ——
  // 一条结构上不可能失败的假防线（初版就是这么写的，改回 bug 跑一遍才发现）。
  const source = EFFECT_HEAD + entry.shader.fragment;
  for (const m of source.matchAll(
    /uniform\s+(float|int|bool|vec2|vec3|vec4|mat3|mat4|sampler2D)\s+(u_\w+)\s*;/g,
  )) {
    declared.set(m[2]!, m[1]!);
  }

  const written = new Map<string, string>();
  const undeclared = new Set<string>();
  const byLoc = new Map<object, string>();

  // 未声明的名字返回 null —— 与真实 `Program.u()` 的行为一致（静默跳过），
  // 但这里**记一笔**，于是拼错的 uniform 名会被断言抓到。
  //
  // head 自己提供的名字（HEAD_OWNED）除外：setter 那侧会**防御性地**读它们
  // （比如 `clockUniforms` 会读 `u_delta`，而并非每个 clock fragment 都声明它），
  // 那是合法用法，不是拼错。
  const locs = new Proxy({} as Record<string, WebGLUniformLocation | null>, {
    get(_t, prop) {
      if (typeof prop !== 'string') return undefined;
      if (!declared.has(prop)) {
        if (!HEAD_OWNED.has(prop)) undeclared.add(prop);
        return null;
      }
      const loc = { name: prop };
      byLoc.set(loc, prop);
      return loc as unknown as WebGLUniformLocation;
    },
  });

  const record = (via: string) => (loc: object) => {
    const name = byLoc.get(loc);
    if (name) written.set(name, via);
  };

  const gl = new Proxy(
    {},
    {
      get(_t, prop) {
        if (typeof prop !== 'string' || !(prop in WRITER_TYPES)) return undefined;
        return record(prop);
      },
    },
  ) as unknown as WebGL2RenderingContext;

  const values: Record<string, number | string> = {};
  for (const p of entry.params) values[p.key] = p.defaultValue;

  const ctx = {
    t: 1,
    frame: 30,
    seed: 0.5,
    w: 960,
    h: 540,
    fps: 30,
    grid: { bpm: 120, offset: 0, beatsPerBar: 4 },
    clip: {} as EffectClip,
  } satisfies EffectUniformCtx;

  entry.shader.setUniforms(gl, locs, values, ctx);
  return {
    declared,
    written,
    undeclared,
    declaresFeedback: entry.shader.feedback === true,
    usesFeedback: /\bu_feedback\b/.test(entry.shader.fragment),
  };
}

const EFFECTS = listEffects().map((e) => e.id);

describe('特效接线自检', () => {
  test('注册表非空（自检本身要有覆盖面）', () => {
    expect(EFFECTS.length).toBeGreaterThan(20);
  });

  test.each(EFFECTS)('%s：fragment 里的每个 uniform 都被 setUniforms 写到', (id) => {
    const { declared, written } = probeEffect(id);
    const missed = [...declared.keys()].filter((n) => !HEAD_OWNED.has(n) && !written.has(n));
    expect(missed, `${id} 声明了却没写 → 这些 uniform 恒为默认值且不报错`).toEqual([]);
  });

  test.each(EFFECTS)('%s：写 uniform 的类型与声明一致', (id) => {
    const { declared, written } = probeEffect(id);
    const bad: string[] = [];
    for (const [name, via] of written) {
      const glsl = declared.get(name);
      if (!glsl) continue;
      if (!WRITER_TYPES[via]!.includes(glsl)) bad.push(`${name}: 声明 ${glsl}，却用 ${via} 写`);
    }
    expect(bad, `${id} 的写入类型与声明不匹配 → GL INVALID_OPERATION 且静默不写`).toEqual([]);
  });

  test.each(EFFECTS)('%s：没有摸到未声明的 uniform', (id) => {
    const { undeclared } = probeEffect(id);
    expect([...undeclared], `${id} 摸了不存在的 uniform → 名字拼错了`).toEqual([]);
  });

  // openmosh 是「fragment 里用了 u_feedback 就自动分配历史」，Artmatic 要**显式**
  // `feedback: true`。漏写的表现是：sampler 没人绑，`texture(u_feedback, ...)`
  // 读回未绑定纹理 —— 画面看着像「没有拖尾」，不报错。
  //
  // 判据必须是「fragment **用到**了 u_feedback」而不是「声明了」：head 无条件声明
  // 它，按声明判定会变成一条永远为真的假断言（初版就是这么错的）。
  test.each(EFFECTS)('%s：用到 u_feedback 就必须带 feedback: true', (id) => {
    const { usesFeedback, declaresFeedback } = probeEffect(id);
    if (!usesFeedback) return;
    expect(declaresFeedback, `${id} 用了 u_feedback 但没写 feedback: true → sampler 不会绑定`).toBe(
      true,
    );
  });

  test.each(EFFECTS)('%s：声明的 sampler 都是 runner 能绑的', (id) => {
    const { declared } = probeEffect(id);
    const samplers = [...declared.entries()]
      .filter(([, t]) => t === 'sampler2D')
      .map(([n]) => n)
      .filter((n) => !BINDABLE_SAMPLERS.has(n));
    expect(samplers, `${id} 声明了 runner 绑不了的 sampler → 采样会读回未绑定纹理`).toEqual([]);
  });
});

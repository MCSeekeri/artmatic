import { describe, expect, test } from 'vitest';
import { getEffect, listEffects } from '../../src/effects/registry';
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
}

function probeEffect(defId: string): Probe {
  const entry = getEffect(defId);
  if (!entry) throw new Error(`注册表里没有 ${defId}`);

  const declared = new Map<string, string>();
  for (const m of entry.shader.fragment.matchAll(
    /uniform\s+(float|int|bool|vec2|vec3|vec4|mat3|mat4|sampler2D)\s+(u_\w+)\s*;/g,
  )) {
    declared.set(m[2]!, m[1]!);
  }

  const written = new Map<string, string>();
  const undeclared = new Set<string>();
  const byLoc = new Map<object, string>();

  // 未声明的名字返回 null —— 与真实 `Program.u()` 的行为一致（静默跳过），
  // 但这里**记一笔**，于是拼错的 uniform 名会被断言抓到。
  const locs = new Proxy({} as Record<string, WebGLUniformLocation | null>, {
    get(_t, prop) {
      if (typeof prop !== 'string') return undefined;
      if (!declared.has(prop)) {
        undeclared.add(prop);
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
  return { declared, written, undeclared };
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
});

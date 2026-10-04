/**
 * _uniform-probe.ts — 「setUniforms 接线自检」的**共享骨架**。
 *
 * 两份守卫（`effect-uniforms.test.ts` / `algo-uniforms.test.ts`）共用它：
 * 一个伪 GL 上下文，能在**不需要真实 WebGL** 的情况下跑一遍 `setUniforms`，
 * 记下「哪些 uniform 被写过、用什么函数写的、有没有摸到不存在的名字」。
 *
 * 用途是抓一类**静默失效**：对 `uniform float` 调 `uniform1i` 会触发 GL
 * `INVALID_OPERATION` 并且**不写入**，uniform 保持默认值 —— 没有报错，
 * 看起来像「功能没做」。`compileAll` 只证明 shader 编得过，看不见这一类。
 *
 * 抽在这里而不是各写一份：两份守卫的判据不同（特效有 pre-pass / feedback，
 * 生成器有 head 与 kind），但「伪 gl + 解析 uniform 声明」是同一段机械。
 */

/** 写入函数 → 它允许写的 GLSL 类型。 */
export const WRITER_TYPES: Record<string, string[]> = {
  uniform1f: ['float'],
  uniform1fv: ['float'],
  uniform1i: ['int', 'bool'],
  uniform2f: ['vec2'],
  uniform3f: ['vec3'],
  uniform3fv: ['vec3'],
  uniform4f: ['vec4'],
};

/** 解析 `uniform <type> u_<name>;`（一行一个）。 */
export function parseUniforms(src: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const m of src.matchAll(
    /uniform\s+(float|int|bool|vec2|vec3|vec4|mat3|mat4|sampler2D)\s+(u_\w+)\s*;/g,
  )) {
    out.set(m[2]!, m[1]!);
  }
  return out;
}

export interface StubGl {
  gl: WebGL2RenderingContext;
  locs: Record<string, WebGLUniformLocation | null>;
  /** uniform 名 → 实际写它的 GL 函数名。 */
  written: Map<string, string>;
  /** 被 setUniforms 摸到、但既没声明也不是 head 提供的名字（拼错就是这样）。 */
  undeclared: Set<string>;
}

/**
 * 造一个伪 GL 上下文。
 *
 * @param declared 所有「声明过的」uniform（head + fragment）。未声明的返回 null
 *   —— 与真实 `Program.u()` 一致（静默跳过），但这里**记一笔**，于是拼错的
 *   uniform 名会被断言抓到。
 * @param headOwned head 自己提供、由运行期负责写的名字。读它们不算拼错。
 */
export function makeStubGl(declared: Map<string, string>, headOwned: Set<string>): StubGl {
  const written = new Map<string, string>();
  const undeclared = new Set<string>();
  const byLoc = new Map<object, string>();

  const locs = new Proxy({} as Record<string, WebGLUniformLocation | null>, {
    get(_t, prop) {
      if (typeof prop !== 'string') return undefined;
      if (!declared.has(prop)) {
        if (!headOwned.has(prop)) undeclared.add(prop);
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

  return { gl, locs, written, undeclared };
}

/**
 * 判据：写入函数与声明类型是否对得上。
 *
 * `typeOf` 是「fragment 自己声明的」类型表 —— head 提供的名字不在里面
 * （由运行期写，类型由 head 保证），所以查不到就跳过。
 */
export function typeMismatches(
  written: Map<string, string>,
  typeOf: Map<string, string>,
): string[] {
  const bad: string[] = [];
  for (const [name, via] of written) {
    const glsl = typeOf.get(name);
    if (!glsl) continue;
    if (!WRITER_TYPES[via]!.includes(glsl)) bad.push(`${name}: 声明 ${glsl}，却用 ${via} 写`);
  }
  return bad;
}

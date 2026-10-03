/**
 * transitions/glsl.ts — 把 gl-transitions 的 GLSL body 包成能直接编译的 fragment。
 *
 * ## GL Transition Spec v1 的约定（逐条实现）
 *
 * body 只实现 `vec4 transition(vec2 uv)`，上下文由「实现方」提供：
 *   - `progress`（float，0→1）
 *   - `ratio`（**float** = width / height。不是 vec2 —— 规范写得很明确）
 *   - `getFromColor(vec2)` / `getToColor(vec2)`：取色**必须**走它们，
 *     不允许直接 `texture2D(from, uv)`
 *   - 参数：`uniform <type> <name>` 自己声明，默认值在上游的 `defaultParams` 里
 *
 * 所以这里的 head 刻意**沿用规范的四个名字**（`from` / `to` / `progress` /
 * `ratio`），第三方 GLSL 才能零改动接进来。如果改叫 `u_from` 之类，125 条
 * 得逐条改 —— 那是把维护成本一次性堆在自己身上。
 *
 * ## 为什么需要 `normalizeGlsl`
 *
 * 这个集合里混着按 GLSL ES 1.00 写的条目（实测：`texture2D` 出现在
 * GlitchDisplace / displacement / luma 三条，`gl_FragColor` 出现在 GlitchDisplace）。
 * 我们跑在 WebGL2 / GLSL ES 3.00 上，这两个符号都不存在。
 *
 * 改写**只做这两条**，且有单测用固定 fixture 钉死。之所以选「文本改写」而不是
 * 逐条手工修：125 条里随时会有新的旧写法混进来，手工修是一次性的、会腐化；
 * 改写是声明的、被测试守住的。改写在注释里发生也无害（那几处本来就只出现在
 * 注释中），所以不需要先做注释剥离。
 *
 * 编译期真正兜底的是 `effects/compile-all.ts::compileAllTransitions`：
 * 改不动的（例如把 `ratio` 当 vec2 用 `ratio.x` 的）会编译失败并进台账。
 */

/**
 * 所有转场 fragment 共享的头部。
 *
 * `precision highp float;` 与 body 里可能出现的
 * `#ifdef GL_ES precision highp float; #endif` 重复声明是合法的（GLSL ES 允许
 * 在同一作用域重复声明精度），不需要去重。
 */
export const TRANSITION_HEAD = `#version 300 es
precision highp float;
uniform sampler2D from;
uniform sampler2D to;
uniform float progress;
uniform float ratio;
in vec2 vUv;
out vec4 outColor;
vec4 getFromColor(vec2 uv) { return texture(from, uv); }
vec4 getToColor(vec2 uv) { return texture(to, uv); }
`;

/** GLSL ES 1.00 → 3.00 的最小改写表。新增条目必须同时加 fixture 测试。 */
const REWRITES: { pattern: RegExp; to: string; why: string }[] = [
  { pattern: /\btexture2D\s*\(/g, to: 'texture(', why: 'ES 3.00 的取色函数叫 texture' },
  { pattern: /\bgl_FragColor\b/g, to: 'outColor', why: 'ES 3.00 没有内建 gl_FragColor' },
];

/** 把第三方 body 规范化到 GLSL ES 3.00。 */
export function normalizeGlsl(body: string): string {
  let out = body;
  for (const r of REWRITES) out = out.replace(r.pattern, r.to);
  return out;
}

/** 改写表本身（单测与文档共用一份真源，避免测试和实现各写一遍正则）。 */
export function glslRewriteTable(): readonly { pattern: RegExp; to: string; why: string }[] {
  return REWRITES;
}

/** 去掉注释。**必须先做这一步再扫 uniform**：`gl_FragColor` / `texture2D` 就出现在注释里。 */
export function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');
}

export interface DeclaredUniform {
  name: string;
  glslType: string;
}

/**
 * 扫出 body 自己声明的 uniform。
 *
 * 为什么需要它：`paramsTypes` 是上游**生成**的，会漏。实测 `burn` 的
 * `uniform vec3 color /* = vec3(0.9, 0.4, 0.2) *\/;` —— 规范明确支持
 * `/* = value *\/` 这种写法（v1 文档里列了三种变体），但上游的生成器只认
 * `// = value`，于是这条转场的 `paramsTypes` 是空的。
 *
 * 我们**不**去猜它的默认值（那会变成替上游编数据）：扫出来的结论只有一个用途 ——
 * 判断这条转场能不能在「只有 from / to / progress / ratio」的上下文里成立。
 * 声明了额外 `sampler2D` 的条目结构上就不可能（我们给不出那张贴图），
 * 声明了 `paramsTypes` 里没有的标量 uniform 的条目拿不到可信默认值。
 * 两种都拒绝进入目录，理由记进 `CATALOG_ISSUES`。
 */
export function scanDeclaredUniforms(body: string): DeclaredUniform[] {
  const out: DeclaredUniform[] = [];
  for (const m of stripComments(body).matchAll(/\buniform\s+(\w+)\s+([^;]+);/g)) {
    const type = m[1]!;
    for (const decl of m[2]!.split(',')) {
      const name = decl.trim().split(/\s+/)[0];
      if (name) out.push({ name, glslType: type });
    }
  }
  return out;
}

/** head + 规范化后的 body + main。结果可直接交给 `kit.quad()`。 */
export function wrapTransitionFragment(body: string, uniformNames: ReadonlySet<string>): string {
  const { source } = rewriteNonConstGlobals(normalizeGlsl(body), uniformNames);
  return `${TRANSITION_HEAD}${source}
void main() { outColor = transition(vUv); }
`;
}

/* ------------------------------------------------ 非 const 全局初始化 */

const TYPE_NAMES = new Set([
  'float', 'int', 'uint', 'bool',
  'vec2', 'vec3', 'vec4', 'ivec2', 'ivec3', 'ivec4', 'uvec2', 'uvec3', 'uvec4',
  'mat2', 'mat3', 'mat4',
]);

export interface GlobalRewrite {
  /** 被替换掉的全局变量名。 */
  name: string;
  /** 它原来的初始化表达式。 */
  expr: string;
}

/**
 * 把「依赖 uniform 的顶层变量初始化」改写成 `#define`。
 *
 * ## 为什么必须做
 *
 * GLSL ES 1.00 允许全局变量的初始化式**不是**常量表达式，GLSL ES 3.00 不允许
 * （`global variable initializers must be constant expressions`）。上游有 10 条
 * 用了这个写法（都是「把 uniform 预处理一次」的常见惯用法）：
 *
 * ```glsl
 * float nQuick = clamp(zoom_quickness, 0.2, 1.0);   // SimpleZoom / SimpleZoomOut / ZoomLeftWipe / …
 * vec2 ratio2   = vec2(1.0, 1.0 / ratio);           // CircleCrop / ZoomInCircles
 * float s       = pow(2.0 * abs(progress - 0.5), 3.0); // CircleCrop / Rectangle
 * float d       = min(progress, 1.0 - progress);    // pixelize
 * vec2 center   = vec2(1.0, direction);             // luminance_melt
 * float dist    = scale / 10.;                      // powerKaleido
 * ```
 *
 * ## 为什么 `#define` 是安全的
 *
 * 这类变量是**只读的派生量**（作者就是这么写的：全局、初始化一次、之后只读）。
 * 宏展开把它们还原成「每次用到就地求值」——对依赖 uniform 的表达式来说语义相同
 * （一帧之内 uniform 不变）。反过来，如果某个变量在 body 里被**赋值**，
 * 宏展开会编译不过 —— 那不是静默错误，`compileAllTransitions` 会当场报出来。
 *
 * ## 判据刻意收窄
 *
 * 只改「初始化式引用了 uniform（规范四件套 ∪ 该转场的参数）」的全局变量。
 * 真正常量初始化的全局变量（`const float PI = 3.14;`、`float k = 4.0;`）一律不动 ——
 * 少动一点，就少一类要解释的行为。
 *
 * 行号会保持：替换文本里的换行会补回去（宏必须是单行，所以表达式内部的换行
 * 折成空格，再在末尾补齐原换行数）。编译报错的行号因此仍然对得上上游源码。
 */
export function rewriteNonConstGlobals(
  body: string,
  uniformNames: ReadonlySet<string>,
): { source: string; rewrites: GlobalRewrite[] } {
  const rewrites: GlobalRewrite[] = [];
  let out = '';
  let i = 0;
  let braces = 0;
  let parens = 0;
  /*
   * 当前位置能不能起一条语句。**不能靠回头扫 out 推断**（第一版就是这么写的）：
   * 改写后 out 末尾是 `#define x (…)` 的右括号，回头扫会得到「不是语句边界」，
   * 于是紧随其后的第二条全局变量就漏改了（`float s = pow(…)` 就是这么漏掉的）。
   */
  let atStart = true;

  while (i < body.length) {
    const ch = body[i]!;

    // 注释原样跳过（不是语句边界，也不参与 uniform 检测）
    if (ch === '/' && body[i + 1] === '/') {
      const nl = body.indexOf('\n', i);
      const end = nl < 0 ? body.length : nl;
      out += body.slice(i, end);
      i = end;
      continue;
    }
    if (ch === '/' && body[i + 1] === '*') {
      const close = body.indexOf('*/', i + 2);
      const end = close < 0 ? body.length : close + 2;
      out += body.slice(i, end);
      i = end;
      continue;
    }

    if (ch === '{') braces += 1;
    if (ch === '}') braces -= 1;
    if (ch === '(') parens += 1;
    if (ch === ')') parens -= 1;

    if (braces === 0 && parens === 0 && atStart) {
      const decl = /^([A-Za-z_]\w*)\s+([A-Za-z_]\w*)\s*=\s*/.exec(body.slice(i));
      if (decl && TYPE_NAMES.has(decl[1]!)) {
        const initStart = i + decl[0].length;
        const end = statementEnd(body, i);
        if (end > initStart) {
          const expr = body.slice(initStart, end);
          if (referencesAny(stripComments(expr), uniformNames)) {
            const flat = expr.replace(/\s*\n\s*/g, ' ').trim();
            // 保持总行数：宏必须单行，换行补在它后面。
            out += `#define ${decl[2]} (${flat})` + '\n'.repeat(countNewlines(body.slice(i, end + 1)));
            rewrites.push({ name: decl[2]!, expr: flat });
            i = end + 1;
            atStart = true;
            continue;
          }
        }
      }
    }

    out += ch;
    if (ch === ';' || ch === '}' || ch === '{') atStart = true;
    else if (ch !== ' ' && ch !== '\t' && ch !== '\n' && ch !== '\r') atStart = false;
    i += 1;
  }

  return { source: out, rewrites };
}

/** 从 `from` 起找到本语句的 `;`（跳过注释、括号内的分号）。返回其下标，找不到返回 -1。 */
function statementEnd(body: string, from: number): number {
  let parens = 0;
  for (let i = from; i < body.length; i += 1) {
    const c = body[i]!;
    if (c === '/' && body[i + 1] === '/') {
      const nl = body.indexOf('\n', i);
      if (nl < 0) return -1;
      i = nl;
      continue;
    }
    if (c === '/' && body[i + 1] === '*') {
      const close = body.indexOf('*/', i + 2);
      if (close < 0) return -1;
      i = close + 1;
      continue;
    }
    if (c === '(' || c === '[') parens += 1;
    if (c === ')' || c === ']') parens -= 1;
    if (c === ';' && parens === 0) return i;
  }
  return -1;
}

function referencesAny(src: string, names: ReadonlySet<string>): boolean {
  for (const name of names) {
    if (new RegExp(`\\b${name}\\b`).test(src)) return true;
  }
  return false;
}

function countNewlines(s: string): number {
  let n = 0;
  for (const c of s) if (c === '\n') n += 1;
  return n;
}

/**
 * 内置兜底：一条最朴素的 dissolve（不来自上游，是我们自己写的四行）。
 *
 * 用途：某条第三方着色器在这台机器上编译失败时，`runner.ts` 用它顶上。
 * 理由是不让**整帧渲染**因为一条着色器而死掉 —— `Renderer.renderFrame` 里
 * 抛错的表现是整个预览停住，比「这条转场显示成了 dissolve」严重得多。
 * 失败不会被吞掉：进 `transitionCompileFailures()` 台账，并在控制台报一次。
 */
export const BUILTIN_DISSOLVE_BODY = `vec4 transition(vec2 uv) {
  return mix(getFromColor(uv), getToColor(uv), progress);
}`;

import { describe, expect, it, vi } from 'vitest';
import {
  CATALOG_ISSUES,
  PERMISSIVE_LICENSES,
  RAW_CATALOG,
  RAW_CATALOG_SIZE,
  TRANSITIONS,
  normalizeCatalog,
} from '../../src/effects/transitions/catalog';
import {
  TRANSITION_HEAD,
  normalizeGlsl,
  rewriteNonConstGlobals,
  scanDeclaredUniforms,
  stripComments,
  wrapTransitionFragment,
} from '../../src/effects/transitions/glsl';
import {
  deriveTransitionParams,
  fillTransitionValues,
  scalarRange,
  writeTransitionUniforms,
} from '../../src/effects/transitions/params';
import { defaultTransitionValues, getTransition, listTransitions } from '../../src/effects/transitions/registry';

/**
 * 转场目录的守卫测试。
 *
 * 这里守的是**准入**而不是渲染：转场是第三方代码，125 条不可能逐条读。
 * 所以用一组机械检查把「不该进来的东西」挡在目录之外：
 *   1. 许可白名单（AGENTS §1.8：不在禁止清单 ≠ 查过）
 *   2. 名字唯一（`defId` 是工程里存的值，重名 = 存的转场会飘）
 *   3. 入口形状（`vec4 transition(vec2)`）
 *   4. **uniform 覆盖一致性** —— 这一条最重要：body 里声明了但 `paramsTypes`
 *      里没有的 uniform，运行时会恒为 0，而 0 往往是退化取值。
 * 渲染层能不能编译出来，由 `compileAllTransitions`（E2E）负责，不在这里。
 */

/** 规范保证的四个上下文 uniform —— body 允许引用它们而不自己声明。 */
const SPEC_UNIFORMS = new Set(['from', 'to', 'progress', 'ratio']);

describe('catalog：准入过滤', () => {
  it('CJS interop 归一：数组 / { default: [] } / 垃圾输入都能兜住', () => {
    const arr = [{ name: 'a' }];
    expect(normalizeCatalog(arr)).toBe(arr);
    expect(normalizeCatalog({ default: arr })).toBe(arr);
    expect(normalizeCatalog(null)).toEqual([]);
    expect(normalizeCatalog(undefined)).toEqual([]);
    expect(normalizeCatalog({})).toEqual([]);
  });

  it('上游集合被完整读进来（守「过滤器没有把整个集合吃掉」）', () => {
    expect(RAW_CATALOG_SIZE).toBeGreaterThan(100);
    expect(TRANSITIONS.length).toBe(RAW_CATALOG_SIZE - CATALOG_ISSUES.length);
  });

  it('被拒的条目是一份**已知且已记录**的清单（上游加了新的会在这里现形）', () => {
    /*
     * 这三条不是黑名单，是数据驱动的判据（`whyUnsupported`）算出来的结果：
     * 它们的 body 声明了 from/to/progress/ratio 之外的 uniform。
     * 全部是「结构性给不出」，不是我们懒得适配。
     * 上游补了 metadata（`burn`）之后这条断言会失败 —— 那时把它从清单里删掉即可。
     */
    expect(
      CATALOG_ISSUES.map((i) => i.id).sort(),
      '拒收清单变了：确认新条目确实无法在只有 from/to 的上下文里工作，再更新这里与 CREDITS.md',
    ).toEqual(['burn', 'displacement', 'luma']);
    for (const issue of CATALOG_ISSUES) {
      expect(issue.reason).toMatch(/sampler2D|paramsTypes/);
    }
  });

  it('逐条许可都在宽松白名单里（上游混进 GPL 会在这里挂）', () => {
    const bad = RAW_CATALOG.filter((t) => !PERMISSIVE_LICENSES.has(t.license));
    expect(bad.map((t) => `${t.name}: ${t.license}`)).toEqual([]);
  });

  it('被拒条目里没有任何一条属于宽松白名单之外', () => {
    // 许可过滤与形状过滤是两条独立的判据：不能因为许可挂了就掩盖形状问题
    expect(CATALOG_ISSUES.every((i) => !i.reason.includes('许可证'))).toBe(true);
  });

  it('作者与许可证都非空（MIT/BSD 的署名要求）', () => {
    for (const e of TRANSITIONS) {
      expect(e.author, `${e.id} 缺 author`).not.toBe('');
      expect(e.license, `${e.id} 缺 license`).not.toBe('');
    }
  });

  it('id 唯一，且按 id 升序（选择器顺序不能随上游数组顺序漂）', () => {
    const ids = TRANSITIONS.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual([...ids].sort((a, b) => a.localeCompare(b)));
  });

  it('每条 body 都有 vec4 transition(vec2) 入口，且被包成完整 fragment', () => {
    for (const e of TRANSITIONS) {
      expect(e.fragment.startsWith('#version 300 es'), `${e.id} 缺版本声明`).toBe(true);
      // 注意上游有些条目写成 `vec4 transition (vec2 uv)`（函数名与括号之间有空格）
      expect(/vec4\s+transition\s*\(/.test(e.fragment), `${e.id} 缺 transition 入口`).toBe(true);
      expect(e.fragment).toContain('void main() { outColor = transition(vUv); }');
    }
  });

  it('参数派生没有遇到认不出的类型', () => {
    const types = new Set(RAW_CATALOG.flatMap((t) => Object.values(t.paramsTypes ?? {})));
    const known = new Set(['float', 'int', 'bool', 'vec2', 'ivec2', 'vec3', 'vec4']);
    expect([...types].filter((t) => !known.has(t))).toEqual([]);
  });

  it('依赖 uniform 的全局初始化（ES 3.00 非法）都被改写掉了', () => {
    /*
     * 实测这 10 条用了「把 uniform 预处理成全局量」的 ES 1.00 惯用法：
     *   float nQuick = clamp(zoom_quickness,0.2,1.0);   vec2 ratio2 = vec2(1.0, 1.0/ratio);
     *   float s = pow(2.0*abs(progress-0.5),3.0);       float d = min(progress,1.0-progress);
     *   vec2 center = vec2(1.0, direction);             float dist = scale / 10.;
     * 它们在 GLSL ES 3.00 下会直接编译失败（global initializer 必须是常量表达式），
     * 所以 wrap 时改写成了 #define。上游若改了这些条目，这条断言会先失败提醒。
     */
    const rewritten = RAW_CATALOG.filter((t) => {
      const names = new Set(['from', 'to', 'progress', 'ratio', ...Object.keys(t.paramsTypes ?? {})]);
      return rewriteNonConstGlobals(normalizeGlsl(t.glsl), names).rewrites.length > 0;
    })
      .map((t) => t.name)
      .sort();
    expect(rewritten).toEqual(
      [
        'CircleCrop',
        'Rectangle',
        'SimpleZoom',
        'SimpleZoomOut',
        'ZoomInCircles',
        'ZoomLeftWipe',
        'ZoomRigthWipe',
        'luminance_melt',
        'pixelize',
        'powerKaleido',
      ].sort(),
    );
  });
});

describe('uniform 覆盖一致性', () => {
  it('body 里声明的每个 uniform 都在「规范四件套 ∪ paramsTypes」里', () => {
    const problems: string[] = [];
    for (const raw of RAW_CATALOG) {
      const entry = getTransition(raw.name);
      if (!entry) continue;
      const body = stripComments(raw.glsl);
      const declared = [...body.matchAll(/\buniform\s+\w+\s+(\w+)\s*;/g)].map((m) => m[1]!);
      const known = new Set([...SPEC_UNIFORMS, ...Object.keys(raw.paramsTypes ?? {})]);
      for (const name of declared) {
        if (!known.has(name)) problems.push(`${raw.name}: uniform ${name} 不在 paramsTypes 里（运行时恒为 0）`);
      }
    }
    expect(problems).toEqual([]);
  });

  it('没有条目自己重复声明规范四件套（会与 head 冲突、编译期报重定义）', () => {
    const problems: string[] = [];
    for (const raw of RAW_CATALOG) {
      const body = stripComments(raw.glsl);
      for (const name of [...SPEC_UNIFORMS]) {
        if (new RegExp(`\\buniform\\s+\\w+\\s+${name}\\s*;`).test(body)) {
          problems.push(`${raw.name}: 自己声明了 ${name}`);
        }
      }
    }
    expect(problems).toEqual([]);
  });

  it('扫描器本身有效（去掉这几条已知带 texture2D 的条目会扫不到东西）', () => {
    const withTexture2D = RAW_CATALOG.filter((t) => /texture2D/.test(t.glsl)).map((t) => t.name);
    expect(withTexture2D).toContain('GlitchDisplace');
  });
});

describe('scanDeclaredUniforms：扫 body 声明的 uniform', () => {
  it('认得 `/* = value *\/` 与 `// = value` 两种写法', () => {
    expect(scanDeclaredUniforms('uniform vec3 color /* = vec3(0.9, 0.4, 0.2) */;')).toEqual([
      { name: 'color', glslType: 'vec3' },
    ]);
    expect(scanDeclaredUniforms('uniform float blocksize; // = 0.02')).toEqual([
      { name: 'blocksize', glslType: 'float' },
    ]);
  });

  it('一条声明里的多个 declarator 都要扫到（规范允许 `uniform vec2 foo, bar;`）', () => {
    expect(scanDeclaredUniforms('uniform vec2 foo, bar;')).toEqual([
      { name: 'foo', glslType: 'vec2' },
      { name: 'bar', glslType: 'vec2' },
    ]);
  });

  it('注释里的 uniform 不算（否则会误判整条转场不可用）', () => {
    expect(scanDeclaredUniforms('// uniform float ghost;\n/* uniform vec2 ghost2; */')).toEqual([]);
  });

  it('sampler2D 也能扫出来（luma / displacement 就是靠这条被拒的）', () => {
    expect(scanDeclaredUniforms('uniform sampler2D displacementMap;')).toEqual([
      { name: 'displacementMap', glslType: 'sampler2D' },
    ]);
  });
});

describe('normalizeGlsl：GLSL ES 1.00 → 3.00 的最小改写', () => {
  it('texture2D → texture', () => {
    expect(normalizeGlsl('vec4 c = texture2D(from, uv);')).toBe('vec4 c = texture(from, uv);');
    expect(normalizeGlsl('texture2D (from, uv)')).toBe('texture(from, uv)');
  });

  it('gl_FragColor → outColor', () => {
    expect(normalizeGlsl('gl_FragColor = vec4(1.0);')).toBe('outColor = vec4(1.0);');
    // 不能误伤同前缀的标识符
    expect(normalizeGlsl('float gl_FragColorX = 1.0;')).toBe('float gl_FragColorX = 1.0;');
  });

  it('注释里的这两种写法也一起被改写（无害，且省掉一次注释剥离）', () => {
    expect(normalizeGlsl('//gl_FragColor = mix(texture2D(from, p), to, 1.0);')).toBe(
      '//outColor = mix(texture(from, p), to, 1.0);',
    );
  });

  it('head 用的是规范的名字（第三方 body 才能零改动接入）', () => {
    for (const u of ['uniform sampler2D from;', 'uniform sampler2D to;', 'uniform float progress;', 'uniform float ratio;']) {
      expect(TRANSITION_HEAD).toContain(u);
    }
    expect(TRANSITION_HEAD).toContain('vec4 getFromColor(vec2 uv)');
    expect(TRANSITION_HEAD).toContain('vec4 getToColor(vec2 uv)');
    // ratio 是 float（width/height），不是 vec2 —— 规范 v1 写得很明确
    expect(TRANSITION_HEAD).not.toContain('vec2 ratio');
  });

  it('wrap 出来的 fragment 三段齐全', () => {
    const f = wrapTransitionFragment('vec4 transition(vec2 uv) { return vec4(0.0); }', new Set());
    expect(f.indexOf('#version 300 es')).toBe(0);
    expect(f).toContain('outColor = transition(vUv);');
  });
});

describe('rewriteNonConstGlobals：ES 1.00 的全局初始化 → #define', () => {
  const UNIFORMS = new Set(['from', 'to', 'progress', 'ratio', 'zoom_quickness', 'direction']);

  it('依赖 uniform 的全局变量（上游真实写法）被改成 #define', () => {
    const src = [
      'uniform float zoom_quickness;',
      'float nQuick = clamp(zoom_quickness,0.2,1.0);',
      'vec4 transition(vec2 uv) { return vec4(nQuick); }',
    ].join('\n');
    const { source, rewrites } = rewriteNonConstGlobals(src, UNIFORMS);
    expect(rewrites).toEqual([{ name: 'nQuick', expr: 'clamp(zoom_quickness,0.2,1.0)' }]);
    expect(source).toContain('#define nQuick (clamp(zoom_quickness,0.2,1.0))');
    expect(source).not.toContain('float nQuick =');
  });

  it('引用 progress / ratio 的同样处理（CircleCrop、pixelize、Rectangle 的形态）', () => {
    const src = [
      'vec2 ratio2 = vec2(1.0, 1.0 / ratio);',
      'float s = pow(2.0 * abs(progress - 0.5), 3.0);',
      'float d = min(progress, 1.0 - progress);',
    ].join('\n');
    const { source, rewrites } = rewriteNonConstGlobals(src, UNIFORMS);
    expect(rewrites.map((r) => r.name)).toEqual(['ratio2', 's', 'd']);
    expect(source).toContain('#define ratio2 (vec2(1.0, 1.0 / ratio))');
  });

  it('真常量全局变量一律不动（少动一点，就少一类要解释的行为）', () => {
    const src = 'const float PI = 3.1415926;\nfloat k = 4.0;\nvec2 c = vec2(0.5, 0.5);';
    const { source, rewrites } = rewriteNonConstGlobals(src, UNIFORMS);
    expect(rewrites).toEqual([]);
    expect(source).toBe(src);
  });

  it('函数体内部的同名声明不受影响（只看顶层）', () => {
    const src = [
      'vec4 transition(vec2 uv) {',
      '  float nQuick = clamp(zoom_quickness, 0.2, 1.0);',
      '  return vec4(nQuick);',
      '}',
    ].join('\n');
    const { source, rewrites } = rewriteNonConstGlobals(src, UNIFORMS);
    expect(rewrites).toEqual([]);
    expect(source).toBe(src);
  });

  it('注释里的同名文本不触发（也不会被替换）', () => {
    const src = '// float nQuick = clamp(zoom_quickness,0.2,1.0);\nfloat k = 1.0;';
    const { rewrites } = rewriteNonConstGlobals(src, UNIFORMS);
    expect(rewrites).toEqual([]);
  });

  it('多行初始化式折成单行（宏必须是单行），并补齐原换行数以保住行号', () => {
    const src = ['float s = pow(', '  2.0 * abs(progress - 0.5),', '  3.0);', 'vec4 transition(vec2 uv) { return vec4(s); }'].join('\n');
    const { source, rewrites } = rewriteNonConstGlobals(src, UNIFORMS);
    expect(rewrites).toHaveLength(1);
    expect(rewrites[0]!.expr).toBe('pow( 2.0 * abs(progress - 0.5), 3.0)');
    // 宏本体不含换行，其后补了 2 个换行 → 总行数不变（报错行号仍对得上上游源码）
    expect(source.split('\n').length).toBe(src.split('\n').length);
    expect(source).toContain('#define s (pow( 2.0 * abs(progress - 0.5), 3.0))');
  });

  it('参数列表里的逗号不会把语句提前截断', () => {
    const src = 'float y = mix(progress, ratio, 0.5);';
    const { rewrites } = rewriteNonConstGlobals(src, UNIFORMS);
    expect(rewrites[0]!.expr).toBe('mix(progress, ratio, 0.5)');
  });
});

describe('参数派生', () => {
  it('六种类型都能派生', () => {
    const { params, uniforms, unsupported } = deriveTransitionParams(
      { a: 'float', b: 'int', c: 'bool', d: 'vec2', e: 'ivec2', f: 'vec3', g: 'vec4' },
      { a: 50, b: 3, c: true, d: [2, 4], e: [8, 8], f: [1, 2, 3], g: [0, 0, 0, 0.6] },
    );
    expect(unsupported).toEqual([]);
    expect(uniforms.map((u) => [u.name, u.size])).toEqual([
      ['a', 1], ['b', 1], ['c', 1], ['d', 2], ['e', 2], ['f', 3], ['g', 4],
    ]);
    expect(params.map((p) => p.key)).toEqual([
      'a', 'b', 'c', 'd#0', 'd#1', 'e#0', 'e#1', 'f#0', 'f#1', 'f#2', 'g#0', 'g#1', 'g#2', 'g#3',
    ]);
    expect(params.map((p) => p.defaultValue)).toEqual([50, 3, 1, 2, 4, 8, 8, 1, 2, 3, 0, 0, 0, 0.6]);
  });

  it('bool 走 checkbox，默认值转成 0/1', () => {
    const { params } = deriveTransitionParams({ flip: 'bool' }, { flip: false });
    expect(params[0]).toMatchObject({ key: 'flip', type: 'checkbox', defaultValue: 0 });
  });

  it('int / ivec2 用整数范围与步长 1', () => {
    expect(scalarRange('int', 3)).toEqual({ min: 0, max: 12, step: 1 });
    expect(scalarRange('ivec2', 8)).toEqual({ min: 0, max: 32, step: 1 });
    // 负默认值（上游确实有 direction = -1）
    expect(scalarRange('int', -1)).toEqual({ min: -4, max: 4, step: 1 });
    // 非整数范围要向外取整，否则滑杆到不了作者默认值
    expect(scalarRange('ivec2', 3)).toEqual({ min: 0, max: 12, step: 1 });
  });

  it('float 的范围是 4 倍余量的启发式（抽查上游真实默认值）', () => {
    expect(scalarRange('float', 50)).toEqual({ min: 0, max: 200, step: 1 });
    expect(scalarRange('float', 0.02).max).toBe(1);
    expect(scalarRange('float', 0.8).max).toBeCloseTo(3.2, 9);
    // 0 是退化默认值，给一个能用的单位区间而不是 [0,0]
    expect(scalarRange('float', 0)).toEqual({ min: 0, max: 1, step: 1 / 200 });
  });

  it('认不出的类型进 unsupported 并丢弃（上游加新类型会在这里现形）', () => {
    const { params, uniforms, unsupported } = deriveTransitionParams(
      { ok: 'float', weird: 'mat3' },
      { ok: 1, weird: 0 },
    );
    expect(unsupported).toEqual([{ name: 'weird', type: 'mat3' }]);
    expect(uniforms.map((u) => u.name)).toEqual(['ok']);
    expect(params.map((p) => p.key)).toEqual(['ok']);
  });

  it('fillTransitionValues：缺键回退到作者默认值（不是 0）', () => {
    const { params } = deriveTransitionParams({ pixelSize: 'float' }, { pixelSize: 50 });
    expect(fillTransitionValues(params, {})).toEqual({ pixelSize: 50 });
    expect(fillTransitionValues(params, { pixelSize: 7 })).toEqual({ pixelSize: 7 });
    // 工程里存了 NaN / 非数字也要兜住
    expect(fillTransitionValues(params, { pixelSize: Number.NaN })).toEqual({ pixelSize: 50 });
  });
});

describe('writeTransitionUniforms', () => {
  function fakeGl() {
    return {
      uniform1f: vi.fn(),
      uniform1i: vi.fn(),
      uniform2f: vi.fn(),
      uniform2i: vi.fn(),
      uniform3f: vi.fn(),
      uniform4f: vi.fn(),
    };
  }
  const locs = { a: {} as WebGLUniformLocation, b: {}, d: {}, g: {} } as Record<
    string,
    WebGLUniformLocation | null
  >;

  it('按类型派发到 uniform1f/1i/2f/4f', () => {
    const gl = fakeGl();
    const { uniforms } = deriveTransitionParams(
      { a: 'float', b: 'bool', d: 'vec2', g: 'vec4' },
      { a: 1, b: true, d: [0, 0], g: [0, 0, 0, 0] },
    );
    writeTransitionUniforms(gl as unknown as WebGL2RenderingContext, locs, uniforms, {
      a: 2.5, b: 1, 'd#0': 1, 'd#1': 2, 'g#0': 0.1, 'g#1': 0.2, 'g#2': 0.3, 'g#3': 0.4,
    });
    expect(gl.uniform1f).toHaveBeenCalledWith(locs.a, 2.5);
    expect(gl.uniform1i).toHaveBeenCalledWith(locs.b, 1);
    expect(gl.uniform2f).toHaveBeenCalledWith(locs.d, 1, 2);
    expect(gl.uniform4f).toHaveBeenCalledWith(locs.g, 0.1, 0.2, 0.3, 0.4);
  });

  it('location 为 null（被编译器优化掉的死参数）静默跳过，不抛', () => {
    const gl = fakeGl();
    const { uniforms } = deriveTransitionParams({ missing: 'float' }, { missing: 1 });
    expect(() =>
      writeTransitionUniforms(gl as unknown as WebGL2RenderingContext, { missing: null }, uniforms, {
        missing: 1,
      }),
    ).not.toThrow();
    expect(gl.uniform1f).not.toHaveBeenCalled();
  });
});

describe('registry 查询', () => {
  it('listTransitions 与 catalog 一致，getTransition 未知 id 返回 null', () => {
    expect(listTransitions().length).toBe(TRANSITIONS.length);
    expect(getTransition('fade')).not.toBeNull();
    expect(getTransition('不存在')).toBeNull();
    expect(defaultTransitionValues('不存在')).toEqual({});
  });

  it('上游的 fade 是无参转场；CrossZoom 有 float 参数', () => {
    expect(getTransition('fade')!.params).toEqual([]);
    const zoom = getTransition('CrossZoom');
    if (zoom) {
      expect(zoom.uniforms.some((u) => u.glslType === 'float')).toBe(true);
      expect(Object.keys(defaultTransitionValues('CrossZoom')).length).toBe(zoom.params.length);
    }
  });
});

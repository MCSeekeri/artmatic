import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { interpolate, placeholdersOf } from '../../src/i18n/format';
import { tr } from '../../src/i18n/index.svelte';
import { LOCALES, type MessageKey } from '../../src/i18n/locales';
import { common } from '../../src/i18n/locales/zh-CN/common';
import { media } from '../../src/i18n/locales/zh-CN/media';
import { effects } from '../../src/i18n/locales/zh-CN/effects';
import { app } from '../../src/i18n/locales/zh-CN/app';
import { project } from '../../src/i18n/locales/zh-CN/project';
import { timeline } from '../../src/i18n/locales/zh-CN/timeline';
import { inspector } from '../../src/i18n/locales/zh-CN/inspector';
import { typography } from '../../src/i18n/locales/zh-CN/typography';
import { ribbon } from '../../src/i18n/locales/zh-CN/ribbon';
import { shortcuts } from '../../src/i18n/locales/zh-CN/shortcuts';
import { errors } from '../../src/i18n/locales/zh-CN/errors';
import { lab } from '../../src/i18n/locales/zh-CN/lab';

const SRC = fileURLToPath(new URL('../../src', import.meta.url));

/* ------------------------------------------------------------------ 插值 */

describe('interpolate', () => {
  it('替换已知占位符', () => {
    expect(interpolate('已打开「{name}」· {n} 个素材', { name: 'demo', n: 3 })).toBe(
      '已打开「demo」· 3 个素材',
    );
  });

  it('同一个占位符出现多次都替换', () => {
    expect(interpolate('{a}+{a}', { a: 'x' })).toBe('x+x');
  });

  it('缺少参数时保留占位符原名（不是变空）', () => {
    expect(interpolate('已打开「{name}」', {})).toBe('已打开「{name}」');
  });

  it('值为 0 / 空串时照样替换（用真值判断会在这里出错）', () => {
    expect(interpolate('{a}-{b}', { a: 0, b: '' })).toBe('0-');
  });

  it('没有 vars 时原样返回', () => {
    expect(interpolate('无占位符')).toBe('无占位符');
  });

  it('花括号里不是标识符的片段不动', () => {
    expect(interpolate('{ } {a-b} {ok}', { ok: '1' })).toBe('{ } {a-b} 1');
  });
});

describe('placeholdersOf', () => {
  it('去重并按出现顺序返回', () => {
    expect(placeholdersOf('{a} {b} {a}')).toEqual(['a', 'b']);
  });
});

/* ------------------------------------------------------------- 取词 API */

describe('tr()', () => {
  it('取到中文', () => {
    expect(tr('common.cancel')).toBe('取消');
    expect(tr('common.minutesAgo', { n: 5 })).toBe('5 分钟前');
  });

  it('未知键返回键本身，而不是空串', () => {
    // 故意绕开类型：模拟「语言表少了一条」的运行期形态。
    // 返回空串会变成「按钮是空白的」，比看得见的 key 更难归因。
    expect(tr('not.a.key' as MessageKey)).toBe('not.a.key');
  });

  it('占位符缺席时把 {name} 原样留在句子里', () => {
    expect(tr('app.closeProjectTab')).toBe('关闭 {name}');
  });
});

/* --------------------------------------------------------------- 表结构 */

describe('文案表结构', () => {
  /** 各域文件。加语言时这张表就是「必须全部覆盖」的清单。 */
  const DOMAINS = {
    common,
    media,
    effects,
    app,
    project,
    timeline,
    inspector,
    typography,
    ribbon,
    shortcuts,
    errors,
    lab,
  } as const;

  it('合并结果等于各域之并（没有跨文件重名把别人覆盖掉）', () => {
    const merged = new Set(Object.keys(LOCALES['zh-CN']));
    const total = Object.values(DOMAINS).reduce((n, d) => n + Object.keys(d).length, 0);
    // 只有真重名时 total > merged.size —— 这是唯一能发现「两个文件定义了同一个
    // key」的办法：`{...a, ...b}` 会静默用后者覆盖前者，编译期完全看不出来。
    expect(total, '有跨文件重名的 key').toBe(merged.size);

    const seen = new Map<string, string>();
    for (const [name, domain] of Object.entries(DOMAINS)) {
      for (const key of Object.keys(domain)) {
        const prev = seen.get(key);
        expect(prev, `key「${key}」同时出现在 ${prev} 与 ${name}`).toBeUndefined();
        seen.set(key, name);
      }
    }
  });

  it('每一条都是非空字符串', () => {
    for (const [key, value] of Object.entries(LOCALES['zh-CN'])) {
      expect(typeof value, key).toBe('string');
      expect(value.trim().length, key).toBeGreaterThan(0);
    }
  });

  it('键名形如 域.名字（防止把 key 写成一句中文）', () => {
    for (const key of Object.keys(LOCALES['zh-CN'])) {
      expect(key, key).toMatch(/^[a-z][a-zA-Z0-9]*\.[a-zA-Z0-9]+(\.[a-zA-Z0-9]+)*$/);
    }
  });

  it('没有 {{ 或 }} 这种转义写错', () => {
    // 只查双写。**不能**断言「值里不出现花括号」——有些文案本来就在讲花括号
    // （`typo.customCssUnbalanced` 整句都在解释 CSS 的 {}），那种值里的
    // `{}` / `}` 是正文，不是占位符语法。
    for (const [key, value] of Object.entries(LOCALES['zh-CN'])) {
      expect(value.includes('{{') || value.includes('}}'), `${key}: ${value}`).toBe(false);
    }
  });
});

/* --------------------------------------------------- 硬编码文案的覆盖守卫 */

/**
 * 唯一允许留在 `src/`（语言文件之外）的中日韩字符串。
 *
 * **每一条都必须写明为什么它不是「文案」** —— 判据只有一条：
 * 用户有没有可能看到它。看得到的必须进语言文件。
 *
 * 加新条目等于声明「这个字符串不该被翻译」，请慎重：绝大多数情况下
 * 正确做法是抽成 key，而不是往这里加一行。
 */
const DEV_ONLY_ALLOWED: Record<string, string[]> = {
  /* ── 一、启动期不变量 / 构建纪律 ──────────────────────────────────
   * 写错就是构建事故。它们一抛就是整条链路坏掉，不是「用户可以绕过的提示」。
   */
  // 「新增一个特效 = 两个文件」的配对检查。
  'effects/registry.ts': [
    '特效 ${key} 缺少 glsl/${key}.ts（两个文件纪律）',
    '特效文件名 ${key} 与 def.id ${def.id} 不一致',
    '特效 ${key} 缺少 defs/${key}.ts（两个文件纪律）',
  ],
  // Worker 侧回包，只会进 bake-client.ts 的 console.error。
  'algos/bake.worker.ts': ['未知生成器 ${msg.genId}'],
  // runtime.schedule() 里是 `this.backends.pick()`，**没有 catch** ——
  // 这条抛出来就是整个排版光栅化坏掉，属于「应用被构建坏了」。
  'typography/rasterizer.ts': ['没有可用的排版光栅化后端'],
  // 试炼场的「全部编译」用。`listEffects()` 与 `getEffect()` 读的是同一个
  // Map，所以这条分支实际不可达 —— 它是注册表被改坏时的诊断，
  // 只会出现在 lab 右栏的编译日志里，没有任何出口通向用户界面。
  'effects/compile-all.ts': ['注册表里没有 ${id}'],
  /*
   * 转场目录的准入拒绝理由。它们只进 `CATALOG_ISSUES` —— 一个**开发期台账**：
   * 单测断言它、CREDITS.md 记录它、E2E 失败时把它打进断言消息。
   * 界面上的转场列表根本不含被拒的条目，所以这些文案没有任何出口通向用户。
   * （真要有出口，那时再抽成 key；现在抽反而是给一段永不渲染的文字做翻译。）
   */
  'effects/transitions/catalog.ts': [
    '缺少 name',
    '<无名>',
    'name 与前面的条目重复（只保留第一条）',
    '许可证「${t.license}」不在宽松白名单里',
    'glsl 里没有 vec4 transition(vec2) 入口',
    '声明了额外贴图输入 sampler2D ${name} —— 规范只提供 from / to，给不出这张图',
    '声明了 uniform ${name} 但 paramsTypes 里没有它（拿不到可信默认值，运行时恒为 0）',
  ],
  // 改写表里的 `why` 字段：写给读这段规范化代码的人，不渲染。
  'effects/transitions/glsl.ts': [
    'ES 3.00 的取色函数叫 texture',
    'ES 3.00 没有内建 gl_FragColor',
  ],

  /*
   * ── 三、一次性分析 / 解码路径的开发诊断 ──────────────────────────
   * 这几条都只进 console，没有任何出口通向界面：
   *   · 视频解不开时界面上的反馈是**底栏的错误条**（走 `err.video.unreadable`，
   *     那条在语言文件里）；console 那几行是给调试的人看格式/编解码细节的。
   *   · FFT 长度断言是编程错误（内部 API 用错），不是用户能触发的输入。
   *   · 拍网格估计失败同样走底栏（`tp.estimateFailed`）。
   * 抽成 key 只会给一段永不渲染的文字做翻译，反而让 grep 错误信息变难。
   */
  'audio/fft.ts': ['FFT 长度必须是 2 的幂，收到 ${n}'],
  'engine/video-source.ts': [
    '[video] probe 失败：',
    '无法识别的容器格式',
    '文件里没有视频轨',
    '[video ${assetId}] 打开失败：${entry.failure}',
    '[video ${assetId}] 初始化失败：${entry.failure}',
    '[video ${entry.assetId}] 解码失败：${entry.failure}',
  ],
  'ui/app-state.svelte.ts': ['[tempo] 估计失败：'],

  /* ── 二、按 error.name 判定的哨兵；或测试替身内部 ─────────────────
   * 判据在 `name` 上，文案不参与逻辑 —— 本地化它们不会让任何东西变好，
   * 只会让 grep 错误信息变难。
   */
  'project/fs.ts': [
    // NotFoundError：判据是 `e.name === 'NotFoundError'`（见该文件注释）。
    '找不到 ${what}',
    // 下面 5 条属于 memoryRoot —— **测试替身**，不是生产路径。
    // 生产走原生 FSA 句柄，那里抛的是浏览器自己的 DOMException。
    '已有写入者',
    '${fname} 是目录',
    '${dname} 是文件',
    '目录非空',
    'seed 路径不是目录：${path}',
    // opfsRoot() 只服务 E2E 与 dev（用户的目录走 fsaRoot）。
    '此环境不支持 OPFS（navigator.storage.getDirectory）',
  ],
  // ExportCancelledError：ui/export.ts 按 `instanceof` 过滤后显示自己的文案。
  'exporters/export-runner.ts': ['导出已取消'],

  /* ── 三、被 catch 后静默降级 / 只进 console ───────────────────────
   * 用户永远看不到，因为它们**没有出口**：要么 catch 里 return false / 回落，
   * 要么只走 console.warn。
   */
  // 文件头写着「失败返回 false，不抛」—— putHandle 等一律 catch 成降级。
  'project/handles.ts': [
    '此环境没有 IndexedDB',
    '打开 IndexedDB 失败',
    'IndexedDB 事务失败',
    'IndexedDB 事务被中止',
  ],
  // hashIfReasonable 先判 hashSupported() 就返回 null，这条 throw 不可达。
  'project/hash.ts': ['crypto.subtle 不可用（需要安全上下文）'],
  // HarfBuzz WASM：FontRegistry 捕获后降级成「整体内联」，只留一条 console.warn。
  'typography/font/subset-hb.ts': [
    'harfbuzz-subset.wasm 加载失败：HTTP ${res.status}',
    'harfbuzz: malloc 失败',
    'harfbuzz: 创建 subset input 失败',
    'harfbuzz: hb_subset_or_fail 失败（字体损坏？）',
  ],
  'typography/font-registry.ts': [
    '[typo] 内置字体 ${face.url} 加载失败',
    '[typo] ${face.id} 子集化失败，退回整体内联',
    '[typo] 字体 ${face.id} 的 FontFace 加载失败',
  ],
  'typography/runtime.ts': ['[typo] 光栅化失败', '[typo] 预热失败'],
  // 字体导入的逐项失败：其余字体照常导入，只 console.warn 这一条。
  'ui/typography/actions.ts': ['[typo] 字体 ${f.name} 导入失败'],
};

const CJK = /[\u4e00-\u9fff\u3000-\u303f\uff00-\uffef]/;

function* walk(dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) yield* walk(p);
    else if (/\.(ts|svelte)$/.test(name) && !name.endsWith('.d.ts')) yield p;
  }
}

/**
 * 把注释与 import 路径抹成等长空白（保留行列位置，方便报错）。
 *
 * 不是完整的语法分析，但覆盖得够用。**三条规则，第三条要解释一下**：
 *
 * 1. 块注释、行注释、import 路径 —— 常规。
 * 2. **内联 `//` 注释（前面有空格的那种）也要抹。** 因为本项目把 GLSL
 *    当模板字符串内嵌（`engine/*.frag.ts`、`algos/mandelbrot.ts`、
 *    `effects/glsl/*.ts`），那些着色器里的中文注释是**代码注释**，不是文案。
 *    不抹的话守卫会把整段着色器源码报成「未抽取的文案」。
 *    刻意要求前面有空格：`https://x` 这种不会被误伤。
 * 3. 抹掉的都是**本来就不该被当成文案**的东西，所以**只会漏报不会误报**。
 *    守卫宁可漏（有人在别处补），也不要误报 —— 误报会被人加白名单绕过去，
 *    那就彻底废了。漏报的风险由 `tests/unit/i18n.test.ts` 之外的一次性
 *    交叉核对（把 HEAD 的每条中文字面量对一遍语言文件）兜住。
 */
function stripCommentsAndImports(src: string): string {
  let s = src;
  s = s.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));
  s = s.replace(/^(\s*)\/\/.*$/gm, (m) => m.replace(/[^\n]/g, ' '));
  s = s.replace(/[ \t]\/\/[^\n]*/g, (m) => m.replace(/[^\n]/g, ' '));
  s = s.replace(/((?:from|import)\s*)(['"])[^'"]*\2/g, (m) => m.replace(/[^\n]/g, ' '));
  return s;
}

/**
 * 抽出所有含中日韩字符的字符串字面量。
 *
 * ⚠️ **必须对整份源码跑，不能逐行。** 跨行的模板字符串
 * （`throw new Error(`foo` + `bar`)` 换行写的那种）逐行扫会整条漏掉 ——
 * 这是实测踩过的：改之前有 570 条，逐行扫只找到 566 条。
 */
function literalsWithCjk(file: string): string[] {
  const re = /(['"`])((?:\\.|(?!\1)[^\\])*)\1/g;
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(stripCommentsAndImports(readFileSync(file, 'utf8'))))) {
    if (CJK.test(m[2]!) && m[2]!.length >= 2) out.push(m[2]!);
  }
  return out;
}

describe('硬编码文案守卫', () => {
  it('src/ 下除语言文件外，没有面向用户的中日韩字面量', () => {
    const violations: string[] = [];
    for (const file of walk(SRC)) {
      const rel = relative(SRC, file).replace(/\\/g, '/');
      // 语言文件就是文案的存放处，跳过。
      if (rel.startsWith('i18n/locales/')) continue;
      const allowed = new Set(DEV_ONLY_ALLOWED[rel] ?? []);
      for (const literal of literalsWithCjk(file)) {
        if (allowed.has(literal)) continue;
        violations.push(`${rel}: ${literal}`);
      }
    }
    expect(
      violations,
      `这些中文字面量还没进语言文件（要抽成 key；确实是开发诊断的话，\n` +
        `把它加进本测试的 DEV_ONLY_ALLOWED 并写明理由）：\n${violations.join('\n')}`,
    ).toEqual([]);
  });

  it('白名单里的条目确实还在（过期条目要删掉，否则会掩盖回归）', () => {
    for (const [rel, literals] of Object.entries(DEV_ONLY_ALLOWED)) {
      const found = literalsWithCjk(join(SRC, rel));
      for (const literal of literals) {
        expect(found, `${rel} 里已经没有「${literal}」了，把这条白名单删掉`).toContain(literal);
      }
    }
  });
});

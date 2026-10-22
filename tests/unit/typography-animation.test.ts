import { describe, expect, it } from 'vitest';
import {
  animationCurrentTimeMs,
  animationName,
  animationShorthand,
  animationStyleSheet,
  createCustomAnimation,
  createPresetAnimation,
  customSubAnimations,
  defaultTiming,
  docIsAnimated,
  isAnimationActiveAt,
  isValidCustomCss,
  keyframeBodyOf,
  parseAnimationShorthand,
  parseCustomCss,
  presetKeyframes,
  sanitizeCustomCss,
} from '../../src/typography/animation';
import { createTextElement, createTypographyDocument } from '../../src/typography/document';
import type { ElementAnimation } from '../../src/typography/animation';

const fadeIn = () => createPresetAnimation('fade-in', 'a1', { delay: 0.2, duration: 0.6 });

/** 两条动画：pulse 无限循环 + glow 延迟 0.5s。 */
const MULTI_CSS = '@keyframes pulse{from{opacity:1}to{opacity:0.3}}@keyframes glow{from{filter:blur(0)}to{filter:blur(6px)}}';
const MULTI_ANIM = 'pulse 1s ease-in-out infinite, glow 2s linear 0.5s';
const MULTI_TEXT = `${MULTI_CSS.replace(/@keyframes (\w+)/g, '@keyframes $1 ')}\nanimation: ${MULTI_ANIM};`;

describe('animationCurrentTimeMs', () => {
  it('延迟之前钳到 0，不产生负的 currentTime', () => {
    const a = fadeIn();
    expect(animationCurrentTimeMs(a, 0)).toBe(0);
    expect(animationCurrentTimeMs(a, 0.1)).toBe(0);
    expect(animationCurrentTimeMs(a, 0.1999)).toBe(0);
  });

  it('过了延迟之后是「本地时间 - 延迟」的毫秒数', () => {
    const a = fadeIn();
    expect(animationCurrentTimeMs(a, 0.2)).toBe(0);
    expect(animationCurrentTimeMs(a, 0.7)).toBeCloseTo(500, 6);
    expect(animationCurrentTimeMs(a, 1.2)).toBeCloseTo(1000, 6);
  });

  it('片段起点之前（localSec 为负）也是 0，不抛错', () => {
    expect(animationCurrentTimeMs(fadeIn(), -3)).toBe(0);
  });

  it('对同一 localSec 幂等 —— 这是确定性的前提', () => {
    const a = fadeIn();
    expect(animationCurrentTimeMs(a, 0.75)).toBe(animationCurrentTimeMs(a, 0.75));
  });

  it('只依赖 delay（多动画简写里逐条取各自的延迟）', () => {
    expect(animationCurrentTimeMs({ delay: 0.5 }, 1)).toBeCloseTo(500, 6);
  });
});

describe('isAnimationActiveAt', () => {
  it('延迟前不算激活', () => {
    expect(isAnimationActiveAt(fadeIn(), 0.1)).toBe(false);
  });

  it('单次播放结束后（fill 不填时）不再激活', () => {
    const a = createPresetAnimation('fade-in', 'a1', { delay: 0, duration: 0.5, iterations: 1 });
    expect(isAnimationActiveAt(a, 0.5)).toBe(true);
    expect(isAnimationActiveAt(a, 0.5000001)).toBe(false);
  });

  it('多次迭代按总时长算', () => {
    const a = createPresetAnimation('spin', 'a1', { delay: 0, duration: 0.5, iterations: 3 });
    expect(isAnimationActiveAt(a, 1.49)).toBe(true);
    expect(isAnimationActiveAt(a, 1.51)).toBe(false);
  });

  it('无限循环永远激活', () => {
    const a = createPresetAnimation('spin', 'a1', { iterations: Infinity });
    expect(isAnimationActiveAt(a, 1e6)).toBe(true);
  });
});

describe('presetKeyframes', () => {
  it('淡入淡出是可预期的字面量', () => {
    expect(presetKeyframes('fade-in')).toBe('from{opacity:0}to{opacity:1}');
    expect(presetKeyframes('fade-out')).toBe('from{opacity:1}to{opacity:0}');
  });

  it('参数进到输出里', () => {
    expect(presetKeyframes('slide-in-left', { dist: 40 })).toContain('translateX(-40px)');
    expect(presetKeyframes('slide-in-left')).toContain('translateX(-80px)');
    expect(presetKeyframes('blur-in', { blur: 3 })).toContain('blur(3px)');
  });

  it('每个预设都产出非空且花括号配平的体', () => {
    const presets = [
      'fade-in', 'fade-out', 'fade-in-out',
      'slide-in-left', 'slide-in-right', 'slide-in-up', 'slide-in-down',
      'zoom-in', 'zoom-out', 'pop', 'spin', 'pulse', 'shake', 'blur-in',
    ] as const;
    for (const p of presets) {
      const body = presetKeyframes(p);
      expect(body.length).toBeGreaterThan(0);
      expect(isValidCustomCss(body)).toBe(true);
    }
  });
});

describe('sanitizeCustomCss', () => {
  it('放行合法的 keyframes 体（内部本来就有成对花括号）', () => {
    expect(sanitizeCustomCss('from{opacity:0}to{opacity:1}')).toBe('from{opacity:0}to{opacity:1}');
    expect(sanitizeCustomCss('0%{top:0}50%{top:10px}100%{top:0}')).toContain('50%');
  });

  it('剥掉 @import / @charset（离线与确定性硬要求）', () => {
    const s = sanitizeCustomCss('@import url(http://evil/x.css);from{opacity:0}to{opacity:1}');
    expect(s).not.toContain('@import');
    expect(s).not.toContain('evil');
    expect(s).toContain('to{opacity:1}');
    expect(sanitizeCustomCss('@charset "utf-8";from{opacity:0}to{opacity:1}')).not.toContain('@charset');
  });

  it('剥掉标签，堵住 </style> 注入', () => {
    const s = sanitizeCustomCss('from{opacity:0}to{opacity:1}</style><script>x</script>');
    expect(s).not.toContain('<');
    expect(s).not.toContain('script');
  });

  it('剥掉注释（堵住 /* } *​/ 绕过花括号配平）', () => {
    const s = sanitizeCustomCss('from{opacity:0}/* } body{display:none} */to{opacity:1}');
    expect(s).not.toContain('body');
    expect(s).not.toContain('/*');
  });

  it('花括号提前闭合 → 判为非法（这是唯一能逃出 @keyframes 块的方式）', () => {
    expect(sanitizeCustomCss('from{opacity:0}}body{display:none}')).toBe('');
    expect(isValidCustomCss('}*{color:red}')).toBe(false);
  });

  it('花括号没配平 → 判为非法', () => {
    expect(sanitizeCustomCss('from{opacity:0')).toBe('');
    expect(sanitizeCustomCss('from{{opacity:0}')).toBe('');
  });
});

describe('parseCustomCss — 旧单 body 向后兼容', () => {
  it('裸 keyframes 体被识别为单条形态，且不带 animation', () => {
    const p = parseCustomCss('from{opacity:0}to{opacity:1}');
    expect(p).toEqual({ ok: true, css: 'from{opacity:0}to{opacity:1}' });
  });

  it('旧形态经 @keyframes 生成式渲染，结果与扩展前逐字一致', () => {
    const css = animationStyleSheet(docWith([createCustomAnimation('a1', 'from{opacity:0}to{opacity:1}')]));
    expect(css).toContain('@keyframes artmatic-a-a1{from{opacity:0}to{opacity:1}}');
    expect(css).toContain('[data-anim-id="a1"]{animation:artmatic-a-a1 ');
  });

  it('空 / 不配平 → unbalanced', () => {
    expect(parseCustomCss('')).toEqual({ ok: false, reason: 'unbalanced' });
    expect(parseCustomCss('from{a:0')).toEqual({ ok: false, reason: 'unbalanced' });
  });
});

describe('parseCustomCss — 多条形态', () => {
  it('抽出 @keyframes 块与逗号分隔的 animation 简写', () => {
    const p = parseCustomCss(MULTI_TEXT);
    expect(p).toEqual({ ok: true, css: MULTI_CSS, animation: MULTI_ANIM });
  });

  it('归一化后可往返（幂等）', () => {
    const first = parseCustomCss(MULTI_TEXT);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const again = parseCustomCss(`${first.css}\nanimation: ${first.animation};`);
    expect(again).toEqual(first);
  });

  it('只有 animation 简写、引用预设名也行（没有自定义块）', () => {
    const p = parseCustomCss('animation: fade-in 1s, spin 2s linear;');
    expect(p).toEqual({ ok: true, css: '', animation: 'fade-in 1s, spin 2s linear' });
  });

  it('未定义的名字被拒绝', () => {
    expect(parseCustomCss('@keyframes x{from{a:0}to{a:1}}animation: zzz 1s;')).toEqual({
      ok: false,
      reason: 'unknownName',
    });
  });

  it('有块没有简写被拒绝', () => {
    expect(parseCustomCss('@keyframes x{from{a:0}to{a:1}}')).toEqual({
      ok: false,
      reason: 'missingAnimation',
    });
  });

  it('简写解析失败被拒绝', () => {
    expect(parseCustomCss('@keyframes x{from{a:0}to{a:1}}animation: 1s 2s 3s;')).toEqual({
      ok: false,
      reason: 'badAnimation',
    });
  });

  it('关键帧体内写了选择器被拒绝（浏览器会整条丢弃那种 @keyframes）', () => {
    expect(parseCustomCss('div{color:red}')).toEqual({ ok: false, reason: 'badSelector' });
    expect(parseCustomCss('@keyframes x{div{color:red}}animation: x 1s;')).toEqual({
      ok: false,
      reason: 'badSelector',
    });
    // 合法的关键帧选择器照旧：from / to / 百分比 / 逗号并列。
    expect(parseCustomCss('0%,100%{opacity:1}50%{opacity:.2}').ok).toBe(true);
  });

  it('非法的关键帧名被拒绝', () => {
    expect(parseCustomCss('@keyframes 1bad{a:0}animation: 1bad 1s;')).toEqual({
      ok: false,
      reason: 'badKeyframeName',
    });
  });

  it('@keyframes 之外的顶层 @ 规则被拒绝', () => {
    expect(parseCustomCss('@media screen{@keyframes x{a:0}}animation: x 1s;')).toEqual({
      ok: false,
      reason: 'badAtRule',
    });
  });
});

describe('parseAnimationShorthand', () => {
  it('逐条取出名字、时长、延迟、迭代', () => {
    const r = parseAnimationShorthand('pulse 1s ease-in-out infinite, glow 2s linear 0.5s');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.parts).toEqual([
      { name: 'pulse', duration: 1, delay: 0, iterations: Infinity },
      { name: 'glow', duration: 2, delay: 0.5, iterations: 1 },
    ]);
  });

  it('第一个时间是时长、第二个是延迟；名字可出现在任意位置', () => {
    const r = parseAnimationShorthand('2s ease-out 0.5s wiggle');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.parts[0]).toEqual({ name: 'wiggle', duration: 2, delay: 0.5, iterations: 1 });
  });

  it('ms 换算成秒；cubic-bezier 里的逗号不切分', () => {
    const r = parseAnimationShorthand('a cubic-bezier(0.2, 0, 0.2, 1) 500ms, b 1s');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.parts.map((p) => p.name)).toEqual(['a', 'b']);
    expect(r.parts[0]!.duration).toBe(0.5);
  });

  it('缺名字 / 多个候选名 / 三个时间 → 失败', () => {
    expect(parseAnimationShorthand('1s linear')).toEqual({ ok: false });
    expect(parseAnimationShorthand('a b 1s')).toEqual({ ok: false });
    expect(parseAnimationShorthand('a 1s 2s 3s')).toEqual({ ok: false });
    expect(parseAnimationShorthand('')).toEqual({ ok: false });
  });
});

describe('customSubAnimations', () => {
  it('预设 / 旧单 body → 一条，延迟取 timing 字段', () => {
    expect(customSubAnimations(fadeIn())).toEqual([
      { name: 'artmatic-a-a1', delay: 0.2, duration: 0.6, iterations: 1 },
    ]);
    const legacy = createCustomAnimation('c', 'from{a:0}to{a:1}', { delay: 0.3, duration: 0.4 });
    expect(customSubAnimations(legacy)).toEqual([
      { name: 'artmatic-a-c', delay: 0.3, duration: 0.4, iterations: 1 },
    ]);
  });

  it('多动画 → 逐条取自简写（同名顺序与简写一致）', () => {
    const a = createCustomAnimation('a1', MULTI_CSS, { animation: MULTI_ANIM });
    expect(customSubAnimations(a).map((p) => [p.name, p.delay])).toEqual([
      ['pulse', 0],
      ['glow', 0.5],
    ]);
  });
});

describe('animationShorthand', () => {
  it('顺序是 name duration easing delay iterations direction fill', () => {
    const a = createPresetAnimation('fade-in', 'a1', {
      duration: 0.6, delay: 0.2, iterations: 2, easing: 'ease-out',
      direction: 'alternate', fill: 'both',
    });
    expect(animationShorthand(a)).toBe('artmatic-a-a1 0.6s ease-out 0.2s 2 alternate both');
  });

  it('Infinity 迭代写成 infinite', () => {
    const a = createPresetAnimation('spin', 'a1', { iterations: Infinity });
    expect(animationShorthand(a)).toContain('infinite');
  });

  it('cubic-bezier 数组被格式化', () => {
    const a = createPresetAnimation('fade-in', 'a1', { easing: [0.2, 0, 0.2, 1] });
    expect(animationShorthand(a)).toContain('cubic-bezier(0.2,0,0.2,1)');
  });

  it('动画名带前缀，避免与用户手写 CSS 撞名', () => {
    expect(animationName(createPresetAnimation('fade-in', 'x'))).toBe('artmatic-a-x');
  });
});

function docWith(animations: ElementAnimation[]) {
  const d = createTypographyDocument({ w: 100, h: 100 });
  d.elements = [createTextElement(d.size, { id: 'e1', animations })];
  return d;
}

describe('animationStyleSheet', () => {
  it('产出 @keyframes 块与绑定规则各一条', () => {
    const css = animationStyleSheet(docWith([fadeIn()]));
    expect(css).toContain('@keyframes artmatic-a-a1{from{opacity:0}to{opacity:1}}');
    expect(css).toContain('[data-anim-id="a1"]{animation:artmatic-a-a1');
  });

  it('同一个动画被多个元素引用时只生成一份 @keyframes', () => {
    const d = createTypographyDocument({ w: 100, h: 100 });
    const a = fadeIn();
    d.elements = [
      createTextElement(d.size, { id: 'e1', animations: [a] }),
      createTextElement(d.size, { id: 'e2', animations: [a] }),
    ];
    const css = animationStyleSheet(d);
    expect(css.split('@keyframes').length - 1).toBe(1);
    expect(css.split('[data-anim-id=').length - 1).toBe(2);
  });

  it('非法的手写 CSS 被整条跳过，不会污染样式表', () => {
    const bad = createCustomAnimation('bad', '}body{display:none}');
    const css = animationStyleSheet(docWith([bad]));
    expect(css).not.toContain('body');
    expect(css).not.toContain('@keyframes');
  });

  it('没有动画时产出空串', () => {
    const d = createTypographyDocument({ w: 100, h: 100 });
    d.elements = [createTextElement(d.size)];
    expect(animationStyleSheet(d)).toBe('');
  });

  it('多动画：每个块一条 @keyframes + 一条逗号简写规则', () => {
    const a = createCustomAnimation('a1', MULTI_CSS, { animation: MULTI_ANIM });
    const css = animationStyleSheet(docWith([a]));
    expect(css).toContain('@keyframes artmatic-a-a1-pulse{from{opacity:1}to{opacity:0.3}}');
    expect(css).toContain('@keyframes artmatic-a-a1-glow{from{filter:blur(0)}to{filter:blur(6px)}}');
    expect(css).toContain(
      '[data-anim-id="a1"]{animation:artmatic-a-a1-pulse 1s ease-in-out infinite, artmatic-a-a1-glow 2s linear 0.5s}',
    );
  });

  it('引用预设名 → 发出该预设的 keyframes（命名空间化）', () => {
    const a = createCustomAnimation('a1', '', { animation: 'fade-in 1s, spin 2s' });
    const css = animationStyleSheet(docWith([a]));
    expect(css).toContain('@keyframes artmatic-a-a1-p-fade-in{from{opacity:0}to{opacity:1}}');
    expect(css).toContain('@keyframes artmatic-a-a1-p-spin{from{transform:rotate(0)}to{transform:rotate(360deg)}}');
    expect(css).toContain('[data-anim-id="a1"]{animation:artmatic-a-a1-p-fade-in 1s, artmatic-a-a1-p-spin 2s}');
  });

  it('两个元素各自的 @keyframes pulse 互不覆盖（元素级命名空间）', () => {
    const d = createTypographyDocument({ w: 100, h: 100 });
    const a1 = createCustomAnimation('a1', '@keyframes pulse{from{opacity:1}to{opacity:0}}', {
      animation: 'pulse 1s',
    });
    const a2 = createCustomAnimation('a2', '@keyframes pulse{from{opacity:1}to{opacity:0.1}}', {
      animation: 'pulse 1s',
    });
    d.elements = [
      createTextElement(d.size, { id: 'e1', animations: [a1] }),
      createTextElement(d.size, { id: 'e2', animations: [a2] }),
    ];
    const css = animationStyleSheet(d);
    expect(css).toContain('@keyframes artmatic-a-a1-pulse{from{opacity:1}to{opacity:0}}');
    expect(css).toContain('@keyframes artmatic-a-a2-pulse{from{opacity:1}to{opacity:0.1}}');
    expect(css).not.toContain('@keyframes pulse{');
  });

  it('手写 CSS 里的顶层选择器在写入前被拒（不进样式表）', () => {
    expect(parseCustomCss('@keyframes x{a:0}body{display:none}animation: x 1s;')).toEqual({
      ok: false,
      reason: 'badSelector',
    });
    // 即便有非法内容漏进了文档，旧单 body 形态也只会被**包进** @keyframes 块里，
    // 出不了块、更成不了顶层规则。
    const bad = createCustomAnimation('bad', '}body{display:none}');
    expect(animationStyleSheet(docWith([bad]))).toBe('');
  });
});

describe('docIsAnimated', () => {
  it('无动画 → false（决定缓存键要不要带帧号）', () => {
    const d = createTypographyDocument({ w: 100, h: 100 });
    d.elements = [createTextElement(d.size)];
    expect(docIsAnimated(d)).toBe(false);
  });

  it('任一元素有动画 → true', () => {
    const d = createTypographyDocument({ w: 100, h: 100 });
    d.elements = [createTextElement(d.size), createTextElement(d.size, { animations: [fadeIn()] })];
    expect(docIsAnimated(d)).toBe(true);
  });
});

describe('keyframeBodyOf / defaultTiming', () => {
  it('custom 走清洗、preset 走预设表', () => {
    expect(keyframeBodyOf(createCustomAnimation('c', 'from{a:0}to{a:1}'))).toBe('from{a:0}to{a:1}');
    expect(keyframeBodyOf(createPresetAnimation('pulse', 'p'))).toContain('50%');
  });

  it('多动画条目 → 块 + animation 简写（供编辑器预填并往返）', () => {
    const a = createCustomAnimation('a1', MULTI_CSS, { animation: MULTI_ANIM });
    expect(keyframeBodyOf(a)).toBe(`${MULTI_CSS}\nanimation: ${MULTI_ANIM};`);
    expect(parseCustomCss(keyframeBodyOf(a))).toEqual({ ok: true, css: MULTI_CSS, animation: MULTI_ANIM });
  });

  it('默认时序是确定的（不能依赖当前时间）', () => {
    expect(defaultTiming()).toEqual(defaultTiming());
    expect(defaultTiming().delay).toBe(0);
  });
});

describe('createCustomAnimation', () => {
  it('animation 缺省时不写字段（旧形态）', () => {
    expect('animation' in createCustomAnimation('c', 'from{a:0}to{a:1}')).toBe(false);
  });

  it('animation 给定（非空）时写入', () => {
    const a = createCustomAnimation('c', '', { animation: 'fade-in 1s' });
    expect(a.animation).toBe('fade-in 1s');
  });

  it('空 animation 串不写入（与缺省同义）', () => {
    expect('animation' in createCustomAnimation('c', 'from{a:0}to{a:1}', { animation: '' })).toBe(false);
  });
});

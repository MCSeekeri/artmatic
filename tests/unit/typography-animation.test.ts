import { describe, expect, it } from 'vitest';
import {
  animationCurrentTimeMs,
  animationName,
  animationShorthand,
  animationStyleSheet,
  createCustomAnimation,
  createPresetAnimation,
  defaultTiming,
  docIsAnimated,
  isAnimationActiveAt,
  isValidKeyframeBody,
  keyframeBodyOf,
  presetKeyframes,
  sanitizeKeyframeBody,
} from '../../src/typography/animation';
import { createTextElement, createTypographyDocument } from '../../src/typography/document';
import type { ElementAnimation } from '../../src/typography/animation';

const fadeIn = () => createPresetAnimation('fade-in', 'a1', { delay: 0.2, duration: 0.6 });

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
      expect(isValidKeyframeBody(body)).toBe(true);
    }
  });
});

describe('sanitizeKeyframeBody', () => {
  it('放行合法的 keyframes 体（内部本来就有成对花括号）', () => {
    expect(sanitizeKeyframeBody('from{opacity:0}to{opacity:1}')).toBe('from{opacity:0}to{opacity:1}');
    expect(sanitizeKeyframeBody('0%{top:0}50%{top:10px}100%{top:0}')).toContain('50%');
  });

  it('剥掉 @import / @charset（离线与确定性硬要求）', () => {
    const s = sanitizeKeyframeBody('@import url(http://evil/x.css);from{opacity:0}to{opacity:1}');
    expect(s).not.toContain('@import');
    expect(s).not.toContain('evil');
    expect(s).toContain('to{opacity:1}');
    expect(sanitizeKeyframeBody('@charset "utf-8";from{opacity:0}to{opacity:1}')).not.toContain('@charset');
  });

  it('剥掉标签，堵住 </style> 注入', () => {
    const s = sanitizeKeyframeBody('from{opacity:0}to{opacity:1}</style><script>x</script>');
    expect(s).not.toContain('<');
    expect(s).not.toContain('script');
  });

  it('花括号提前闭合 → 判为非法（这是唯一能逃出 @keyframes 块的方式）', () => {
    expect(sanitizeKeyframeBody('from{opacity:0}}body{display:none}')).toBe('');
    expect(isValidKeyframeBody('}*{color:red}')).toBe(false);
  });

  it('花括号没配平 → 判为非法', () => {
    expect(sanitizeKeyframeBody('from{opacity:0')).toBe('');
    expect(sanitizeKeyframeBody('from{{opacity:0}')).toBe('');
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

describe('animationStyleSheet', () => {
  function docWith(animations: ElementAnimation[]) {
    const d = createTypographyDocument({ w: 100, h: 100 });
    d.elements = [createTextElement(d.size, { id: 'e1', animations })];
    return d;
  }

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

  it('默认时序是确定的（不能依赖当前时间）', () => {
    expect(defaultTiming()).toEqual(defaultTiming());
    expect(defaultTiming().delay).toBe(0);
  });
});

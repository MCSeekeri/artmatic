import { describe, expect, it } from 'vitest';
import {
  animationStyleSheet,
  createTracksAnimation,
  customSubAnimations,
  keyframeBodyOf,
} from '../../src/typography/animation';
import {
  applyTrackTiming,
  channelDeclaration,
  CHANNEL_META,
  identityValue,
  isValidPropName,
  isValidPropValue,
  normalizeKeys,
  trackSpan,
} from '../../src/typography/animation-tracks';
import { createTextElement, createTypographyDocument } from '../../src/typography/document';
import type { ElementAnimation } from '../../src/typography/animation';

/**
 * 结构化轨道（`kind: 'tracks'`）的发射与整理。
 *
 * 钉住四件事：
 *  1. **绝对秒 → 百分比**：`delay = 第一帧`、`duration = 最后一帧 − 第一帧`；
 *  2. **逐段缓动**只写在非末帧（`animation-timing-function` 是出向语义）；
 *  3. **多属性异步** = 多条动画（同元素两条规则、各自 delay）；
 *  4. **闸门**：非法属性名 / 值不发射，且不会污染那份唯一的样式表。
 */

function docWith(animations: ElementAnimation[]) {
  const d = createTypographyDocument({ w: 100, h: 100 });
  d.elements = [createTextElement(d.size, { id: 'e1', animations })];
  return d;
}

const sheet = (a: ElementAnimation): string => animationStyleSheet(docWith([a]));

describe('tracks：绝对秒 → 百分比', () => {
  it('delay = 第一帧、duration = 最后一帧 − 第一帧', () => {
    const a = createTracksAnimation('t1', 'x', [
      { t: 1, v: 0 },
      { t: 3, v: 120 },
    ]);
    expect(a.delay).toBe(1);
    expect(a.duration).toBe(2);
    const css = sheet(a);
    expect(css).toContain('@keyframes artmatic-a-t1{0%{transform:translateX(0px)}100%{transform:translateX(120px)}}');
    expect(css).toContain('[data-anim-id="t1"]{animation:artmatic-a-t1 2s ease-out 1s 1 normal both}');
  });

  it('中间帧按真正的时间比例落位', () => {
    const css = sheet(
      createTracksAnimation('t1', 'y', [
        { t: 0, v: 0 },
        { t: 1, v: 50 },
        { t: 2, v: 0 },
      ]),
    );
    expect(css).toContain('0%{transform:translateY(0px)}50%{transform:translateY(50px)}100%{transform:translateY(0px)}');
  });

  it('乱序 / 同一刻重复的帧会被整理（后者胜出）', () => {
    expect(normalizeKeys([{ t: 2, v: 2 }, { t: 0, v: 0 }, { t: 2, v: 9 }])).toEqual([
      { t: 0, v: 0 },
      { t: 2, v: 9 },
    ]);
    expect(normalizeKeys([{ t: -5, v: 1 }])[0]!.t).toBe(0);
  });

  it('单帧退化成 0%,100% 同值，时长不为 0（0 跨度会被浏览器丢掉）', () => {
    const a = createTracksAnimation('t1', 'rot', [{ t: 2, v: 90 }]);
    expect(a.delay).toBe(2);
    expect(a.duration).toBeCloseTo(1e-3, 6);
    expect(sheet(a)).toContain('0%,100%{transform:rotate(90deg)}');
  });

  it('trackSpan 空轨道是 0/0', () => {
    expect(trackSpan([])).toEqual({ delay: 0, duration: 0 });
  });

  it('applyTrackTiming 把派生时序回填（Ribbon / seek 读的就是这两个字段）', () => {
    const a = createTracksAnimation('t1', 'opacity', [{ t: 0, v: 1 }]);
    a.keys = [
      { t: 4, v: 0 },
      { t: 2, v: 1 },
    ];
    applyTrackTiming(a);
    expect(a.keys.map((k) => k.t)).toEqual([2, 4]);
    expect(a.delay).toBe(2);
    expect(a.duration).toBe(2);
  });
});

describe('tracks：逐段缓动是出向语义', () => {
  it('非末帧写 animation-timing-function，末帧不写', () => {
    const css = sheet(
      createTracksAnimation('t1', 'opacity', [
        { t: 0, v: 0, ease: [0.2, 0, 0.2, 1] },
        { t: 1, v: 1, ease: 'linear' },
      ]),
    );
    expect(css).toContain('0%{opacity:0;animation-timing-function:cubic-bezier(0.2,0,0.2,1)}');
    expect(css).toContain('100%{opacity:1}}');
    expect(css).not.toContain('100%{opacity:1;animation-timing-function');
  });

  it('缺省（无 ease）时只写声明，继承简写里的 easing', () => {
    const css = sheet(
      createTracksAnimation('t1', 'opacity', [
        { t: 0, v: 0 },
        { t: 1, v: 1 },
      ]),
    );
    expect(css).not.toContain('animation-timing-function');
  });
});

describe('tracks：任意属性与闸门', () => {
  it('任意属性原样发射（值不做单位校验，只做逃逸闸门）', () => {
    const css = sheet(
      createTracksAnimation('t1', 'letter-spacing', [
        { t: 0, v: '0px' },
        { t: 1, v: '4px' },
      ]),
    );
    expect(css).toContain('0%{letter-spacing:0px}100%{letter-spacing:4px}');
  });

  it('属性名带能闭合规则的字符 → 整条不发射', () => {
    const bad = createTracksAnimation('t1', 'color}body{display:none', [
      { t: 0, v: '#fff' },
      { t: 1, v: '#000' },
    ]);
    expect(sheet(bad)).toBe('');
  });

  it('值里出现 ; { } < > url( 或 !important → 整条不发射', () => {
    for (const v of ['red;}', 'red}', '{a:b', '<b>', 'url(http://x/y.png)', 'red !important']) {
      expect(isValidPropValue(v), v).toBe(false);
      const a = createTracksAnimation('t1', 'color', [
        { t: 0, v: 'red' },
        { t: 1, v },
      ]);
      expect(sheet(a), v).toBe('');
    }
  });

  it('行为与动画本身的属性被拒绝（写进去只会覆盖自己的时序）', () => {
    expect(isValidPropName('animation')).toBe(false);
    expect(isValidPropName('animation-duration')).toBe(false);
    expect(isValidPropName('--accent')).toBe(true);
    expect(isValidPropName('letter-spacing')).toBe(true);
  });

  it('数值通道夹取：opacity 0..1、blur 非负', () => {
    expect(channelDeclaration('opacity', 1.4)).toBe('opacity:1');
    expect(channelDeclaration('opacity', -1)).toBe('opacity:0');
    expect(channelDeclaration('blur', -3)).toBe('filter:blur(0px)');
  });

  it('通道恒等值 / 单位是唯一一份（面板与 agent 都读它）', () => {
    expect(identityValue('sx')).toBe(1);
    expect(identityValue('x')).toBe(0);
    expect(identityValue('letter-spacing')).toBe('');
    expect(CHANNEL_META.rot.unit).toBe('°');
  });
});

describe('tracks：一个元素多条动画 = 异步关键帧', () => {
  it('两条动画各发一条 @keyframes 与一条规则（各自的 delay）', () => {
    const d = createTypographyDocument({ w: 100, h: 100 });
    const move = createTracksAnimation('mv', 'y', [
      { t: 0.4, v: 80 },
      { t: 0.9, v: 0 },
    ]);
    const fade = createTracksAnimation('fd', 'opacity', [
      { t: 0, v: 0 },
      { t: 0.5, v: 1 },
    ]);
    d.elements = [createTextElement(d.size, { id: 'e1', animations: [fade, move] })];
    const css = animationStyleSheet(d);
    expect(css).toContain('animation:artmatic-a-fd 0.5s ease-out 0s 1 normal both');
    expect(css).toContain('animation:artmatic-a-mv 0.5s ease-out 0.4s 1 normal both');
  });

  it('seek 用的 part 只有一条，delay 取自派生值（不然异步会被压成同一刻）', () => {
    const a = createTracksAnimation('t1', 'x', [
      { t: 1, v: 0 },
      { t: 3, v: 120 },
    ]);
    expect(customSubAnimations(a)).toEqual([
      { name: 'artmatic-a-t1', delay: 1, duration: 2, iterations: 1 },
    ]);
  });

  it('keyframeBodyOf 给出真正会跑的那份体（手写 CSS 弹窗可编辑）', () => {
    const a = createTracksAnimation('t1', 'x', [
      { t: 0, v: 0 },
      { t: 1, v: 10 },
    ]);
    expect(keyframeBodyOf(a)).toBe('0%{transform:translateX(0px)}100%{transform:translateX(10px)}');
  });
});

import { describe, expect, it } from 'vitest';
import {
  customToTracks,
  migrateAnimations,
  migrateProjectAnimations,
  parseEase,
  parseKeyframeBody,
  presetToTracks,
  type MigrationReport,
} from '../../src/typography/animation-migrate';
import { createCustomAnimation, createPresetAnimation } from '../../src/typography/animation';

/**
 * v17 迁移：旧动画（preset / custom）→ 结构化轨道。
 *
 * 迁移的承诺只有两条，两条都必须钉住：
 *  1. **画面不变**：属性值、时间、迭代、方向、填充都得原样搬过去；
 *  2. **确定**：同一份输入跑两遍结果逐字节相同（迁移会在每次打开时跑）。
 * 另外「拆不动就不拆」——`transform` 里出现不认识的函数时整条保留为原始属性，
 * 宁可不可编辑也不要改画面。
 */

const report = (): MigrationReport => ({ dropAnimations: [], dropProps: [] });

describe('preset → tracks', () => {
  it('fade-in → 一条 opacity，时间按 delay/duration 落位', () => {
    const a = createPresetAnimation('fade-in', 'a1', { delay: 0.2, duration: 0.6 });
    const tracks = presetToTracks(a, report());
    expect(tracks).toHaveLength(1);
    const t = tracks[0]!;
    expect(t.kind).toBe('tracks');
    expect(t.id).toBe('a1-opacity');
    expect(t.prop).toBe('opacity');
    expect(t.keys).toEqual([
      { t: 0.2, v: 0, ease: null },
      { t: 0.8, v: 1, ease: null },
    ]);
    // 派生时序与旧字段一致 ⇒ Ribbon / seek 读到的时长不变。
    expect(t.delay).toBe(0.2);
    expect(t.duration).toBeCloseTo(0.6, 6);
  });

  it('slide-in-left → x + opacity 两条', () => {
    const tracks = presetToTracks(createPresetAnimation('slide-in-left', 'a1'), report());
    expect(tracks.map((t) => t.prop).sort()).toEqual(['opacity', 'x']);
    const x = tracks.find((t) => t.prop === 'x')!;
    expect(x.keys.map((k) => k.v)).toEqual([-80, 0]);
  });

  it('zoom-in → sx + sy + opacity（scale 拆成两个通道）', () => {
    const tracks = presetToTracks(createPresetAnimation('zoom-in', 'a1'), report());
    expect(tracks.map((t) => t.prop).sort()).toEqual(['opacity', 'sx', 'sy']);
    expect(tracks.find((t) => t.prop === 'sx')!.keys.map((k) => k.v)).toEqual([0.8, 1]);
  });

  it('blur-in → blur + opacity', () => {
    const tracks = presetToTracks(createPresetAnimation('blur-in', 'a1'), report());
    expect(tracks.map((t) => t.prop).sort()).toEqual(['blur', 'opacity']);
    expect(tracks.find((t) => t.prop === 'blur')!.keys.map((k) => k.v)).toEqual([12, 0]);
  });

  it('14 个预设全部能转，且不丢声明', () => {
    const presets = [
      'fade-in', 'fade-out', 'fade-in-out',
      'slide-in-left', 'slide-in-right', 'slide-in-up', 'slide-in-down',
      'zoom-in', 'zoom-out', 'pop', 'spin', 'pulse', 'shake', 'blur-in',
    ] as const;
    for (const p of presets) {
      const r = report();
      const tracks = presetToTracks(createPresetAnimation(p, `a-${p}`), r);
      expect(tracks.length, p).toBeGreaterThan(0);
      expect(r.dropProps, p).toEqual([]);
      expect(r.dropAnimations, p).toEqual([]);
    }
  });
});

describe('custom → tracks', () => {
  it('多动画简写：每段各自成组，delay 取自简写', () => {
    const css = '@keyframes pulse{from{opacity:1}to{opacity:0.3}}@keyframes glow{from{filter:blur(0)}to{filter:blur(6px)}}';
    const anim = createCustomAnimation('c1', css, { animation: 'pulse 1s ease-in-out infinite, glow 2s linear 0.5s' });
    const tracks = customToTracks(anim, report());
    expect(tracks.map((t) => [t.id, t.prop, t.delay, t.duration, t.iterations])).toEqual([
      ['c1-opacity', 'opacity', 0, 1, Infinity],
      ['c1-1-blur', 'blur', 0.5, 2, 1],
    ]);
  });

  it('旧单 body 形态：时间用条目自己的 delay/duration', () => {
    const anim = createCustomAnimation('c1', 'from{opacity:0}to{opacity:1}', { delay: 0.3, duration: 0.4 });
    const tracks = customToTracks(anim, report());
    expect(tracks).toHaveLength(1);
    expect(tracks[0]!.keys).toEqual([
      { t: 0.3, v: 0, ease: null },
      { t: 0.7, v: 1, ease: null },
    ]);
  });

  it('每段 animation-timing-function 收进关键帧的 ease（出向）', () => {
    const css = '0%{opacity:0;animation-timing-function:cubic-bezier(0.2,0,0.2,1)}100%{opacity:1}';
    const anim = createCustomAnimation('c1', css, { duration: 1 });
    const keys = customToTracks(anim, report())[0]!.keys;
    expect(keys[0]!.ease).toEqual([0.2, 0, 0.2, 1]);
    expect(keys[1]!.ease).toBeNull();
  });

  it('transform 里有不认识的函数 → 整条保留成原始属性，不改画面', () => {
    const anim = createCustomAnimation('c1', 'from{transform:translateZ(10px)}to{transform:translateZ(20px)}', { duration: 1 });
    const tracks = customToTracks(anim, report());
    expect(tracks).toHaveLength(1);
    expect(tracks[0]!.prop).toBe('transform');
    expect(tracks[0]!.keys.map((k) => k.v)).toEqual(['translateZ(10px)', 'translateZ(20px)']);
  });

  it('解析不了的 keyframes 块 → 记进报告，不产出轨道', () => {
    const r = report();
    const anim = createCustomAnimation('c1', '@keyframes x{div{opacity:0}}', { animation: 'x 1s' });
    expect(customToTracks(anim, r)).toEqual([]);
    expect(r.dropAnimations).toEqual(['c1#x']);
  });

  it('非法属性名（能闭合规则的）被丢弃并记账', () => {
    const r = report();
    customToTracks(createCustomAnimation('c1', 'from{color:red;]]:1}to{color:blue}', { duration: 1 }), r);
    expect(r.dropProps).toContain(']]');
  });
});

describe('parseKeyframeBody / parseEase', () => {
  it('from / to / 百分比 / 逗号并列都认', () => {
    const frames = parseKeyframeBody('from{opacity:0}0%,100%{opacity:1}50%{opacity:.5}')!;
    expect(frames.map((f) => f.offset)).toEqual([0, 0, 100, 50]);
  });

  it('非法帧选择器 → 整块作废（与浏览器一致）', () => {
    expect(parseKeyframeBody('div{opacity:0}')).toBeNull();
    expect(parseKeyframeBody('from{opacity:0')).toBeNull();
  });

  it('关键字与 cubic-bezier 认，steps() 表达不了', () => {
    expect(parseEase('ease-out')).toBe('ease-out');
    expect(parseEase('cubic-bezier(0.1,0.2,0.3,0.4)')).toEqual([0.1, 0.2, 0.3, 0.4]);
    expect(parseEase('steps(4)')).toBeNull();
  });
});

describe('migrateAnimations / migrateProjectAnimations', () => {
  it('已经是 tracks 的原样返回（幂等）', () => {
    const tracks = presetToTracks(createPresetAnimation('fade-in', 'a1'), report());
    const out = migrateAnimations(tracks, report());
    expect(out).toEqual(tracks);
  });

  it('确定性：同一输入跑两遍逐字节相同', () => {
    const input = [createPresetAnimation('zoom-in', 'a1'), createPresetAnimation('spin', 'a2')];
    const a = JSON.stringify(migrateAnimations(input, report()));
    const b = JSON.stringify(migrateAnimations(input, report()));
    expect(a).toBe(b);
  });

  it('工程级：只碰 text 片段里的 doc，返回新对象且不动入参', () => {
    const preset = createPresetAnimation('fade-in', 'a1', { delay: 0.1, duration: 0.5 });
    const raw = {
      schemaVersion: 16,
      tracks: [
        {
          kind: 'visual',
          clips: [
            { kind: 'source', source: { type: 'text', doc: { elements: [{ id: 'e1', animations: [preset] }] } } },
            { kind: 'source', source: { type: 'algo', generator: 'life' } },
          ],
        },
      ],
    };
    const before = JSON.stringify(raw);
    const { project, report: r } = migrateProjectAnimations(raw);
    expect(JSON.stringify(raw)).toBe(before);
    expect(r.changed).toBe(true);
    const doc = (project.tracks as { clips: { source?: { doc?: { elements: { animations: { kind: string }[] }[] } } }[] }[])[0]!
      .clips[0]!.source!.doc!;
    expect(doc.elements[0]!.animations.map((a) => a.kind)).toEqual(['tracks']);

    // 再跑一遍：已经全是 tracks ⇒ changed 为 false（不白白重写工程文件）。
    expect(migrateProjectAnimations(project).report.changed).toBe(false);
  });

  it('没有排版文档的工程原样返回', () => {
    const raw = { schemaVersion: 16, tracks: [{ kind: 'audio', clips: [] }] };
    const { project, report: r } = migrateProjectAnimations(raw);
    expect(r.changed).toBe(false);
    expect(project).toBe(raw);
  });
});

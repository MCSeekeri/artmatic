import { describe, expect, it } from 'vitest';
import {
  addGeneratedShape,
  addShapeElement,
  addTextElement,
  animationFromInput,
  animationView,
  applyLayout,
  applyTextFill,
  coerceDocument,
  coercePaint,
  docView,
  elementViewById,
  findTextDoc,
  groupSelection,
  keyframesFromKeys,
  parseAnimationInput,
  patchElement,
  removeElement,
  reorderElement,
  setAnimation,
  setTheme,
  ungroupSelection,
} from '../../src/typography/agent-ops';
import { createTypographyDocument, type TypographyDocument } from '../../src/typography/document';
import { customSubAnimations } from '../../src/typography/animation';
import { SVG_GENERATORS } from '../../src/typography/svg-gen/registry';
import { defaultProject } from '../../src/core/schema';

function doc(size = { w: 1920, h: 1080 }): TypographyDocument {
  return createTypographyDocument(size);
}

describe('排版写入原语', () => {
  it('加文字：frame / 样式 / 文本都能落进去', () => {
    const d = doc();
    const el = addTextElement(d, {
      text: '标题',
      frame: { x: 100, y: 80, w: 600, h: 120 },
      style: { fontSize: 96, fontWeight: 800, align: 'left' },
    });
    expect(d.elements).toHaveLength(1);
    expect(el.runs.flatMap((r) => r.text).join('')).toBe('标题');
    expect(el.frame).toMatchObject({ x: 100, y: 80, w: 600, h: 120 });
    expect(el.style.fontSize).toBe(96);
    expect(el.style.align).toBe('left');
  });

  it('尺寸钳到 ≥1，坐标保留两位小数', () => {
    const d = doc();
    const el = addTextElement(d, { text: 'x', frame: { w: 0, h: -5, x: 1.23456 } });
    expect(el.frame.w).toBe(1);
    expect(el.frame.h).toBe(1);
    expect(el.frame.x).toBe(1.23);
  });

  it('加图形：未知 shape 抛错（在校验期，不在渲染期）', () => {
    const d = doc();
    expect(() => addShapeElement(d, { shape: 'not-a-shape' })).toThrow();
    expect(d.elements).toHaveLength(0);
  });

  it('图形：agent 造的默认是空的（无填充、无描边）；显式 fill 仍然优先', () => {
    const d = doc();
    const outlined = addShapeElement(d, {
      shape: 'frame',
      stroke: { color: '#ffffff', width: 2 },
    });
    expect(outlined.fill).toEqual({ kind: 'none' });

    const filled = addShapeElement(d, {
      shape: 'frame',
      fill: { kind: 'solid', color: '#123456' },
      stroke: { color: '#ffffff', width: 2 },
    });
    expect(filled.fill).toEqual({ kind: 'solid', color: '#123456' });

    /*
     * 什么装饰都不给 ⇒ 透明填充 + 无描边。
     *
     * 面板里新建形状是实心紫，但那条路径服务的是「人先看见它、再改颜色」；
     * agent 的默认值必须**不改变画面**，否则一张合成图会被一块没打算要的紫
     * 染掉，而 640 宽的截图里根本分辨不出「这是我要的紫还是默认紫」。
     */
    const bare = addShapeElement(d, { shape: 'rect' });
    expect(bare.fill).toEqual({ kind: 'none' });
    expect(bare.stroke).toBeNull();

    // line 在工厂里会带一条白色 4px 描边；只给 fill 的调用方不该继承它。
    const line = addShapeElement(d, { shape: 'line', fill: { kind: 'solid', color: '#ffffff' } });
    expect(line.stroke).toBeNull();
  });

  it('文字：纯色 fill 写成 style.color，渐变才留在 fill', () => {
    const d = doc();
    const el = addTextElement(d, {
      text: 'NOISE',
      style: { color: '#ffffff' },
      fill: { kind: 'solid', color: '#0b0d12' },
    });
    expect(el.fill).toBeUndefined();
    expect(el.style.color).toBe('#0b0d12');

    const gradient = addTextElement(d, {
      text: '标题',
      fill: { kind: 'linear', stops: [{ offset: 0, color: '#ff0000' }, { offset: 1, color: '#0000ff' }] },
    });
    expect(gradient.fill?.kind).toBe('linear');
  });

  it('文字：patch 的纯色 fill 同样落到 style.color；无 kind 的局部补丁沿用原类型', () => {
    const d = doc();
    const el = addTextElement(d, {
      text: 'x',
      fill: { kind: 'linear', stops: [{ offset: 0, color: '#ff0000' }, { offset: 1, color: '#0000ff' }] },
    });
    expect(patchElement(d, el.id, { fill: { color: '#00ff00' } })).toBe(true);
    expect(el.fill?.kind).toBe('linear');
    expect(patchElement(d, el.id, { fill: { kind: 'solid', color: '#abcdef' } })).toBe(true);
    expect(el.fill).toBeUndefined();
    expect(el.style.color).toBe('#abcdef');
  });

  it('applyTextFill：null / none 清掉渐变，回到 style.color', () => {
    const d = doc();
    const el = addTextElement(d, {
      text: 'x',
      fill: { kind: 'radial', stops: [{ offset: 0, color: '#fff' }, { offset: 1, color: '#000' }] },
    });
    expect(applyTextFill(el, null)).toBe(true);
    expect(el.fill).toBeUndefined();
    expect(applyTextFill(el, { kind: 'none' })).toBe(false);
  });

  it('程序化图形：给了 stroke 又没给 fill 也默认无填充', () => {
    const d = doc();
    const spec = SVG_GENERATORS[0]!;
    const el = addGeneratedShape(d, {
      genId: spec.id,
      seed: 42,
      stroke: { color: '#ffffff', width: 3 },
    });
    // 线族本来就是 none；其余生成器走「显式描边 ⇒ 无填充」这条。
    expect(el.fill).toEqual({ kind: 'none' });
  });

  it('程序化图形自带 gen 状态，路径非空', () => {
    const d = doc();
    const spec = SVG_GENERATORS[0]!;
    const el = addGeneratedShape(d, { genId: spec.id, seed: 42 });
    expect(el.shape).toBe('svg');
    expect(el.path && el.path.length > 0).toBe(true);
    expect(el.gen?.id).toBe(spec.id);
    expect(el.gen?.seed).toBe(42);
    // 全量参数（合并默认值后）都落库，跨版本可复现
    expect(Object.keys(el.gen?.params ?? {}).length).toBe(spec.params.length);
  });

  it('未知生成器抛错', () => {
    const d = doc();
    expect(() => addGeneratedShape(d, { genId: 'nope' })).toThrow();
  });

  it('patch：未知键被忽略，文本可以替换', () => {
    const d = doc();
    const el = addTextElement(d, { text: 'old' });
    expect(patchElement(d, el.id, { notAField: 1 })).toBe(false);
    expect(patchElement(d, el.id, { text: 'new' })).toBe(true);
    expect(el.runs.flatMap((r) => r.text).join('')).toBe('new');
  });

  it('patch：opacity / blend / frame 都有钳制', () => {
    const d = doc();
    const el = addTextElement(d, { text: 'x' });
    patchElement(d, el.id, { opacity: 5, blend: 'multiply', frame: { rot: 0.5 } });
    expect(el.opacity).toBe(1);
    expect(el.blend).toBe('multiply');
    expect(el.frame.rot).toBe(0.5);
  });

  it('层级调整保持单元素语义', () => {
    const d = doc();
    const a = addTextElement(d, { text: 'a' });
    const b = addTextElement(d, { text: 'b' });
    expect(reorderElement(d, a.id, 'front')).toBe(true);
    expect(d.elements[d.elements.length - 1]!.id).toBe(a.id);
    expect(d.elements[0]!.id).toBe(b.id);
  });

  it('删元素与主题切换', () => {
    const d = doc();
    const el = addTextElement(d, { text: 'x' });
    expect(removeElement(d, el.id)).toBe(true);
    expect(d.elements).toHaveLength(0);
    setTheme(d, 'office');
    expect(d.theme).toBe('office');
  });
});

describe('布局', () => {
  it('grid 把元素摆进等宽格子（保持尺寸）', () => {
    const d = doc({ w: 1000, h: 1000 });
    const els = [0, 1, 2, 3].map((i) =>
      addTextElement(d, { text: `t${i}`, frame: { w: 100, h: 50, x: 0, y: 0 } }),
    );
    const moved = applyLayout(d, { op: 'grid', cols: 2, gap: 20, margin: 40 });
    expect(moved).toBe(4);
    expect(els[0]!.frame.x).toBeLessThan(els[1]!.frame.x);
    // 同一行（0/1）y 相同，下一行（2）更大
    expect(els[0]!.frame.y).toBe(els[1]!.frame.y);
    expect(els[2]!.frame.y).toBeGreaterThan(els[0]!.frame.y);
    expect(els[0]!.frame.w).toBe(100);
    // 所有元素都落在画布内
    for (const el of els) {
      expect(el.frame.x).toBeGreaterThanOrEqual(0);
      expect(el.frame.y).toBeGreaterThanOrEqual(0);
      expect(el.frame.x + el.frame.w).toBeLessThanOrEqual(1000);
    }
  });

  it('align center-h 把元素对准画布中线', () => {
    const d = doc({ w: 1000, h: 1000 });
    const el = addTextElement(d, { text: 'x', frame: { x: 10, y: 10, w: 200, h: 100 } });
    applyLayout(d, { op: 'align', axis: 'center-h', elementIds: [el.id] });
    expect(el.frame.x).toBe(400);
  });

  it('distribute 少于 3 个元素时不动', () => {
    const d = doc();
    const a = addTextElement(d, { text: 'a' });
    addTextElement(d, { text: 'b' });
    expect(applyLayout(d, { op: 'distribute', axis: 'h' })).toBe(0);
    expect(a.frame.x).toBeGreaterThanOrEqual(0);
  });

  it('锁定的元素不参与布局', () => {
    const d = doc({ w: 1000, h: 1000 });
    const el = addTextElement(d, { text: 'x', frame: { x: 0, y: 0, w: 100, h: 100 } });
    el.locked = true;
    applyLayout(d, { op: 'align', axis: 'center-h' });
    expect(el.frame.x).toBe(0);
  });
});

describe('组合', () => {
  it('成组 → 成员连续 → 解组', () => {
    const d = doc();
    const a = addTextElement(d, { text: 'a' });
    addTextElement(d, { text: 'b' });
    const c = addTextElement(d, { text: 'c' });
    const gid = groupSelection(d, [a.id, c.id], 'G');
    expect(gid).toBeTruthy();
    expect(d.groups?.some((g) => g.id === gid)).toBe(true);
    expect(ungroupSelection(d, [a.id])).toBe(true);
    expect(d.groups?.length ?? 0).toBe(0);
  });
});

describe('视图', () => {
  it('ids 档只给 id / kind / name / frame', () => {
    const d = doc();
    addTextElement(d, { text: 'hello' });
    const view = docView(d, 'clip-1', 'ids');
    expect(view.elements).toHaveLength(1);
    const el = view.elements[0] as Record<string, unknown>;
    expect(Object.keys(el).sort()).toEqual(['frame', 'id', 'kind', 'name']);
  });

  it('full 档带文本、样式与背景', () => {
    const d = doc();
    addTextElement(d, { text: 'hello' });
    const view = docView(d, 'clip-1', 'full');
    const el = view.elements[0] as Record<string, unknown>;
    expect(el.text).toBe('hello');
    expect(el.style).toBeTruthy();
    expect(view.background).toBeTruthy();
  });
});

describe('不可信文档的降级', () => {
  it('坏元素被丢弃，不是整份失败', () => {
    const fallback = doc();
    const out = coerceDocument(
      {
        size: { w: 800, h: 600 },
        elements: [
          { kind: 'text', text: 'ok', frame: { x: 0, y: 0, w: 100, h: 40 } },
          { kind: 'shape', shape: 'not-a-shape' },
          { kind: 'image' }, // 缺 assetId
          'garbage',
          { kind: 'bogus' },
        ],
      },
      fallback,
    );
    expect(out.size).toEqual({ w: 800, h: 600 });
    expect(out.elements).toHaveLength(1);
    expect(out.elements[0]!.kind).toBe('text');
  });

  it('空白文档回落 fallback，不抛', () => {
    const fallback = doc();
    expect(coerceDocument(null, fallback)).toBe(fallback);
    expect(coerceDocument([1, 2, 3], fallback)).toBe(fallback);
  });

  it('Paint 的坏 shape 降级成 none（不抛）', () => {
    expect(coercePaint({ kind: 'wat' })).toEqual({ kind: 'none' });
    expect(coercePaint(null)).toEqual({ kind: 'none' });
    expect(coercePaint({ kind: 'solid', color: '#ff0000' })).toEqual({ kind: 'solid', color: '#ff0000' });
  });
});

describe('findTextDoc', () => {
  it('从工程里定位文本片段的文档', () => {
    const project = defaultProject();
    const textDoc = doc();
    const track = {
      id: 'track-1',
      kind: 'visual' as const,
      name: 'V1',
      enabled: true,
      clips: [
        {
          kind: 'source' as const,
          id: 'clip-text',
          start: 0,
          end: 2,
          label: 'text',
          fadeSec: 0,
          curves: {},
          source: { type: 'text' as const, doc: textDoc },
          blend: 'normal' as const,
          opacity: 1,
          transform: { x: 0.5, y: 0.5, sx: 1, sy: 1, rot: 0 },
          fit: 'contain' as const,
        },
      ],
    };
    project.tracks.push(track);
    expect(findTextDoc(project, 'clip-text')).toBe(textDoc);
    expect(findTextDoc(project, 'nope')).toBeNull();
  });
});

/* ------------------------------------- full 视图的健壮性 / 未知键回报（反馈第 6 条） */

describe('full 视图不因缺字段而崩', () => {
  it('缺 fonts / elements 的旧文档也能给出 full 视图', () => {
    // 手改 JSON 或更早版本的文档确实会缺这些（类型上是必填，磁盘上不一定）。
    const broken = { size: { w: 800, h: 600 }, background: { kind: 'none' } } as unknown as TypographyDocument;
    const view = docView(broken, 'clip-1', 'full');
    expect(view.elements).toEqual([]);
    expect(view.fonts).toEqual([]);
    // 抛错的话 agent 拿不到任何元素 —— 这条是实际发生过的 `internal`。
    expect(view.groups).toEqual([]);
  });

  it('元素缺 animations 时视图仍然给出（不读 undefined.length）', () => {
    const d = doc();
    const el = addTextElement(d, { text: 'x' });
    delete (el as unknown as Record<string, unknown>).animations;
    const view = docView(d, 'clip-1', 'full');
    const first = view.elements[0] as Record<string, unknown>;
    expect(first.animations).toBeUndefined();
    expect(first.text).toBe('x');
  });
});

describe('整份替换：未知键与动画', () => {
  it('未知键逐条进 droppedKeys（不再静默归一化）', () => {
    const report = { droppedKeys: [] as string[], droppedAnimations: [] as string[] };
    const out = coerceDocument(
      {
        size: { w: 800, h: 600 },
        colour: '#fff',
        elements: [{ kind: 'text', text: 'ok', foo: 1, colour: '#f00' }],
      },
      doc(),
      report,
    );
    expect(out.elements).toHaveLength(1);
    expect(report.droppedKeys).toContain('colour');
    expect(report.droppedKeys).toContain('elements[0].foo');
    expect(report.droppedKeys).toContain('elements[0].colour');
  });

  it('动画会被保留（换文档不等于清掉动画）', () => {
    const out = coerceDocument(
      {
        size: { w: 800, h: 600 },
        elements: [
          {
            kind: 'text',
            text: 'hi',
            animations: [{ preset: 'fade-in', duration: 0.4 }],
          },
        ],
      },
      doc(),
    );
    const anims = out.elements[0]!.animations;
    expect(anims).toHaveLength(1);
    // 预设**展开成结构化轨道**（一条动画一个属性），不是留一个只读的 preset 条目。
    expect(anims[0]!.kind).toBe('tracks');
    expect(anims[0]!.duration).toBeCloseTo(0.4, 6);
  });

  it('自定义 CSS 动画也能整份搬过去，坏条目单独报 droppedAnimations', () => {
    const report = { droppedKeys: [] as string[], droppedAnimations: [] as string[] };
    const out = coerceDocument(
      {
        size: { w: 800, h: 600 },
        elements: [
          {
            kind: 'text',
            text: 'hi',
            animations: [
              { css: 'from{opacity:0}to{opacity:1}' },
              { css: 'div{color:red}' },
              { preset: 'not-a-preset' },
            ],
          },
        ],
      },
      doc(),
      report,
    );
    const anims = out.elements[0]!.animations;
    expect(anims).toHaveLength(1);
    expect(anims[0]!.kind).toBe('custom');
    expect(report.droppedAnimations).toEqual(['elements[0].animations[1]', 'elements[0].animations[2]']);
  });

  it('白名单只放实现真的会读的键：natural 会进 droppedKeys，runs 会被保留', () => {
    const report = { droppedKeys: [] as string[], droppedAnimations: [] as string[] };
    const out = coerceDocument(
      {
        size: { w: 800, h: 600 },
        elements: [
          { kind: 'text', text: 'hi', runs: [{ text: 'hi' }] },
          { kind: 'image', assetId: 'a', natural: { w: 10, h: 10 } },
        ],
      },
      doc(),
      report,
    );
    // 行内富文本现在真的会读（不再是「放行但不处理」）。
    expect(report.droppedKeys).not.toContain('elements[0].runs');
    expect(out.elements[0]!.kind === 'text' && out.elements[0]!.runs[0]!.text).toBe('hi');
    expect(report.droppedKeys).toContain('elements[1].natural');
  });
});

describe('动画原语', () => {
  it('keys → @keyframes 体：每一帧都写全被用到的属性', () => {
    const body = keyframesFromKeys([
      { at: 0, opacity: 0, y: 40, sx: 0.8 },
      { at: 1, opacity: 1, y: 0, sx: 1 },
    ])!;
    expect(body).toContain('0%{opacity:0;transform:translate(0px,40px) scale(0.8,0.8) rotate(0deg)}');
    expect(body).toContain('100%{opacity:1;transform:translate(0px,0px) scale(1,1) rotate(0deg)}');
    // 没写 blur ⇒ 不生成 filter（否则会把元素基础滤镜覆盖成 0）。
    expect(body).not.toContain('filter');
  });

  it('未知 preset / 少于两个 key / 非法 loop 一律返回 null（由调用方报错）', () => {
    expect(animationFromInput({ preset: 'slideInUp' })).toBeNull();
    expect(animationFromInput({ keys: [{ at: 0, opacity: 0 }] })).toBeNull();
    expect(animationFromInput({ preset: 'fade-in', loop: -2 })).toBeNull();
    expect(animationFromInput({ preset: 'fade-in' })).toBeTruthy();
  });

  it('setAnimation：replace 覆盖，add 叠加，null 清空', () => {
    const d = doc();
    const el = addTextElement(d, { text: 'x' });
    // fade-in 只动 opacity、shake 只动 x ⇒ 各一条轨道。`pop` 会动 sx+sy（两条），
    // 用它会把「replace 后还剩几条」这件事和轨道拆分混在一起。
    setAnimation(el, { preset: 'fade-in' });
    expect(el.animations).toHaveLength(1);
    setAnimation(el, { preset: 'shake' }, 'add');
    expect(el.animations).toHaveLength(2);
    setAnimation(el, { preset: 'fade-in' });
    expect(el.animations).toHaveLength(1);
    setAnimation(el, null);
    expect(el.animations).toHaveLength(0);
  });

  it('旧式 keys 按属性拆成多条轨道：sx / sy 缺一条时互相补齐', () => {
    const d = doc();
    const el = addTextElement(d, { text: 'x' });
    setAnimation(el, {
      keys: [
        { at: 0, opacity: 0, sx: 0.5 },
        { at: 1, opacity: 1, sx: 1 },
      ],
      duration: 0.4,
    });
    expect(el.animations.map((a) => (a.kind === 'tracks' ? a.prop : a.kind)).sort()).toEqual([
      'opacity',
      'sx',
      'sy',
    ]);
    const sx = el.animations.find((a) => a.kind === 'tracks' && a.prop === 'sx');
    expect(sx && sx.kind === 'tracks' && sx.keys.map((k) => k.v)).toEqual([0.5, 1]);
  });

  it('结构化轨道形态：prop + 绝对秒，多条 = 异步', () => {
    const parsed = parseAnimationInput({
      prop: 'y',
      keys: [
        { t: 0.4, v: 60 },
        { t: 1, v: 0, ease: [0.2, 0, 0.2, 1] },
      ],
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const a = parsed.animation;
    expect(a.kind).toBe('tracks');
    if (a.kind !== 'tracks') return;
    expect(a.delay).toBeCloseTo(0.4, 6);
    expect(a.duration).toBeCloseTo(0.6, 6);
    expect(a.keys[1]!.ease).toEqual([0.2, 0, 0.2, 1]);
  });

  it('结构化轨道读回能被原样写回（prop / 绝对秒 / 逐段 easing 都不丢）', () => {
    const first = parseAnimationInput({
      prop: 'opacity',
      keys: [
        { t: 0, v: 0, ease: 'ease-in' },
        { t: 0.6, v: 1 },
      ],
      loop: 'infinite',
      direction: 'alternate',
    });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const again = parseAnimationInput(animationView(first.animation));
    expect(again.ok).toBe(true);
    if (!again.ok) return;
    expect(again.animation.kind).toBe('tracks');
    if (again.animation.kind !== 'tracks') return;
    expect(again.animation.prop).toBe('opacity');
    expect(again.animation.keys).toEqual([
      { t: 0, v: 0, ease: 'ease-in' },
      { t: 0.6, v: 1 },
    ]);
    expect(again.animation.iterations).toBe(Infinity);
    expect(again.animation.direction).toBe('alternate');
  });

  it('自定义 CSS：裸 keyframes 体与「块 + 简写」两种写法都收', () => {
    const legacy = parseAnimationInput({ css: 'from{opacity:0}to{opacity:1}', duration: 0.4 });
    expect(legacy.ok).toBe(true);
    if (legacy.ok) {
      expect(legacy.animation.kind).toBe('custom');
      expect(legacy.animation.duration).toBeCloseTo(0.4, 6);
    }

    const multi = parseAnimationInput({
      css:
        '@keyframes flip{from{transform:rotateY(90deg);opacity:0}to{transform:rotateY(0);opacity:1}}\n' +
        'animation: flip .7s ease-out both;',
    });
    expect(multi.ok).toBe(true);
    if (multi.ok && multi.animation.kind === 'custom') {
      expect(multi.animation.animation).toBe('flip .7s ease-out both');
      expect(multi.animation.duration).toBeCloseTo(0.6, 6); // timing 缺省值，简写自带时序
    }

    // 简写也可以单独给：等价于把它写在 css 末尾。
    const split = parseAnimationInput({
      css: '@keyframes pulse{from{opacity:1}to{opacity:.3}}',
      animation: 'pulse 1s linear infinite',
    });
    expect(split.ok).toBe(true);
    if (split.ok && split.animation.kind === 'custom') {
      expect(split.animation.animation).toBe('pulse 1s linear infinite');
    }
  });

  it('自定义 CSS 被拒时给出**原因**（不是「入参非法」）', () => {
    const selector = parseAnimationInput({ css: 'div{color:red}' });
    expect(selector.ok).toBe(false);
    if (!selector.ok) expect(selector.reason).toBe('badSelector');

    const unbalanced = parseAnimationInput({ css: '@keyframes x{from{opacity:0}' });
    expect(unbalanced.ok).toBe(false);
    if (!unbalanced.ok) expect(unbalanced.reason).toBe('unbalanced');

    const name = parseAnimationInput({
      css: '@keyframes x{from{opacity:0}to{opacity:1}}',
      animation: 'nope 1s',
    });
    expect(name.ok).toBe(false);
    if (!name.ok) expect(name.reason).toBe('unknownName');
  });

  it('读回形状能原样写回：css / 无限循环都不丢', () => {
    const first = parseAnimationInput({
      css: '@keyframes flip{from{transform:rotateY(90deg)}to{transform:rotateY(0)}}',
      animation: 'flip .7s ease-out both',
      iterations: 'infinite',
      delay: 0.2,
    });
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    const again = parseAnimationInput(animationView(first.animation));
    expect(again.ok).toBe(true);
    if (!again.ok) return;
    expect(again.animation.kind).toBe('custom');
    expect(again.animation.delay).toBeCloseTo(0.2, 6);
    expect(again.animation.iterations).toBe(Infinity);
    if (again.animation.kind === 'custom') {
      expect(again.animation.css).toContain('@keyframes flip');
      expect(again.animation.animation).toBe('flip .7s ease-out both');
      /*
       * 实际会跑的子动画来自简写（`.7s`），不是 `duration` 字段 —— 多动画形态下
       * 后者只服务于旧单 body 形态。往返要保住的是**真正跑的那个时长**。
       */
      const subs = customSubAnimations(again.animation);
      expect(subs).toHaveLength(1);
      expect(subs[0]!.duration).toBeCloseTo(0.7, 6);
    }

    // 预设也走同一条往返（`iterations` 是读回名，`loop` 是工具面的名字）。
    const preset = parseAnimationInput({ preset: 'pulse', loop: 'infinite' });
    expect(preset.ok).toBe(true);
    if (!preset.ok) return;
    const presetAgain = parseAnimationInput(animationView(preset.animation));
    expect(presetAgain.ok && presetAgain.animation.iterations).toBe(Infinity);
  });
});

describe('元素属性面：3D / autoHeight / 手写路径', () => {
  it('transform3d 逐层合并、null 关闭，视图读得回来', () => {
    const d = doc();
    const el = addTextElement(d, { text: 'x' });
    patchElement(d, el.id, { transform3d: { rotate: { y: 35 } } });
    expect(el.transform3d?.rotate.y).toBe(35);
    expect(el.transform3d?.perspective).toBe(800); // 没给的键取恒等默认值

    patchElement(d, el.id, { transform3d: { perspective: 1200 } });
    expect(el.transform3d?.rotate.y).toBe(35); // 合并，不清前一次
    expect(el.transform3d?.perspective).toBe(1200);

    // 嵌套对象也只改出现的键：只给 y 不能把 x 拽回 0。
    patchElement(d, el.id, { transform3d: { rotate: { y: 60 } } });
    expect(el.transform3d?.rotate.x).toBe(0);
    patchElement(d, el.id, { transform3d: { rotate: { x: 12 } } });
    expect(el.transform3d?.rotate.y).toBe(60);
    expect(el.transform3d?.rotate.x).toBe(12);

    const view = elementViewById(d, el.id) as Record<string, unknown>;
    expect((view.transform3d as { rotate: { y: number } }).rotate.y).toBe(60);

    patchElement(d, el.id, { transform3d: null });
    expect(el.transform3d).toBeUndefined();
    expect((elementViewById(d, el.id) as Record<string, unknown>).transform3d).toBeUndefined();
  });

  it('新建元素也能带 transform3d / autoHeight / pathUnit（不是只能事后 patch）', () => {
    const d = doc();
    const text = addTextElement(d, {
      text: 'x',
      autoHeight: false,
      transform3d: { rotate: { y: 20 } },
    });
    expect(text.autoHeight).toBe(false);
    expect(text.transform3d?.rotate.y).toBe(20);

    const path = 'M0 0L10 0L10 10Z';
    const shape = addShapeElement(d, { shape: 'svg', path, pathUnit: 'px', clipFrame: true });
    expect(shape.pathUnit).toBe('px');
    expect(shape.clipFrame).toBe(true);
  });

  it('autoHeight 可写可读', () => {
    const d = doc();
    const el = addTextElement(d, { text: 'x' });
    patchElement(d, el.id, { autoHeight: false });
    expect(el.autoHeight).toBe(false);
    expect((elementViewById(d, el.id) as Record<string, unknown>).autoHeight).toBe(false);
  });

  it('path 只在 svg 图形上生效，且写入会清掉 gen（烘焙生成器）', () => {
    const d = doc();
    const el = addGeneratedShape(d, { genId: 'rings', frame: { x: 10, y: 10, w: 300, h: 300 } });
    expect(el.gen).toBeTruthy();
    patchElement(d, el.id, { path: 'M0 0L10 0L10 10Z' });
    expect(el.path).toBe('M0 0L10 0L10 10Z');
    expect(el.gen).toBeUndefined();

    patchElement(d, el.id, { pathUnit: 'px' });
    expect(el.pathUnit).toBe('px');
    patchElement(d, el.id, { pathUnit: 'percent' });
    expect(el.pathUnit).toBeUndefined();

    // 非 svg 图形写 path 是无效的（控制平面会在改动之前报错，见 agent/typography.ts）。
    const rect = addShapeElement(d, { shape: 'rect' });
    patchElement(d, rect.id, { path: 'M0 0Z' });
    expect(rect.path).toBeUndefined();
  });

  it('整份替换搬运 transform3d / autoHeight / pathUnit（漏一个就是静默丢字段）', () => {
    const out = coerceDocument(
      {
        size: { w: 800, h: 600 },
        elements: [
          {
            kind: 'text',
            text: 'hi',
            autoHeight: false,
            transform3d: { rotate: { x: 20 }, origin: { x: 0, y: 1 } },
          },
          {
            kind: 'shape',
            shape: 'svg',
            path: 'M0 0L10 0L10 10Z',
            pathUnit: 'px',
            clipFrame: true,
          },
        ],
      },
      doc(),
    );
    const text = out.elements[0]!;
    expect(text.kind === 'text' && text.autoHeight).toBe(false);
    expect(text.transform3d?.rotate.x).toBe(20);
    expect(text.transform3d?.origin).toEqual({ x: 0, y: 1 });

    const shape = out.elements[1]!;
    expect(shape.kind === 'shape' && shape.pathUnit).toBe('px');
    expect(shape.kind === 'shape' && shape.clipFrame).toBe(true);
  });
});

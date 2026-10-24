/**
 * demo-project.ts — 内置工程工厂（开箱 demo + 空白）。
 *
 * 开箱 demo：24 秒 @120BPM（12 小节），按**每 4 小节一段**排成
 * 「序曲（0–8s） / 发展（8–16s） / 收束（16–24s）」。
 *
 * 它的职责不是「好看」，而是**开箱第一眼就把每条通路都走一遍** ——
 * 任何一条断了都能立刻看见，而不是等到某个用例才暴露：
 *
 * | 轨（自上而下 = 前景→背景） | 是什么 | 走通了哪条通路 |
 * |---|---|---|
 * | V6 全局调色 | effect 片段（3 实例） | adjustment layer 作用于它之下**所有**源 |
 * | V5 标题排版 | text 源 + 版式元素 | 排版光栅化（异步就绪）→ 合成 |
 * | V4 故障链 | effect 片段（4 实例，其中 2 个打在参数曲线上） | 特效参数曲线 + 反馈型特效 |
 * | V3 叠层 | sim 生成器 ×2 + 出画转场 | sim 的快照 / seek 重放 + 转场 |
 * | V2 主视觉 | bake → sim → realtime，三段各 8s + 2 个转场 | 三型生成器各一条 + gl-transitions |
 * | V1 复平面底图 | realtime 生成器（zoom 曲线） | 逐帧 shader + 源参数曲线 |
 *
 * 音频是程序生成的演示节拍（`audio/demo-audio.ts`，无外部文件依赖）。
 *
 * ## 写这份 demo 的三条自制
 *
 * 1. **参数只写要覆盖的键。** 缺的键在 `algos/runtime.ts` 的 `evalParams` 与
 *    `effects/runner.ts` 里各自回退到 `defaultValue`，所以这里既不该也不需要
 *    抄一遍完整参数表 —— 抄了就等于把上游的默认值冻在 2026 年，改了默认值这里
 *    还静默用着旧的。
 * 2. **不用任何外部素材。** 图片 / 视频源一律不出现 —— demo 必须是零资产的。
 * 3. **层级顺序不是随便排的。** `V4 故障链` 只压到 `V3/V2/V1`，`V5 标题` 在它**之上**
 *    （标题不该被切片切碎），`V6 调色` 在最顶（整幅画面统一上色）。改这里的顺序
 *    等于改画面的观感，`tests/unit/stack.test.ts` 会盯着 z 映射。
 */

import {
  defaultProject,
  newId,
  type BlendMode,
  type EffectClip,
  type EffectInstance,
  type Project,
  type SourceClip,
  type TransitionRef,
} from './schema';
import type { Curve } from './curve';
import {
  createShapeElement,
  createTextElement,
  createTypographyDocument,
  defaultTextStyle,
} from '../typography/document';
import { tr } from '../i18n/index.svelte';

export const DEMO_ASSET_ID = 'demo-song';
export const DEMO_DURATION = 24;

/** 段落边界（秒）。每段 4 小节 = 8 秒 @120BPM。 */
const S2 = 8;
const S3 = 16;

/**
 * 空白工程：一视觉 + 一音频两条轨。
 *
 * **不留空轨道列表。** 没有轨道的话右键菜单出不来、片段也没地方放，
 * 用户面对的是一块完全动不了的地方 —— 那不是「空白」，那是「坏了」。
 */
export function createBlankProject(name = tr('proj.unnamed')): Project {
  const p = defaultProject(name);
  p.tracks = [
    { kind: 'visual', id: newId(), name: 'V1', enabled: true, clips: [] },
    { kind: 'audio', id: newId(), name: 'A1', enabled: true, bus: 'master', clips: [] },
  ];
  return p;
}

/* ------------------------------------------------------------ 构造工具 */

function baseClip(id: string, start: number, end: number, label: string) {
  return { id, start, end, label, fadeSec: 0, curves: {} };
}

/** 片段层的单位变换（x/y 是 0..1 的画面归一坐标）。 */
const IDENTITY = { x: 0.5, y: 0.5, sx: 1, sy: 1, rot: 0 };

interface AlgoClipOpts {
  start: number;
  end: number;
  label: string;
  generator: string;
  params: Record<string, number | string>;
  /** 默认 normal。叠在底图之上的层用 screen 做加性合成。 */
  blend?: BlendMode;
  opacity?: number;
  curves?: Record<string, Curve>;
  transitionOut?: TransitionRef;
}

function algoClip(o: AlgoClipOpts): SourceClip {
  const clip: SourceClip = {
    ...baseClip(newId(), o.start, o.end, o.label),
    kind: 'source',
    source: { type: 'algo', generator: o.generator, params: o.params },
    blend: o.blend ?? 'normal',
    opacity: o.opacity ?? 1,
    transform: { ...IDENTITY },
    fit: 'stretch',
    curves: o.curves ?? {},
  };
  if (o.transitionOut) clip.transitionOut = o.transitionOut;
  return clip;
}

/** 特效实例。带 key 的写法是为了让调用方能拿到 instanceId 去挂参数曲线。 */
function fx(defId: string, values: Record<string, number | string> = {}): EffectInstance {
  return { instanceId: newId(), defId, enabled: true, values };
}

function effectClip(
  start: number,
  end: number,
  label: string,
  chain: EffectInstance[],
  curves: Record<string, Curve> = {},
): EffectClip {
  return { ...baseClip(newId(), start, end, label), kind: 'effect', chain, curves };
}

/* ------------------------------------------------------------ 开箱 demo */

/**
 * 故障强度的时间线：全程有一层底噪，两个段首各砸一个峰值。
 *
 * 「全程有底噪」是刻意的：故障只有对着**没坏**的东西才读得出是故障，
 * 一段干干净净的画面里突然出现切片，看起来像播放器坏了。
 */
function glitchCurve(base: number, peak: number): Curve {
  return {
    keys: [
      { t: 0, v: base, interp: 'smooth' },
      { t: S2 - 1, v: base * 1.8, interp: 'smooth' },
      { t: S2 + 0.4, v: peak, interp: 'smooth' },
      { t: S2 + 3.6, v: peak * 0.4, interp: 'smooth' },
      { t: S3 + 0.4, v: peak * 1.15, interp: 'smooth' },
      { t: S3 + 3.4, v: peak * 0.28, interp: 'smooth' },
      { t: DEMO_DURATION, v: base * 0.8, interp: 'smooth' },
    ],
  };
}

/** 标题排版文档。尺寸取工程分辨率，于是 1:1 摆在画面上。 */
function titleDocument() {
  const doc = createTypographyDocument({ w: 1920, h: 1080 });
  const base = defaultTextStyle(doc.size);

  const title = createTextElement(doc.size, {
    name: 'title',
    text: 'ARTMATIC',
    frame: { x: 160, y: 372, w: 1600, h: 200, rot: 0 },
    style: { ...base, fontSize: 150, fontWeight: 700, letterSpacing: 16, color: '#f4f7ff' },
  });

  // 标题与副题之间的一道细横线。用 shape 而不是 text 的下划线：
  // 下划线贴着字身，这里要的是一条独立的版式线。
  const rule = createShapeElement(doc.size, 'rect', {
    name: 'rule',
    frame: { x: 810, y: 614, w: 300, h: 6, rot: 0 },
    fill: { kind: 'solid', color: '#5ad1ff' },
  });

  const subtitle = createTextElement(doc.size, {
    name: 'subtitle',
    text: 'ALGORITHMIC ART · GLITCH · 120 BPM',
    frame: { x: 160, y: 664, w: 1600, h: 60, rot: 0 },
    style: { ...base, fontSize: 32, fontWeight: 400, letterSpacing: 10, color: '#9fb8dd' },
  });

  // 数组下标即 z 序。线在文字之下，于是它不会压住任何笔画。
  doc.elements = [rule, title, subtitle];
  return doc;
}

export function createDemoProject(): Project {
  const p = defaultProject(tr('tl.demoProjectName'));
  p.duration = DEMO_DURATION;
  p.beatGrid = { bpm: 120, offset: 0, beatsPerBar: 4 };
  p.assets[DEMO_ASSET_ID] = {
    id: DEMO_ASSET_ID,
    kind: 'audio',
    name: tr('tl.demoAudioAsset'),
    durationSec: DEMO_DURATION,
  };

  /* ---------------------------------------------------------- V1 底图 */

  /*
   * 全片唯一一个「铺满」的源，也是**开机第一帧**（`smoke.spec.ts` 要求它不黑）。
   * 所以它必须是 realtime 型 —— bake / sim 在开机那一刻还没热起来。
   *
   * zoom 是**对数**的（JS 侧 `2^v`）：0 → 1.7 是 1x → 3.2x，24 秒里一直是缓推。
   * 上限刻意压在 2 以下：再往里推，画面大部分会落进集合内部，
   * 而 `colorIn` 是深蓝而不是纯黑，于是那些区域还能当叠加层的背景板。
   */
  const mandelbrot = algoClip({
    start: 0,
    end: DEMO_DURATION,
    label: tr('tl.demoClipMandelbrot'),
    generator: 'mandelbrot',
    params: {
      cx: -0.743, cy: 0.131, maxIter: 320,
      colorA: '#0d2340', colorB: '#ffd27f', colorIn: '#08182e', intRes: '480',
    },
    curves: {
      zoom: {
        keys: [
          { t: 0, v: 0, interp: 'smooth' },
          { t: S2, v: 0.6, interp: 'smooth' },
          { t: S3, v: 1.2, interp: 'smooth' },
          { t: DEMO_DURATION, v: 1.7, interp: 'smooth' },
        ],
      },
    },
  });

  /* -------------------------------------------------------- V2 主视觉 */

  /*
   * 三段各 8 秒，每段换一个生成器：bake（分岔图，按列揭示）→
   * realtime（墨线等高图，音频反应）→ realtime（丝弦，音频反应）。
   *
   * 三段都是 screen 叠加在底图上：底图提供色彩床，这三段提供结构。
   * 转场 op 取的是**入画片段**的 blend，三段统一 screen 才不会在剪切点跳变。
   * 有状态的三型里 `sim` 放在 V3（蚂蚁 / 沙堆），不在这条轨上。
   */
  const bifurcation = algoClip({
    start: 0,
    end: S2,
    label: tr('tl.demoClipBifurcation'),
    generator: 'bifurcation',
    params: {
      map: 'logistic', width: 1024, height: 512, rMin: 2.7, rMax: 4,
      steps: 2200, keep: 1200, colorMode: 'density', gain: 70,
      speed: 280, colorBg: '#07060c', colorLive: '#ffd9a0',
    },
    blend: 'screen',
    opacity: 0.85,
    /*
     * speed 280 × 8s = 2240 ≫ width 1024 ⇒ 第 3.7 秒就长满。
     * 这一条是**用眼睛改出来的**：r 沿宽度增大，r<3.5 的那半张图几乎是空的
     * （单周期吸引子只占几个像素），真正的混沌带在最右边 30%。原先 speed 150
     * 时最右侧要等到第 6.8 秒才出现 —— 整段大半时间画面里什么都看不见。
     */
    transitionOut: { defId: 'CrossZoom', duration: 1.2, values: { strength: 0.9 } },
  });

  /*
   * 第二段换成 `scene-flow`（墨线等高图）而不是反应扩散，是**看着改的**：
   * 反应扩散在 8 秒里只长成中间一个小圆盘，读起来像贴上去的一张图；
   * `scene-flow` 一上来就铺满全幅，而且是音频反应型的 —— 它跟着 demo 节拍走。
   */
  const flow = algoClip({
    start: S2,
    end: S3,
    label: tr('tl.demoClipFlow'),
    generator: 'scene-flow',
    params: { density: 0.6, warp: 0.45, tone: 0.55, intRes: '480' },
    blend: 'screen',
    opacity: 0.8,
    transitionOut: { defId: 'pixelize', duration: 1.0, values: {} },
  });

  const strands = algoClip({
    start: S3,
    end: DEMO_DURATION,
    label: tr('tl.demoClipStrands'),
    generator: 'scene-strands',
    params: { density: 0.55, warp: 0.4, tone: 0.62, lift: 0.18, intRes: '480' },
    blend: 'screen',
    opacity: 0.9,
  });

  /* ---------------------------------------------------------- V3 叠层 */

  /*
   * 后两段的第二层：两个**有状态**的元胞自动机，刻意都选**居中生长的小结构**
   * （蚂蚁的高速公路 / 沙堆的锥体），而不是铺满全屏的图案 ——
   * 铺满的那种在 screen 叠加下会直接把底图整个盖掉，读起来是「换了张图」
   * 而不是「多了一层」。第一版这里的 `cyclic-ca` 正是栽在这上面。
   */
  const ant = algoClip({
    start: S2,
    end: S3,
    label: tr('tl.demoClipAnt'),
    generator: 'langtons-ant',
    params: {
      variant: 'RL', width: 384, height: 384, startMode: 'center', count: '1', wrap: 1,
      rate: 900, colorBg: '#06070d', colorLive: '#c9a2ff',
    },
    blend: 'screen',
    // 蚂蚁只占画面中心的一小块，0.55 的 screen 叠在墨线上等于看不见 —— 抬到 0.8。
    opacity: 0.8,
    transitionOut: { defId: 'GlitchMemories', duration: 1.0, values: {} },
  });

  const sand = algoClip({
    start: S3,
    end: DEMO_DURATION,
    label: tr('tl.demoClipSand'),
    generator: 'sandpile',
    params: {
      width: 256, height: 256, batch: 500, dropMode: 'center', rate: 30,
      colorBg: '#05060c', colorLive: '#ffd489',
    },
    blend: 'screen',
    opacity: 0.8,
  });

  /* ---------------------------------------------------------- V4 故障 */

  /*
   * 一条链四个实例，**其中两个打在参数曲线上**（这就是「特效参数也能打关键帧」
   * 的活样板）。顺序有讲究：
   *   channel-split 先拆通道 → slices 再切碎 → scanlines 收一道显示器的味道
   *   → echo 最后把上面所有破损拖成尾巴。
   * echo 是**反馈型**（跨帧历史），放在末尾而不是开头，免得历史里存的是没坏过的画面。
   */
  const slices = fx('slices', { count: 28, amount: 0.006, coverage: 0.35 });
  const split = fx('channel-split', { amount: 1, angle: 0 });
  const scanlines = fx('scanlines', { intensity: 0.1, spacing: 4 });
  const echo = fx('echo', { decay: 0.88, floor: 0.03, weight: 0.3, zoom: 0.004, spin: 0 });

  const glitch = effectClip(0, DEMO_DURATION, tr('tl.demoClipGlitch'), [split, slices, scanlines, echo], {
    [`${slices.instanceId}.amount`]: glitchCurve(0.006, 0.055),
    [`${split.instanceId}.amount`]: glitchCurve(1, 3.5),
  });

  /* -------------------------------------------------------- V5 标题 */

  const title: SourceClip = {
    ...baseClip(newId(), 1, 7.6, tr('tl.demoClipTitle')),
    kind: 'source',
    source: { type: 'text', doc: titleDocument() },
    blend: 'normal',
    opacity: 1,
    transform: { ...IDENTITY },
    // contain 而不是 stretch：改工程分辨率时文字等比缩放，不会被压扁。
    fit: 'contain',
    curves: {
      // 淡入 → 停住 → 淡出，全部是片段内相对秒。
      opacity: {
        keys: [
          { t: 0, v: 0, interp: 'smooth' },
          { t: 1.4, v: 1, interp: 'smooth' },
          { t: 5.0, v: 1, interp: 'smooth' },
          { t: 6.6, v: 0, interp: 'smooth' },
        ],
      },
      // 极轻的上升：0.02 的画面高度，够读出「落下来」但不晃眼。
      'transform.y': {
        keys: [
          { t: 0, v: 0.52, interp: 'smooth' },
          { t: 1.6, v: 0.5, interp: 'smooth' },
        ],
      },
    },
  };

  /* -------------------------------------------------------- V6 调色 */

  /*
   * 最顶一层，作用于整幅画面（含标题）。三件事各司其职：
   * 对比 / 饱和让叠加层从底图里站出来，暗角收视线，颗粒把数字画面
   * 从「塑料感」里拉回来一点。数值都刻意小 —— 调色是让画面成立，不是主角。
   *
   * ⚠️ `vignette.size` 是**半径**而不是「从多外面开始压暗」：半径 = 1 - size，
   * 而 uv 里到中心的距离最大只有 0.707（对角）—— size 给到 0.62 时半径只有 0.38，
   * 于是整幅画面（除中心一个小圆）被整体乘上 0.58，实测把平均亮度从 61 压到 34。
   * 想要「只压四角」，size 得往小里给。
   */
  const grade = effectClip(0, DEMO_DURATION, tr('tl.demoClipGrade'), [
    fx('color-correction', { brightness: 0.03, contrast: 0.12, saturation: 0.15, hue: 0 }),
    fx('vignette', { size: 0.35, amount: 0.3 }),
    fx('grain', { amount: 0.06, rgb: 1, blendMode: 'additive' }),
  ]);

  /**
   * 轨道顺序 = **从前景到背景**（列表自上而下）。
   *
   * `buildStack` 把列表顶部映射成最大 z，所以这里必须「全局调色在最上、
   * 底图在最下」——这正是 Premiere 的惯例（V6 压 V5 压 … 压 V1）。
   * 音频轨与视觉栈无关，放最后由它去。
   */
  p.tracks = [
    { kind: 'visual', id: newId(), name: tr('tl.demoTrackV6'), enabled: true, clips: [grade] },
    { kind: 'visual', id: newId(), name: tr('tl.demoTrackV5'), enabled: true, clips: [title] },
    { kind: 'visual', id: newId(), name: tr('tl.demoTrackV4'), enabled: true, clips: [glitch] },
    { kind: 'visual', id: newId(), name: tr('tl.demoTrackV3'), enabled: true, clips: [ant, sand] },
    { kind: 'visual', id: newId(), name: tr('tl.demoTrackV2'), enabled: true, clips: [bifurcation, flow, strands] },
    { kind: 'visual', id: newId(), name: tr('tl.demoTrackV1'), enabled: true, clips: [mandelbrot] },
    {
      kind: 'audio',
      id: newId(),
      name: tr('tl.demoTrackA1'),
      enabled: true,
      bus: 'master',
      clips: [
        {
          ...baseClip(newId(), 0, DEMO_DURATION, tr('tl.demoClipBeats')),
          kind: 'audio',
          assetId: DEMO_ASSET_ID,
          srcIn: 0,
          // 演示淡出：段落收束（S3 之后）的音频自然退场，而不是硬切。
          fadeOut: 1.5,
        },
      ],
    },
  ];

  /*
   * 段落标记（v8）。与文件头那张表一致：每 4 小节一段。
   * **demo 必须带着它们**：段落带是空的时候没有任何入口提示，用户不会知道
   * 「标尺上方那条灰带」是可交互的；三段现成的名字同时也是「它长什么样」的样例。
   */
  p.sections = [
    { id: newId(), name: tr('tl.demoSectionIntro'), start: 0 },
    { id: newId(), name: tr('tl.demoSectionDevelop'), start: S2 },
    { id: newId(), name: tr('tl.demoSectionOutro'), start: S3 },
  ];
  return p;
}

/**
 * capabilities.ts — 能力发现（方案 §3.2 的 `getCapabilities`）。
 *
 * **它是 agent 选择合法 id 的唯一依据**：工具面不接受「自由字符串当 defId」，
 * 网关侧也要按这份清单校验（方案 §4.4）。着色器是惰性编译的 —— 语法错误在你
 * 点到它之前不报 —— 所以「先看清单再挂特效」是 agent 唯一能提前发现自己选错
 * 的手段。
 *
 * ## `detail: 'params'`（v2 新增）
 *
 * `ids` 档只给 id（省上下文）；`params` 档给**参数表**：键 / 类型 / 区间 /
 * 选项 / 默认值。没有它，agent 给 `set_params` 填参数只能靠报错试错，而
 * 未知键会被控制平面直接拒掉。
 *
 * 序列化时**剥掉 `visibleWhen`**（函数，过不了 JSON，也没有必要给客户端执行）。
 */

import { BLEND_MODES } from '../core/schema';
import { EFFECT_CATALOG, structuralTags } from '../effects/catalog';
import { effectRegistryRevision, getEffect, listEffects } from '../effects/registry';
import { algoRegistryRevision, getGenerator, listGenerators } from '../algos/registry';
import { listTransitions } from '../effects/transitions/registry';
import type { ParamDef } from '../effects/types';
import { resolveLabel } from '../i18n/label';
import { tr } from '../i18n/index.svelte';
import { BUILTIN_THEMES, THEME_SLOTS, themeDisplayName, themeIds, type TypographyTheme } from '../typography/theme';
import { ANIM_PRESETS } from '../typography/animation';
import { SVG_GENERATORS, defaultsOf } from '../typography/svg-gen/registry';
import { shapeParamSupport } from '../typography/shapes';
import {
  DEFAULT_FONT_FAMILY,
  MIX_BLENDS,
  SHAPE_KINDS,
  TEXTURE_PATTERNS,
} from '../typography/document';
import type {
  Capabilities,
  CapabilityDetail,
  EffectCapability,
  GeneratorCapability,
  ParamSchema,
  TransitionCapability,
  TypographyCapabilities,
} from './types';

/** 允许的 fit / 曲线模式 / 源类型：与 `schema.ts` 的联合类型一一对应。 */
const FITS: Capabilities['fits'] = ['contain', 'cover', 'stretch'];
const CURVE_MODES: Capabilities['curveModes'] = ['keyframe', 'impulse', 'follower'];
const SOURCE_TYPES: Capabilities['sourceTypes'] = ['video', 'image', 'algo', 'text', 'solid'];

/* -------------------------------------------------------- 参数表序列化 */

/** `ParamDef` → JSON 安全的 `ParamSchema`（剥离 `visibleWhen`）。 */
export function serializeParam(p: ParamDef): ParamSchema {
  const base: ParamSchema = {
    key: p.key,
    label: resolveLabel(p.labelKey, tr),
    type: p.type,
    defaultValue: p.defaultValue,
    curvable: p.type === 'range',
  };
  switch (p.type) {
    case 'range':
      base.min = p.min;
      base.max = p.max;
      base.step = p.step;
      if (p.curve !== undefined) base.curve = p.curve;
      break;
    case 'select':
      base.options = p.options.map((o) => ({ value: o.value, label: resolveLabel(o.labelKey, tr) }));
      break;
    case 'bitmask':
      base.bits = p.bits;
      base.groups = p.groups.map((g) => ({
        label: resolveLabel(g.labelKey, tr),
        bits: g.bits,
        style: g.style,
      }));
      if (p.presets) {
        base.presets = p.presets.map((x) => ({ label: resolveLabel(x.labelKey, tr), value: x.value }));
      }
      break;
    case 'pattern':
      if (p.editorSize !== undefined) base.editorSize = p.editorSize;
      if (p.mode) base.mode = p.mode;
      break;
    case 'text':
      if (p.maxLength !== undefined) base.maxLength = p.maxLength;
      if (p.multiline) base.multiline = true;
      if (p.placeholderKey) base.placeholder = resolveLabel(p.placeholderKey, tr);
      break;
    default:
      break;
  }
  return base;
}

export function serializeParams(params: readonly ParamDef[] | undefined): ParamSchema[] {
  return (params ?? []).map(serializeParam);
}

/* ------------------------------------------------------------- 能力清单 */

/**
 * 清单在**插件挂载之前**是常量（内置注册表在模块加载时建好，glob 是 eager 的），
 * 所以算一次就够 —— 但要跟着两个注册表的 `revision` 失效：插件挂载后 agent
 * 必须立刻能发现新的 id，否则它手里那份清单会把新特效/生成器当成非法 id 拒掉。
 *
 * 缓存的是**纯数据**，不是「运行期实例」—— 后者绝不能缓存。判断 `!==` 而不是
 * `>`：两个注册表的计数是独立的，任一个变了都得重算。
 */
let cached: Capabilities | null = null;
let cachedRevision = -1;
let cachedDetail: CapabilityDetail = 'ids';

function generatorCapability(id: string, detail: CapabilityDetail): GeneratorCapability {
  const entry = listGenerators().find((g) => g.id === id)!;
  const out: GeneratorCapability = { id, kind: entry.kind, pluginId: entry.pluginId };
  if (detail === 'params') {
    out.name = resolveLabel(entry.nameKey, tr);
    if (entry.desc) out.desc = resolveLabel(entry.desc, tr);
    out.params = serializeParams(getGenerator(id)?.params);
  }
  return out;
}

function effectCapability(id: string, detail: CapabilityDetail): EffectCapability {
  const entry = listEffects().find((e) => e.id === id)!;
  const def = getEffect(id);
  const out: EffectCapability = { id, pluginId: entry.pluginId };
  if (detail === 'params') {
    out.name = resolveLabel(entry.nameKey, tr);
    const cat = def?.meta?.category ?? EFFECT_CATALOG[id]?.category ?? null;
    out.category = cat;
    const descKey = EFFECT_CATALOG[id]?.descKey;
    if (def?.meta?.desc) out.desc = resolveLabel(def.meta.desc, tr);
    else if (descKey) out.desc = tr(descKey);
    out.tags = [
      ...new Set([...(def ? structuralTags(def.shader) : []), ...(def?.meta?.tags ?? [])]),
    ];
    out.params = serializeParams(def?.params);
    if (def) {
      out.flags = {
        feedback: Boolean(def.shader.feedback),
        prePasses: def.shader.prePasses?.length ?? 0,
        stateful: Boolean(def.shader.stateful),
        hdrFeedback: Boolean(def.shader.hdrFeedback),
        opaqueOutput: Boolean(def.shader.opaqueOutput),
      };
    }
  }
  return out;
}

function transitionCapability(id: string, detail: CapabilityDetail): TransitionCapability {
  const entry = listTransitions().find((t) => t.id === id)!;
  const out: TransitionCapability = { id };
  if (detail === 'params') {
    out.name = entry.id;
    out.author = entry.author;
    out.license = entry.license;
    out.params = entry.params.map((p) => ({
      key: p.key,
      label: p.label,
      type: p.type,
      ...(p.min === undefined ? {} : { min: p.min }),
      ...(p.max === undefined ? {} : { max: p.max }),
      ...(p.step === undefined ? {} : { step: p.step }),
      defaultValue: p.defaultValue,
    }));
  }
  return out;
}

/**
 * @param opt.detail `ids`（默认）或 `params`
 * @param opt.ids 只给这几条（按 id 过滤；未知 id 被忽略）。省略 = 全部。
 *   参数表可以很大（70+ 特效 × 十几项），所以 agent 应当先取 id 再按需展开。
 */
export function getCapabilities(opt?: { detail?: CapabilityDetail; ids?: string[] }): Capabilities {
  const detail = opt?.detail ?? 'ids';
  const revision = effectRegistryRevision() + algoRegistryRevision();
  const wantAll = !opt?.ids || opt.ids.length === 0;
  const only = new Set(opt?.ids ?? []);

  // 只有「全量 + 同一档位」才走缓存；按 id 过滤是一次性小查询。
  if (wantAll && cached && cachedRevision === revision && cachedDetail === detail) return cached;

  const keep = (id: string) => wantAll || only.has(id);
  const out: Capabilities = {
    generators: listGenerators()
      .filter((g) => keep(g.id))
      .map((g) => generatorCapability(g.id, detail)),
    effects: listEffects()
      .filter((e) => keep(e.id))
      .map((e) => effectCapability(e.id, detail)),
    transitions: listTransitions()
      .filter((t) => keep(t.id))
      .map((t) => transitionCapability(t.id, detail)),
    blendModes: [...BLEND_MODES.map((b) => b.id)],
    fits: [...FITS],
    curveModes: [...CURVE_MODES],
    sourceTypes: [...SOURCE_TYPES],
  };

  if (wantAll) {
    cached = out;
    cachedRevision = revision;
    cachedDetail = detail;
  }
  return out;
}

/* --------------------------------------------------------- 排版能力清单 */

/**
 * 排版侧的能力清单：图形种类、22 个程序化生成器、配色方案、可控属性。
 *
 * 与特效清单同理：`params` 是 agent 唯一能知道自己「能调什么」的地方。
 * **纯函数**（自定义配色由调用方传进来），可以在单测里跑。
 */
export function getTypographyCapabilities(custom: readonly TypographyTheme[] | null): TypographyCapabilities {
  return {
    shapeKinds: [...SHAPE_KINDS],
    shapeParams: Object.fromEntries(SHAPE_KINDS.map((k) => [k, shapeParamSupport(k)])),
    /*
     * 单位说明是**能力清单的一部分**，不是注释：参数表只给区间与默认值，
     * 而 agent 真正会猜错的是「0.1 是比例还是 10px」。写在这里的每一条都
     * 对应一个会静默出错的实际语义（见 typography/shapes.ts）。
     */
    units: {
      frame:
        'x / y / w / h are document pixels (top-left origin). rot is RADIANS, ' +
        'rotated around the box centre. w / h are the unrotated box.',
      canvas:
        '`typo_set_canvas_size({ size })` is `doc.size` in pixels (the design resolution, >= 2). ' +
        '`scaleContent:true` also rescales every element (frame / font size / letter spacing / ' +
        'stroke width / shadow / blur / 3D px) by w-ratio and h-ratio — that is "change the ' +
        'format". `scaleContent:false` only changes the canvas: elements keep their pixel ' +
        'positions, so the composition shifts and anything outside is cropped.',
      groupBox:
        'A typography group owns one backing box: fill (Paint), stroke (Stroke or null), radius ' +
        '(px) and padding (px, the shell is this much larger than the members). `typo_update_group` ' +
        'takes `{ name, fill, stroke, radius, padding }`; `stroke:null` removes the border.',
      shapeRadius: 'corner / vertex radius in document px (not a ratio).',
      shapeInner:
        'wall thickness in document px (not a ratio). Default = short side × 0.1 for ' +
        '`frame`, × 0.18 for `ring`; clamped so the hole cannot collapse.',
      shapeSides: 'vertex count (3..64). Only polygon / star use it.',
      shapeWaist: 'star valley radius as a ratio of the outer radius (0..1).',
      shapeAngle: 'pie sweep in degrees (1..360).',
      generator:
        'Generator params are authored in a 0..100 square box that is then stretched to ' +
        'the element frame. Length-like values (width / tickWidth / bandWidth / gaps in ' +
        'the bar generators) are in that box: on a square frame 1 ≈ 1% of the side; on a ' +
        'non-square frame x distances scale with the frame width and y distances with the ' +
        'height, so the pattern is stretched rather than letterboxed. Values whose range ' +
        'is 0..1 are ratios of that box. Per-generator `notes` flag the cases where a ' +
        'parameter is clamped or scaled differently. **Paint generators with `fill`**: ' +
        'their path is a set of closed shapes, so a `stroke` traces every outline and, at ' +
        'bar widths below ~1 box unit, neighbouring outlines merge into a solid block.',
      text:
        'fontSize is px. letterSpacing is px (NOT em): 8 means 8px between glyphs. ' +
        'lineHeight is a MULTIPLIER of fontSize (1.2 = 120%), not px. fontWeight is 100..900. ' +
        'glyphStroke.width and boxStroke.width are px. shadows dx/dy/blur are document px. ' +
        'rot on a frame is radians, but a text element has no rotation field of its own — ' +
        'frame.rot is the only rotation and it is applied around the box centre. ' +
        'autoHeight:true means the box width is fixed and the height follows the text. ' +
        'Inline rich text lives in `runs: [{ text, style? }]`; style keys are fontFamily / fontSize (px) / ' +
        'fontWeight / fontStyle / letterSpacing (px) / color / textDecoration / highlight — anything ' +
        'omitted inherits the element style. `runs` is only returned when a run overrides something; ' +
        'otherwise send `text`.',
      shapePath:
        '`path` is only read when `shape:"svg"`. Default coordinate space is 0..100 authored and ' +
        'stretched to the frame; `pathUnit:"px"` means the path is already in the element\'s own ' +
        'pixel box (text-outline paths need this — 0..100 would stretch their stroke). Writing ' +
        '`path` drops the generator binding (`gen`), i.e. it bakes the shape.',
      transform3d:
        'Element-level 3D. perspective is px (0 = orthographic); translate is px (z = depth); ' +
        'rotate / skew are DEGREES; scale is a multiplier; origin is 0..1 of the element box ' +
        '(CSS transform-origin). Order is FIXED: perspective → translate3d → rotateX → rotateY → ' +
        'rotateZ → skewX → skewY → scale3d (rotate.z adds to frame.rot, both are around Z). ' +
        'On a patch it MERGES (send only the sub-objects you want to change); null removes 3D. ' +
        'Note transform-origin is per element, so several tilted elements in one row each need ' +
        'their own transform3d. Combine with shadows carefully: filter makes preserve-3d flat.',
      paint:
        'Paint.colors accept hex or theme slots (@accent1 / @dk1 / @lt1 ...). linear.angle is ' +
        'DEGREES (0 = left→right). stop.offset is 0..1 along the gradient. texture.scale is a ' +
        'multiplier of the pattern cell, texture.thickness is in document px.',
      defaults:
        'Elements created by the agent start EMPTY: shapes and generated shapes get ' +
        'fill {kind:"none"} and stroke null unless you pass them, so nothing is drawn by ' +
        'accident (the editor UI uses a solid accent fill for hand-made shapes — do not ' +
        'rely on that here). Text gets the document text style (default color = theme text ' +
        'slot). No animation is attached unless you pass `animation` / `animations`.',
    },
    generators: SVG_GENERATORS.map((g) => ({
      id: g.id,
      group: g.group,
      name: tr(g.labelKey),
      defaultSeed: g.defaultSeed,
      ...(g.aspect === undefined ? {} : { aspect: g.aspect }),
      ...(g.notes ? { notes: g.notes } : {}),
      params: serializeParams(g.params),
    })),
    themes: themeIds(custom).map((id) => {
      const builtin = BUILTIN_THEMES.find((t) => t.id === id) ?? null;
      const c = custom?.find((t) => t.id === id) ?? null;
      const theme = builtin ?? c;
      return { id, name: theme ? themeDisplayName(theme) : id, builtin: Boolean(builtin) };
    }),
    themeSlots: [...THEME_SLOTS],
    defaultFontFamily: DEFAULT_FONT_FAMILY,
    paintKinds: ['none', 'solid', 'linear', 'radial', 'texture'],
    texturePatterns: TEXTURE_PATTERNS.map((p) => p.id),
    mixBlends: MIX_BLENDS.map((b) => b.id),
    imageFits: ['fill', 'contain', 'cover', 'none'],
    textAligns: ['left', 'center', 'right', 'justify'],
    textVAligns: ['top', 'middle', 'bottom'],
    strokeStyles: ['solid', 'dashed', 'dotted'],
    /*
     * 动画清单。**预设名必须列出来**：模型猜 `slide-in-up` / `slideInUp` 的命中率
     * 大约是掷硬币，而猜错的表现是「动画没生效、也没有任何报错」。
     */
    animations: {
      presets: ANIM_PRESETS.map((p) => ({
        id: p.id,
        duration: p.duration,
        easing: typeof p.easing === 'string' ? p.easing : 'cubic-bezier',
        ...(p.params ? { params: p.params } : {}),
      })),
      easings: ['linear', 'ease', 'ease-in', 'ease-out', 'ease-in-out', 'cubic-bezier(x1,y1,x2,y2)'],
      directions: ['normal', 'reverse', 'alternate', 'alternate-reverse'],
      fills: ['none', 'forwards', 'backwards', 'both'],
      keyProps: ['opacity', 'x', 'y', 'sx', 'sy', 'rot', 'blur'],
      maxKeys: 20,
      customCss: {
        field: 'css',
        forms: [
          'one or more `@keyframes <name>{ … }` blocks plus ONE top-level `animation: <name> <duration> …;` shorthand (comma-separate several)',
          'a bare keyframes body, e.g. `from{opacity:0}to{opacity:1}` (legacy form; timing comes from duration / delay / loop / easing)',
        ],
        rejects:
          'Top-level selectors, @import / @charset / @namespace, HTML tags and position tricks are ' +
          'rejected — a custom animation can only ever affect the element it is attached to. Names ' +
          'are namespaced per element, so two elements may both define `@keyframes pulse`.',
        anyProperty:
          'Any animatable CSS property works (transform / 3D rotate / filter / color / clip-path / ' +
          'letter-spacing / background-position …). Use it whenever `keys[]` cannot express the ' +
          'motion — do not approximate a 3D flip with scale.',
      },
      note:
        '`duration` / `delay` are SECONDS. `keys[].at` is 0..1 of the animation (not seconds, ' +
        'not frames); `{ beat: n }` is also accepted and is converted with the project BPM. ' +
        'Key props: x / y are px offsets, sx / sy are scale factors, rot is DEGREES, blur is px, ' +
        'opacity is 0..1. Animations live in the document and are evaluated by the same clock ' +
        'as everything else, so they render in exports too. The read-back shape (what ' +
        '`get_typography_doc` returns, `iterations` instead of `loop`) is accepted verbatim, so a ' +
        'document can be read, edited and written back without losing animations.',
    },
    layoutOps: ['align', 'distribute', 'grid', 'row', 'column'],
    alignAxes: [
      'left',
      'center-h',
      'right',
      'top',
      'middle',
      'bottom',
      'distribute-h',
      'distribute-v',
    ],
  };
}

/** 生成器默认参数（`add_generated_shape` 省略 params 时用）。 */
export function svgGenDefaults(id: string): Record<string, number | string> {
  const spec = SVG_GENERATORS.find((g) => g.id === id);
  return spec ? defaultsOf(spec) : {};
}

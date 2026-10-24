/**
 * animation-migrate.ts — 旧动画（`preset` / `custom`）→ 结构化轨道（`tracks`）。
 *
 * 用户 2026-10-24 拍板「打开即迁移」：关键帧面板只编辑结构化轨道，旧的两种
 * 形态在工程打开时转一次，之后数据只有一种形状。**纯函数、无 DOM、无 i18n**，
 * 由 `core/schema.ts` 的 `MIGRATIONS[16]` 调用（那里是唯一的迁移入口）。
 *
 * 转换保真度的取舍：
 *  - 属性名 / 值一律过 `animation-tracks.ts` 的闸门；过不了的那一条**丢弃**；
 *  - `transform` 能无歧义拆成 translate / scale / rotate 就拆成通道（可编辑性
 *    最好），否则整条 `transform` 存成「原始字符串属性」轨道（不丢画面）；
 *  - 每段 `animation-timing-function` 收进关键帧的 `ease`；`steps()` 这类
 *    结构化模型表达不了的**回落到条目 easing**（记进报告，不静默）。
 *
 * 时间：`t = 基准延迟 + 百分比 × 时长`，绝对秒、相对片段起点 —— 与面板同口径。
 */

import {
  createTracksAnimation,
  keyframeBlocksOf,
  parseAnimationShorthand,
  parseCustomCss,
  presetKeyframes,
  type AnimTiming,
  type CustomAnimation,
  type Easing,
  type PresetAnimation,
  type TracksAnimation,
} from './animation';
import {
  identityValue,
  isValidPropName,
  isValidPropValue,
  type AnimChannel,
  type TrackKey,
} from './animation-tracks';

/** 迁移过程中的丢弃记录。调用方负责 `console.warn`（本模块保持无副作用）。 */
export interface MigrationReport {
  /** 整条动画无法解析（没有可用的关键帧块 / 简写非法）。 */
  dropAnimations: string[];
  /** 单个声明被丢弃（属性名或值过不了闸门，或结构化模型表达不了）。 */
  dropProps: string[];
}

interface Frame {
  /** 绝对秒（相对片段起点）。 */
  t: number;
  /** CSS 属性名 → 原始值（kebab-case）。 */
  decls: Map<string, string>;
  /** 该帧的 `animation-timing-function`（出向）。 */
  ease: Easing | null;
}

const IDENT_RE = /^(from|to|(?:\d+\.?\d*|\.\d+)%)$/i;

/** 帧选择器 → 百分比（`from` = 0、`to` = 100）。非法返回 null。 */
function offsetOf(sel: string): number | null {
  const s = sel.trim().toLowerCase();
  if (s === 'from') return 0;
  if (s === 'to') return 100;
  if (s.endsWith('%')) {
    const n = Number(s.slice(0, -1));
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/** 顶层按分隔符切（括号内的不切）。 */
function splitTop(s: string, sep: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]!;
    if (ch === '(' || ch === '[') depth++;
    else if (ch === ')' || ch === ']') depth = Math.max(0, depth - 1);
    else if (ch === sep && depth === 0) {
      out.push(s.slice(start, i));
      start = i + 1;
    }
  }
  out.push(s.slice(start));
  return out;
}

const EASING_KEYWORDS = new Set<string>(['linear', 'ease', 'ease-in', 'ease-out', 'ease-in-out']);

/** `animation-timing-function` 的值 → 结构化缓动。表达不了返回 null。 */
export function parseEase(value: string): Easing | null {
  const v = value.trim();
  if (EASING_KEYWORDS.has(v)) return v as Easing;
  const m = /^cubic-bezier\(([^)]*)\)$/i.exec(v);
  if (!m) return null;
  const nums = m[1]!.split(',').map((s) => Number(s.trim()));
  if (nums.length !== 4 || nums.some((n) => !Number.isFinite(n))) return null;
  return nums as [number, number, number, number];
}

/**
 * 一个 `@keyframes` 体 → 帧列表（百分比 → 绝对秒由调用方换算）。
 *
 * 解析不了的帧选择器**整块丢弃**（返回 null）：与浏览器行为一致 —— 一个非法
 * 选择器会让整条 `@keyframes` 作废，只留一半的帧反而画出错的东西。
 */
export function parseKeyframeBody(body: string): { offset: number; decls: [string, string][]; ease: Easing | null }[] | null {
  const frames: { offset: number; decls: [string, string][]; ease: Easing | null }[] = [];
  const n = body.length;
  let i = 0;
  while (i < n) {
    while (i < n && /\s/.test(body[i]!)) i++;
    if (i >= n) break;
    const selStart = i;
    while (i < n && body[i] !== '{' && body[i] !== '}') i++;
    if (i >= n || body[i] === '}') return null;
    const selectors = body
      .slice(selStart, i)
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    const offsets: number[] = [];
    for (const sel of selectors) {
      if (!IDENT_RE.test(sel)) return null;
      const off = offsetOf(sel);
      if (off === null) return null;
      offsets.push(off);
    }
    const declStart = i + 1;
    let depth = 1;
    i += 1;
    while (i < n && depth > 0) {
      if (body[i] === '{') depth += 1;
      else if (body[i] === '}') depth -= 1;
      i += 1;
    }
    if (depth !== 0) return null;
    const text = body.slice(declStart, i - 1);
    const decls: [string, string][] = [];
    let ease: Easing | null = null;
    for (const raw of splitTop(text, ';')) {
      const decl = raw.trim();
      if (!decl) continue;
      const colon = decl.indexOf(':');
      if (colon <= 0) continue;
      const prop = decl.slice(0, colon).trim().toLowerCase();
      const value = decl.slice(colon + 1).trim();
      if (!prop || !value) continue;
      if (prop === 'animation-timing-function') {
        ease = parseEase(value);
        continue;
      }
      decls.push([prop, value]);
    }
    for (const off of offsets) frames.push({ offset: off, decls, ease });
  }
  return frames;
}

/* ------------------------------------------------------------ transform 拆分 */

type ChannelMap = Partial<Record<AnimChannel, number>>;

/** 单个数字（可带单位）。 */
function numberOf(text: string): number | null {
  const n = Number.parseFloat(text);
  return Number.isFinite(n) ? n : null;
}

/**
 * `transform` 的值 → 通道。**只要出现一个不认识的函数就返回 null** ——
 * 拆一半再拼回去会改画面（丢掉的那个函数没人替它写）。
 */
function decomposeTransform(value: string): ChannelMap | null {
  const out: ChannelMap = {};
  let rest = value.trim();
  let guard = 0;
  while (rest) {
    if (guard++ > 12) return null;
    const m = /^([a-zA-Z0-9]+)\(([^)]*)\)\s*/.exec(rest);
    if (!m) return null;
    const fn = m[1]!.toLowerCase();
    const args = m[2]!.split(',').map((s) => s.trim());
    rest = rest.slice(m[0].length);
    switch (fn) {
      case 'translatex': {
        const v = numberOf(args[0] ?? '');
        if (v === null) return null;
        out.x = v;
        break;
      }
      case 'translatey': {
        const v = numberOf(args[0] ?? '');
        if (v === null) return null;
        out.y = v;
        break;
      }
      case 'translate': {
        const x = numberOf(args[0] ?? '');
        const y = (args[1] ?? '0').endsWith('%') ? 0 : numberOf(args[1] ?? '0');
        if (x === null || y === null) return null;
        out.x = x;
        out.y = y;
        break;
      }
      case 'scalex': {
        const v = numberOf(args[0] ?? '');
        if (v === null) return null;
        out.sx = v;
        break;
      }
      case 'scaley': {
        const v = numberOf(args[0] ?? '');
        if (v === null) return null;
        out.sy = v;
        break;
      }
      case 'scale': {
        const sx = numberOf(args[0] ?? '');
        const sy = numberOf(args[1] ?? args[0] ?? '');
        if (sx === null || sy === null) return null;
        out.sx = sx;
        out.sy = sy;
        break;
      }
      case 'rotate': {
        const v = numberOf(args[0] ?? '');
        if (v === null) return null;
        out.rot = v;
        break;
      }
      case 'none':
        return null;
      default:
        return null;
    }
  }
  return out;
}

/** `filter` 的值只认纯 `blur(<n>px)`；别的（drop-shadow 等）整条回落到原始属性。 */
function blurOf(value: string): number | null {
  const m = /^blur\(([^)]*)\)$/i.exec(value.trim());
  if (!m) return null;
  return numberOf(m[1]!);
}

/* ------------------------------------------------------------ 帧 → 轨道 */

/**
 * 帧列表 → 轨道。
 *
 * 每个通道都拿到**全部**帧（缺的补恒等值）：CSS 里「这一帧没写 transform」不是
 * 「保持上一帧」，而是「从基础样式（= 恒等）插值过来」。少补一个恒等帧，迁移
 * 出来的画面就会与旧工程不同 —— 而这类差异只在播到一半时看得出来。
 */
function tracksFromFrames(
  baseId: string,
  frames: Frame[],
  timing: Partial<AnimTiming>,
  report: MigrationReport,
): TracksAnimation[] {
  if (frames.length === 0) return [];
  const sorted = [...frames].sort((a, b) => a.t - b.t);
  const out: TracksAnimation[] = [];
  const used = new Set<string>();
  const push = (prop: string, keys: TrackKey[]): void => {
    if (keys.length === 0) return;
    // id 必须确定（迁移每次打开都可能跑）：`原 id-属性`，撞了再加序号。
    let id = `${baseId}-${prop}`;
    let n = 2;
    while (used.has(id)) id = `${baseId}-${prop}-${n++}`;
    used.add(id);
    out.push(createTracksAnimation(id, prop, keys, timing));
  };
  const rawKeysOf = (prop: string): TrackKey[] =>
    sorted
      .map((f) => ({ f, v: f.decls.get(prop) }))
      .filter((x): x is { f: Frame; v: string } => x.v !== undefined)
      .map((x) => ({ t: x.f.t, v: x.v, ease: x.f.ease }));

  /* ---- transform：能整条拆成通道就拆，拆不动就原样保留 ---- */
  const transformValues = sorted.map((f) => f.decls.get('transform'));
  const parsedT = transformValues.map((v) => (v === undefined ? undefined : decomposeTransform(v)));
  const failed = parsedT.some((p) => p === null);
  const present = parsedT.filter((p): p is ChannelMap => !!p);
  if (!failed && present.length > 0) {
    const channels = new Set<AnimChannel>();
    for (const p of present) for (const k of Object.keys(p) as AnimChannel[]) channels.add(k);
    for (const ch of channels) {
      push(
        ch,
        sorted.map((f, i) => ({
          t: f.t,
          v: parsedT[i]?.[ch] ?? identityValue(ch),
          ease: f.ease,
        })),
      );
    }
  } else if (transformValues.some((v) => v !== undefined)) {
    push('transform', rawKeysOf('transform'));
  }

  /* ---- opacity ---- */
  if (sorted.some((f) => f.decls.has('opacity'))) {
    push(
      'opacity',
      sorted.map((f) => {
        const v = f.decls.get('opacity');
        return {
          t: f.t,
          v: v === undefined ? identityValue('opacity') : (numberOf(v) ?? 1),
          ease: f.ease,
        };
      }),
    );
  }

  /* ---- filter：只认纯 blur，别的（drop-shadow 等）回落成原始属性 ---- */
  const filterValues = sorted.map((f) => f.decls.get('filter'));
  const declaredFilters = filterValues.filter((v): v is string => v !== undefined);
  if (declaredFilters.length > 0) {
    if (declaredFilters.every((v) => blurOf(v) !== null)) {
      push(
        'blur',
        sorted.map((f, i) => ({
          t: f.t,
          v: filterValues[i] === undefined ? 0 : (blurOf(filterValues[i]!) ?? 0),
          ease: f.ease,
        })),
      );
    } else {
      push('filter', rawKeysOf('filter'));
    }
  }

  /* ---- 其余属性：整条值原样保留（letter-spacing / color / clip-path …） ---- */
  const others = new Set<string>();
  for (const f of sorted) {
    for (const prop of f.decls.keys()) {
      if (prop === 'transform' || prop === 'opacity' || prop === 'filter') continue;
      others.add(prop);
    }
  }
  for (const prop of others) {
    if (!isValidPropName(prop)) {
      report.dropProps.push(prop);
      continue;
    }
    const keys: TrackKey[] = [];
    for (const f of sorted) {
      const v = f.decls.get(prop);
      if (v === undefined) continue;
      if (!isValidPropValue(v)) {
        report.dropProps.push(`${prop}:${v}`);
        continue;
      }
      keys.push({ t: f.t, v, ease: f.ease });
    }
    push(prop, keys);
  }

  return out;
}

/* ------------------------------------------------------------ 入口 */

function timingOf(anim: AnimTiming): Partial<AnimTiming> {
  return {
    iterations: anim.iterations,
    easing: anim.easing,
    direction: anim.direction,
    fill: anim.fill,
  };
}

/** 预设 → 轨道（14 个预设只产 transform / opacity / filter，能整条拆干净）。 */
export function presetToTracks(anim: PresetAnimation, report: MigrationReport): TracksAnimation[] {
  const parsed = parseKeyframeBody(presetKeyframes(anim.preset, anim.params));
  if (!parsed) {
    report.dropAnimations.push(anim.id);
    return [];
  }
  const frames: Frame[] = parsed.map((f) => ({
    t: anim.delay + (f.offset / 100) * Math.max(1e-3, anim.duration),
    decls: new Map(f.decls),
    ease: f.ease,
  }));
  return tracksFromFrames(anim.id, frames, timingOf(anim), report);
}

/**
 * 手写 CSS → 轨道。
 *
 * 两种形态都处理：多条（N 个 `@keyframes` + 逗号简写，每段各自成组）与旧单 body。
 * 简写里引用的预设名直接按预设的 keyframes 展开。
 */
export function customToTracks(anim: CustomAnimation, report: MigrationReport): TracksAnimation[] {
  const out: TracksAnimation[] = [];
  const blocks = new Map(keyframeBlocksOf(anim.css).map((b) => [b.name, b.body]));

  if (anim.animation) {
    const parsed = parseAnimationShorthand(anim.animation);
    if (!parsed.ok) {
      report.dropAnimations.push(anim.id);
      return [];
    }
    parsed.parts.forEach((part, i) => {
      const body = blocks.get(part.name) ?? (isPresetName(part.name) ? presetKeyframes(part.name) : null);
      const frames = body === null ? null : parseKeyframeBody(body);
      if (!frames) {
        report.dropAnimations.push(`${anim.id}#${part.name}`);
        return;
      }
      const duration = part.duration > 0 ? part.duration : Math.max(1e-3, anim.duration);
      const mapped: Frame[] = frames.map((f) => ({
        t: part.delay + (f.offset / 100) * duration,
        decls: new Map(f.decls),
        ease: f.ease,
      }));
      out.push(
        ...tracksFromFrames(`${anim.id}${i === 0 ? '' : `-${i}`}`, mapped, {
          ...timingOf(anim),
          iterations: part.iterations,
        }, report),
      );
    });
    return out;
  }

  // 旧单 body 形态：整段就是一个关键帧体。
  const parsed = parseKeyframeBody(anim.css);
  if (!parsed) {
    report.dropAnimations.push(anim.id);
    return [];
  }
  const frames: Frame[] = parsed.map((f) => ({
    t: anim.delay + (f.offset / 100) * Math.max(1e-3, anim.duration),
    decls: new Map(f.decls),
    ease: f.ease,
  }));
  out.push(...tracksFromFrames(anim.id, frames, timingOf(anim), report));
  return out;
}

const PRESET_NAMES = new Set([
  'fade-in', 'fade-out', 'fade-in-out',
  'slide-in-left', 'slide-in-right', 'slide-in-up', 'slide-in-down',
  'zoom-in', 'zoom-out', 'pop', 'spin', 'pulse', 'shake', 'blur-in',
]);

function isPresetName(name: string): name is Parameters<typeof presetKeyframes>[0] {
  return PRESET_NAMES.has(name);
}

/**
 * 任意形状的动画条目 → 轨道。已经是 `tracks` 的原样返回（幂等）。
 *
 * 入参来自**磁盘上的 JSON**，所以不信任任何字段：缺 `kind` 时按「有 `preset`
 * 就是预设、有 `css` 就是手写」判别；两者都没有就丢弃（记报告）。
 */
export function migrateAnimations(raw: unknown[], report: MigrationReport): unknown[] {
  const out: unknown[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const a = item as Record<string, unknown>;
    const id = typeof a.id === 'string' ? a.id : '';
    const kind = typeof a.kind === 'string' ? a.kind : typeof a.preset === 'string' ? 'preset' : 'custom';
    if (kind === 'tracks') {
      out.push(item);
      continue;
    }
    const timing: AnimTiming = {
      delay: Number(a.delay) || 0,
      duration: Number(a.duration) || 0,
      iterations: a.iterations === Infinity || a.iterations === 'infinite' ? Infinity : Number(a.iterations) || 1,
      easing: (a.easing as AnimTiming['easing']) ?? 'ease-out',
      direction: (a.direction as AnimTiming['direction']) ?? 'normal',
      fill: (a.fill as AnimTiming['fill']) ?? 'both',
    };
    if (kind === 'preset' && typeof a.preset === 'string' && PRESET_NAMES.has(a.preset)) {
      out.push(
        ...presetToTracks(
          { ...timing, id, kind: 'preset', preset: a.preset as PresetAnimation['preset'], params: a.params as Record<string, number> | undefined },
          report,
        ),
      );
      continue;
    }
    if (kind === 'custom' && typeof a.css === 'string') {
      const normalized = parseCustomCss(typeof a.animation === 'string' ? `${a.css}\nanimation: ${a.animation};` : a.css);
      if (!normalized.ok) {
        report.dropAnimations.push(id || '(no id)');
        continue;
      }
      const custom: CustomAnimation = {
        ...timing,
        id,
        kind: 'custom',
        css: normalized.css,
        ...(normalized.animation ? { animation: normalized.animation } : {}),
      };
      out.push(...customToTracks(custom, report));
      continue;
    }
    report.dropAnimations.push(id || '(no id)');
  }
  return out;
}

/**
 * 整份工程（raw JSON）→ 已迁移。返回**新对象**，不动入参。
 *
 * 只碰 `visual` / `source` 片段里的 `source.doc.elements[].animations`；
 * 没有排版文档的工程原样返回（`changed === false` 时调用方可以跳过写盘）。
 */
export function migrateProjectAnimations(raw: Record<string, unknown>): {
  project: Record<string, unknown>;
  report: MigrationReport & { changed: boolean };
} {
  const report: MigrationReport & { changed: boolean } = {
    dropAnimations: [],
    dropProps: [],
    changed: false,
  };
  const tracks = raw.tracks;
  if (!Array.isArray(tracks)) return { project: raw, report };

  const nextTracks = tracks.map((track) => {
    if (!track || typeof track !== 'object') return track;
    const t = track as Record<string, unknown>;
    if (!Array.isArray(t.clips)) return track;
    let trackChanged = false;
    const clips = t.clips.map((clip) => {
      if (!clip || typeof clip !== 'object') return clip;
      const c = clip as Record<string, unknown>;
      const source = c.source;
      if (!source || typeof source !== 'object') return clip;
      const src = source as Record<string, unknown>;
      if (src.type !== 'text' || !src.doc || typeof src.doc !== 'object') return clip;
      const doc = src.doc as Record<string, unknown>;
      if (!Array.isArray(doc.elements)) return clip;
      let docChanged = false;
      const elements = doc.elements.map((el) => {
        if (!el || typeof el !== 'object') return el;
        const e = el as Record<string, unknown>;
        if (!Array.isArray(e.animations) || e.animations.length === 0) return el;
        if (e.animations.every((a) => (a as { kind?: string } | null)?.kind === 'tracks')) return el;
        docChanged = true;
        return { ...e, animations: migrateAnimations(e.animations, report) };
      });
      if (!docChanged) return clip;
      trackChanged = true;
      return { ...c, source: { ...src, doc: { ...doc, elements } } };
    });
    if (!trackChanged) return track;
    report.changed = true;
    return { ...t, clips };
  });

  return { project: report.changed ? { ...raw, tracks: nextTracks } : raw, report };
}

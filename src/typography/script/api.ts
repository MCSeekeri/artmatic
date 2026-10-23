/**
 * script/api.ts — 脚本能看到的 `ctx`（唯一的写入面）。
 *
 * 设计原则：
 *  1. **只写表现层**：所有方法最终落到 `.typo-script` 这一层的内联样式 /
 *     SVG 属性 / canvas 像素。没有一个方法能改文档数据、z 序、分组或配色 ——
 *     脚本是「渲染期求值」，不是「第二个属性面板」。
 *  2. **单位单一**：`x/y` 是文档 px，`rotate` 是**角度**（不是弧度 ——
 *     与项目里的 `frame.rot` 不同，脚本面优先 CSS 直觉），canvas 的坐标是
 *     元素框内的 px。
 *  3. **确定性**：时间只来自 `ctx.t/frame`，随机只来自 `ctx.rand(i)`；
 *     `Math.random` / `Date.now` 在编译期就被遮蔽（见 `compile.ts`）。
 *  4. **预算是硬约束**：每次写入过一遍 `budget.check()`，超时/超次数抛
 *     `ScriptApiError`，由 `run.ts` 记一条诊断并中止这一条脚本。
 */

import {
  EL_ID_ATTR,
  SCRIPT_CANVAS_ATTR,
  SCRIPT_CHAR_ATTR,
  SCRIPT_LAYER_ATTR,
  type TypographyDocument,
  type TypographyElement,
} from '../document';
import { mulberry32, hashSeed } from '../../core/prng';
import { morphPath } from './morph';
import type { ScriptWriteLog } from './baseline';

export type ScriptApiErrorCode = 'writes' | 'time' | 'no-canvas' | 'bad-var' | 'path-only';

/** 脚本误用 API 时抛的错；`run.ts` 按 `code` 记诊断。 */
export class ScriptApiError extends Error {
  constructor(
    readonly code: ScriptApiErrorCode,
    detail: string,
  ) {
    super(detail);
    this.name = 'ScriptApiError';
  }
}

export interface ScriptBudget {
  /** 已写入次数。 */
  writes: number;
  maxWrites: number;
  /** `performance.now()` 的截止时刻（主线程计时，只用于预算，不参与画面）。 */
  deadline: number;
  check(): void;
}

export function createBudget(maxWrites: number, hardMs: number): ScriptBudget {
  const b: ScriptBudget = {
    writes: 0,
    maxWrites,
    deadline: performance.now() + hardMs,
    check(): void {
      b.writes++;
      if (b.writes > b.maxWrites) {
        throw new ScriptApiError('writes', `write budget exceeded (${b.maxWrites})`);
      }
      if (performance.now() > b.deadline) {
        throw new ScriptApiError('time', `time budget exceeded (${hardMs} ms)`);
      }
    },
  };
  return b;
}

export interface ScriptTransform {
  x?: number;
  y?: number;
  rotate?: number;
  scale?: number | { x?: number; y?: number };
  skew?: number | { x?: number; y?: number };
}

export type DeclValue = string | number | null | undefined;

export interface ScriptElHandle {
  readonly id: string;
  readonly kind: TypographyElement['kind'];
  /** `shape:'svg'` 的坐标系（`percent` = 0..100，`px` = 元素框）。其余为 null。 */
  readonly pathUnit: 'percent' | 'px' | null;
  /** `shape:'svg'` 的**原始**路径数据（文档里的那份，不是脚本改过的）。 */
  readonly d: string | null;
  /** 写内联样式到脚本层（值给 `null` = 移除）。 */
  style(decls: Record<string, DeclValue>): void;
  /** 写 `transform`（与 CSS 动画层复合：动画在外层，脚本在内层）。 */
  transform(t: ScriptTransform): void;
  opacity(v: number): void;
  visible(v: boolean): void;
  /** 写内容节点（svg / .typo-text / .typo-image）的属性。 */
  attr(name: string, value: string | number | null): void;
  /** 只对 `shape:'svg'`：替换路径 `d`（坐标系见 `pathUnit`）。 */
  path(d: string): void;
  /** 写 CSS 自定义属性（名字必须以 `--` 开头）。 */
  var(name: string, value: string): void;
  /** 目标元素内预建的 2D 画布；未声明 `needs:['canvas']` 时返回 null。 */
  canvas(): CanvasRenderingContext2D | null;
  /** 元素框（文档 px，未旋转）。只读副本。 */
  box(): { x: number; y: number; w: number; h: number; rot: number };
}

export interface ScriptCharHandle {
  readonly index: number;
  readonly count: number;
  /** 这个字形当前承载的字符（只读）。 */
  readonly char: string;
  style(decls: Record<string, DeclValue>): void;
  transform(t: ScriptTransform): void;
  opacity(v: number): void;
}

export interface ScriptContext {
  /** 片段内本地时间（秒）。 */
  readonly t: number;
  /** 片段内帧号（`round(t * fps)`，转场前半段可能为负）。 */
  readonly frame: number;
  readonly fps: number;
  /** 片段时长（秒）。 */
  readonly duration: number;
  /** 文档画幅（px）。 */
  readonly w: number;
  readonly h: number;
  /** 工程随机种子（与 `Project.seed` 同源）。 */
  readonly seed: number;
  el(id: string): ScriptElHandle | null;
  els(kind?: TypographyElement['kind']): ScriptElHandle[];
  chars(elId: string): ScriptCharHandle[];
  /** 确定性随机：同一帧、同一脚本、同一 `i` → 同一个值。 */
  rand(i?: number): number;
  /** `linear` / `in` / `out` / `in-out`，`x` 会被钳到 0..1。 */
  ease(name: 'linear' | 'in' | 'out' | 'in-out', x: number): number;
  clamp(v: number, min: number, max: number): number;
  lerp(a: number, b: number, k: number): number;
  smoothstep(edge0: number, edge1: number, x: number): number;
  /** 两条 SVG 路径在 `k` 处的中间形态（见 `morph.ts`）。 */
  morph(from: string, to: string, k: number): string;
  /** `hsl(210 80% 60%)`。 */
  hsl(h: number, s: number, l: number): string;
  /** 只进 console（调试开关关闭时是空操作）。 */
  log(...args: unknown[]): void;
}

export interface ScriptContextOptions {
  root: HTMLElement;
  doc: TypographyDocument;
  localSec: number;
  fps: number;
  duration: number;
  seed: number;
  scriptIndex: number;
  log: ScriptWriteLog;
  budget: ScriptBudget;
  debug?: boolean;
}

function declValue(v: DeclValue): string | null {
  if (v === null || v === undefined) return null;
  return typeof v === 'number' ? String(v) : v;
}

function transformCss(t: ScriptTransform): string {
  const parts: string[] = [];
  const x = t.x ?? 0;
  const y = t.y ?? 0;
  if (x !== 0 || y !== 0) parts.push(`translate(${x}px, ${y}px)`);
  if (t.rotate) parts.push(`rotate(${t.rotate}deg)`);
  if (t.scale !== undefined) {
    if (typeof t.scale === 'number') {
      if (t.scale !== 1) parts.push(`scale(${t.scale})`);
    } else {
      const sx = t.scale.x ?? 1;
      const sy = t.scale.y ?? sx;
      if (sx !== 1 || sy !== 1) parts.push(`scale(${sx}, ${sy})`);
    }
  }
  if (t.skew !== undefined) {
    if (typeof t.skew === 'number') {
      if (t.skew) parts.push(`skew(${t.skew}deg)`);
    } else {
      const kx = t.skew.x ?? 0;
      const ky = t.skew.y ?? 0;
      if (kx || ky) parts.push(`skew(${kx}deg, ${ky}deg)`);
    }
  }
  return parts.join(' ');
}

export function createScriptContext(opts: ScriptContextOptions): ScriptContext {
  const { root, doc, localSec, fps, duration, seed, scriptIndex, log, budget } = opts;
  const frame = Math.round(localSec * fps);
  const cleared = new Set<HTMLCanvasElement>();
  const byId = new Map<string, TypographyElement>();
  for (const el of doc.elements) byId.set(el.id, el);

  const shells = new Map<string, HTMLElement>();
  for (const node of Array.from(root.querySelectorAll<HTMLElement>(`[${EL_ID_ATTR}]`))) {
    const id = node.getAttribute(EL_ID_ATTR);
    if (id && !shells.has(id)) shells.set(id, node);
  }

  function layerOf(id: string): HTMLElement | null {
    const shell = shells.get(id);
    if (!shell) return null;
    return shell.querySelector<HTMLElement>(`[${SCRIPT_LAYER_ATTR}]`) ?? shell;
  }

  function contentOf(layer: HTMLElement): HTMLElement | null {
    return (layer.firstElementChild as HTMLElement | null) ?? null;
  }

  function writeStyle(el: HTMLElement, prop: string, value: DeclValue): void {
    budget.check();
    log.style(el, prop, declValue(value));
  }

  function handleOf(id: string): ScriptElHandle | null {
    const model = byId.get(id);
    const layer = layerOf(id);
    if (!model || !layer) return null;
    const content = contentOf(layer);
    const svgShape = model.kind === 'shape' && model.shape === 'svg' ? model : null;
    return {
      id,
      kind: model.kind,
      pathUnit: svgShape ? (svgShape.pathUnit ?? 'percent') : null,
      d: svgShape && typeof svgShape.path === 'string' ? svgShape.path : null,
      style(decls): void {
        for (const [prop, value] of Object.entries(decls)) writeStyle(layer, prop, value);
      },
      transform(t): void {
        writeStyle(layer, 'transform', transformCss(t));
      },
      opacity(v): void {
        writeStyle(layer, 'opacity', String(Math.max(0, Math.min(1, v))));
      },
      visible(v): void {
        writeStyle(layer, 'visibility', v ? '' : 'hidden');
      },
      attr(name, value): void {
        if (!content) return;
        budget.check();
        log.attr(content, name, value === null ? null : String(value));
      },
      path(d): void {
        if (!content) return;
        const target =
          content.tagName.toLowerCase() === 'path'
            ? content
            : content.querySelector<SVGPathElement>('g > path');
        if (!target) throw new ScriptApiError('path-only', `element ${id} has no <path>`);
        budget.check();
        log.attr(target, 'd', d);
      },
      var(name, value): void {
        if (!name.startsWith('--')) throw new ScriptApiError('bad-var', name);
        writeStyle(layer, name, value);
      },
      canvas(): CanvasRenderingContext2D | null {
        const cv = layer.querySelector<HTMLCanvasElement>(`canvas[${SCRIPT_CANVAS_ATTR}]`);
        if (!cv) return null;
        budget.check();
        if (!cleared.has(cv)) {
          cleared.add(cv);
          // 重置 backing store：清像素，同时把 transform / fillStyle 等状态
          // 一起复位 —— 否则上一帧的 setTransform 会累积成位移。
          cv.width = cv.width;
        }
        return cv.getContext('2d');
      },
      box(): { x: number; y: number; w: number; h: number; rot: number } {
        return { ...model.frame };
      },
    };
  }

  function charsOf(elId: string): ScriptCharHandle[] {
    const layer = layerOf(elId);
    if (!layer) return [];
    const nodes = Array.from(layer.querySelectorAll<HTMLElement>(`[${SCRIPT_CHAR_ATTR}]`)).sort(
      (a, b) =>
        Number(a.getAttribute(SCRIPT_CHAR_ATTR) ?? 0) -
        Number(b.getAttribute(SCRIPT_CHAR_ATTR) ?? 0),
    );
    const count = nodes.length;
    return nodes.map((node, index) => ({
      index,
      count,
      char: node.textContent ?? '',
      style(decls): void {
        for (const [prop, value] of Object.entries(decls)) writeStyle(node, prop, value);
      },
      transform(t): void {
        writeStyle(node, 'transform', transformCss(t));
      },
      opacity(v): void {
        writeStyle(node, 'opacity', String(Math.max(0, Math.min(1, v))));
      },
    }));
  }

  const ctx: ScriptContext = {
    t: localSec,
    frame,
    fps,
    duration,
    w: doc.size.w,
    h: doc.size.h,
    seed,
    el: handleOf,
    els(kind): ScriptElHandle[] {
      const out: ScriptElHandle[] = [];
      for (const el of doc.elements) {
        if (!el.visible) continue;
        if (kind && el.kind !== kind) continue;
        const h = handleOf(el.id);
        if (h) out.push(h);
      }
      return out;
    },
    chars: charsOf,
    rand(i = 0): number {
      return mulberry32(hashSeed(seed, frame, scriptIndex, i))();
    },
    ease(name, x): number {
      const t = Math.max(0, Math.min(1, x));
      switch (name) {
        case 'in':
          return t * t;
        case 'out':
          return 1 - (1 - t) * (1 - t);
        case 'in-out':
          return t * t * (3 - 2 * t);
        default:
          return t;
      }
    },
    clamp(v, min, max): number {
      return Math.max(min, Math.min(max, v));
    },
    lerp(a, b, k): number {
      return a + (b - a) * k;
    },
    smoothstep(edge0, edge1, x): number {
      if (edge0 === edge1) return x < edge0 ? 0 : 1;
      const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
      return t * t * (3 - 2 * t);
    },
    morph(from, to, k): string {
      return morphPath(from, to, k);
    },
    hsl(h, s, l): string {
      return `hsl(${h} ${s}% ${l}%)`;
    },
    log(...args): void {
      if (opts.debug) console.log(`[typo script ${scriptIndex}]`, ...args);
    },
  };

  return Object.freeze(ctx);
}

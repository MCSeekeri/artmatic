/**
 * image-fx.ts — 排版图片元素的**元素级**抠图（色键）与四角透视（CPU 实现）。
 *
 * ## 为什么在 DOM 侧自己算，而不是像片段那样交给 GPU
 *
 * 排版文档渲染成 DOM（`render-dom.ts`），舞台与 snapDOM 光栅化共用这一份
 * DOM —— 没有「placement pass」那个可编程采样点。抠图要逐像素、四角重采样要
 * 与 GPU 逐点对拍，所以两条能力都在 CPU 做。
 *
 * ⚠️ **旧注释（2026-10-17）说「snapDOM 会丢掉 matrix3d」是误判**。2026-10-21
 * 用 3.2.0 重测（裸 div / 真实 `.typo-doc` 嵌套 / 四角单应 matrix3d / `<img>` /
 * 文字 / 外层 `scale()`）全部正确出图，脚本在 `.codebuddy/tmp/2026-10-21/`。
 * 不要再用那条结论去排除 CSS 3D。两条能力的实现仍是：
 *
 *  - **抠图**：先按 `fit` / `crop` 把图片画进 canvas（与 CSS 同一套几何，
 *    交给 `drawImage` 做），再逐像素乘 alpha；
 *  - **四角**：对同一份 canvas 做 H⁻¹ 逆映射重采样（真透视，不是双线性拉伸）。
 *
 * 于是「有 key 或非恒等 quad」的图片元素，内容节点是 `<canvas>` 而不是
 * `<img>`。没有这两个字段（或 quad 恒等）时仍走 `<img>` + CSS —— 老工程的
 * 像素结果一个字节都不变。
 *
 * ## 三个必须记住的约束
 *
 * 1. **色键公式与 `engine/placement.frag.ts` 逐字一致**，真源在
 *    `core/image-fx.ts::applyKeyToRgba`。两套公式分家的表现是「排版里边缘
 *    发绿、时间轴上干净」，而且没有人会想到去比。
 * 2. **处理是异步的**（要等图片解码）。未就绪时 `buildImageNode` 显示**原图**
 *    （不闪空白）；就绪后由 `onReady` 通知宿主重绘。光栅化那条路不能赌 ——
 *    `dom-snap` 截图前会 `await ensureDocImagesFx()`，否则会把未处理的原图
 *    按正确的缓存键存下来，表现成「导出没抠图，而且一直不恢复」。
 * 3. **缓存里存的是位图，不是 DOM 节点**。同一个键可能同时出现在多处
 *    （同一素材的副本、舞台 + 光栅化 host），直接复用同一个 `<canvas>` 元素
 *    会把前一个节点搬走。`imageCanvasFor()` 每次都新建节点、把位图拷进去。
 */

import {
  applyKeyToRgba,
  hexToRgb01,
  type KeySettings,
  type QuadCorners,
} from '../core/image-fx';
import { isIdentityQuad, quadInverseMatrix } from '../core/quad';
import type { ImageElement, TypographyDocument } from './document';

/**
 * 处理结果的长边上限。
 *
 * 与排版光栅化的 `MAX_RASTER_EDGE` 同量级（4096）：超过它的元素框在导出时
 * 本来就会被缩，按 4096 处理不会损失可见细节，却能把 8K 文档里的整幅图片
 * 从 33 MP 降到 16 MP（CPU 逐像素重采样的成本是线性的）。
 */
const MAX_EDGE = 4096;

/** 缓存条目上限。排版文档里的图片元素通常个位数；留足余量做参数来回拖。 */
const MAX_ENTRIES = 24;

/** 键 → 处理结果位图。键包含所有影响像素的输入（见 `fxKey`）。 */
const cache = new Map<string, HTMLCanvasElement>();
/**
 * **按元素**串行 + 合并连续请求。
 *
 * 拖一个抠图滑杆会连续产生几十个不同的键（每个都对应一次解码 + 逐像素）。
 * 全部排队执行的话，拖一下滑块就是几十次 1920×1080 的重算 —— 主线程直接卡住。
 * 所以每个元素只有一条「泵」：期间新来的请求覆盖掉还没开始的那些，泵每轮
 * 先等 `DEBOUNCE_MS` 再取**最新**的那一个。于是拖动过程中实际只处理最后一两个。
 */
const latest = new Map<string, Request>();
const loops = new Map<string, Promise<void>>();
/** 解码失败的 URL：不缓存失败结果，但也不能每帧重试一次（失败风暴）。 */
const failedUrls = new Set<string>();

const DEBOUNCE_MS = 50;

interface Request {
  el: ImageElement;
  url: string;
  onReady?: () => void;
}

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * 元素是否需要走 canvas 路径。
 *
 * `quad` 存在但**恒等**时不走（与引擎 `u_quadOn = 0` 同一判据）：恒等四角
 * 的 canvas 重采样会引入一次不必要的双线性模糊，而用户在开关上看到的是「已开启」。
 */
export function imageNeedsFx(el: ImageElement): boolean {
  if (el.key) return true;
  return el.quad !== undefined && !isIdentityQuad(el.quad);
}

/** 位图尺寸：元素框的文档像素尺寸，长边夹到 `MAX_EDGE`。 */
export function fxRasterSize(el: ImageElement): { w: number; h: number } {
  const w = Math.max(1, Math.round(el.frame.w));
  const h = Math.max(1, Math.round(el.frame.h));
  const k = Math.min(1, MAX_EDGE / Math.max(w, h));
  return { w: Math.max(1, Math.round(w * k)), h: Math.max(1, Math.round(h * k)) };
}

function keyHash(key: KeySettings): string {
  return `${key.color},${key.tolerance},${key.softness},${key.spill}`;
}

function quadHash(q: QuadCorners): string {
  const f = (p: [number, number]): string => `${p[0].toFixed(5)},${p[1].toFixed(5)}`;
  return `${f(q.tl)};${f(q.tr)};${f(q.br)};${f(q.bl)}`;
}

/** 缓存键。**URL 而不是 assetId**：素材被替换时 URL 会变（见 image-assets）。 */
export function fxKey(el: ImageElement, url: string): string {
  const { w, h } = fxRasterSize(el);
  const c = el.crop && el.crop.w > 0 && el.crop.h > 0 ? el.crop : null;
  const crop = c
    ? `${c.x.toFixed(5)},${c.y.toFixed(5)},${c.w.toFixed(5)},${c.h.toFixed(5)}`
    : '-';
  // 恒等四角与「没有四角」同键：两者都走 `<img>` + CSS（见 imageNeedsFx），
  // 像素结果一样，分成两条只会多占一条缓存。
  const quad = el.quad && !isIdentityQuad(el.quad) ? quadHash(el.quad) : '-';
  return [url, `${w}x${h}`, el.fit, crop, el.key ? keyHash(el.key) : '-', quad].join('|');
}

/**
 * 同步取一个**可直接插入 DOM** 的 canvas；没就绪返回 null。
 *
 * 返回的节点是新造的，位图从缓存拷进来（同一键可能被多处引用）。
 */
export function imageCanvasFor(el: ImageElement, url: string): HTMLCanvasElement | null {
  const hit = cache.get(fxKey(el, url));
  if (!hit) return null;
  const { w, h } = fxRasterSize(el);
  const out = document.createElement('canvas');
  out.width = w;
  out.height = h;
  const ctx = out.getContext('2d');
  if (!ctx) return null;
  ctx.drawImage(hit, 0, 0, w, h);
  return out;
}

/**
 * 确保处理结果可用。返回同一个 canvas（缓存里的那张）或 null（失败）。
 *
 * `onReady` 只在**这次真的处理完成**时调用一次；命中缓存不会调用（调用方
 * 本来就已经拿到同步结果）。宿主用它触发一次重绘（舞台是 DOM，等不了 await）。
 */
export function ensureImageFx(
  el: ImageElement,
  url: string,
  onReady?: () => void,
): Promise<HTMLCanvasElement | null> {
  const key = fxKey(el, url);
  const hit = cache.get(key);
  if (hit) return Promise.resolve(hit);

  latest.set(el.id, { el, url, onReady });
  return pump(el.id).then(() => cache.get(key) ?? null);
}

/**
 * 单个元素的处理泵：每轮去抖一次、只取**最新**的请求。
 *
 * 返回的 Promise 在「队列暂时空了」时结算 —— 调用方（`ensureDocImagesFx`）
 * 等的正是这个时刻：那时该元素最新的那个参数已经处理完并写进缓存。
 */
function pump(elId: string): Promise<void> {
  const running = loops.get(elId);
  if (running) return running;
  const run = (async (): Promise<void> => {
    for (;;) {
      // 每轮都先等一次：连续拖动时中间那些参数值会被下一轮直接覆盖掉。
      await delay(DEBOUNCE_MS);
      const req = latest.get(elId);
      if (!req) break;
      latest.delete(elId);
      const key = fxKey(req.el, req.url);
      if (!cache.has(key) && !failedUrls.has(req.url)) {
        try {
          const img = await loadImage(req.url);
          if (!img) {
            failedUrls.add(req.url);
          } else {
            const out = renderFx(img, req.el);
            if (out) remember(key, out);
          }
        } catch (e) {
          // 一张图坏掉不该拖死整个文档。记进 failedUrls，别每帧再试。
          // 控制台诊断一律英文：i18n 守卫禁止 src/ 下出现面向用户的中文字面量。
          console.warn('[typography] image fx failed', e);
          failedUrls.add(req.url);
        }
      }
      req.onReady?.();
    }
  })().finally(() => loops.delete(elId));
  loops.set(elId, run);
  return run;
}

/** 光栅化前把文档里所有需要处理的图片都等到位。 */
export async function ensureDocImagesFx(
  doc: TypographyDocument,
  resolveImage: ((assetId: string) => string | null) | undefined,
): Promise<void> {
  if (!resolveImage) return;
  const jobs: Promise<unknown>[] = [];
  for (const el of doc.elements) {
    if (el.kind !== 'image' || !imageNeedsFx(el)) continue;
    const url = resolveImage(el.assetId);
    if (!url) continue; // 素材没就绪：交给既有「这一帧缺席」路径
    jobs.push(ensureImageFx(el, url));
  }
  if (jobs.length) await Promise.all(jobs);
}

/* -------------------------------------------------------------- 处理 */

function remember(key: string, canvas: HTMLCanvasElement): void {
  cache.set(key, canvas);
  while (cache.size > MAX_ENTRIES) {
    const oldest = cache.keys().next();
    if (oldest.done) break;
    cache.delete(oldest.value);
  }
}

function loadImage(url: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

/**
 * `object-fit` 的落点矩形（CSS 定义的逐字实现）。
 *
 * 只用于 canvas 绘制；**没有 fx 的图片仍走 CSS**，所以这份数学只服务
 * 「导出 / 舞台都用 canvas 的那条路」。`naturalWidth` 为 0（坏图）时返回 null。
 */
export function objectFitRect(
  nw: number,
  nh: number,
  boxW: number,
  boxH: number,
  fit: ImageElement['fit'],
): { x: number; y: number; w: number; h: number } | null {
  if (!(nw > 0) || !(nh > 0) || !(boxW > 0) || !(boxH > 0)) return null;
  if (fit === 'fill') return { x: 0, y: 0, w: boxW, h: boxH };
  if (fit === 'none') {
    return { x: (boxW - nw) / 2, y: (boxH - nh) / 2, w: nw, h: nh };
  }
  const k =
    fit === 'cover'
      ? Math.max(boxW / nw, boxH / nh)
      : Math.min(boxW / nw, boxH / nh);
  const w = nw * k;
  const h = nh * k;
  return { x: (boxW - w) / 2, y: (boxH - h) / 2, w, h };
}

/** 画「按 fit / crop 摆放好的元素框图」——与 `css.ts::imageStyle` 的几何同构。 */
function paintBase(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  W: number,
  H: number,
  el: ImageElement,
): void {
  const c = el.crop && el.crop.w > 0 && el.crop.h > 0 ? el.crop : null;
  // 有 crop 时：内层盒被放大 100/cw %、并偏移 -cx/cw —— 与 imageStyle 的百分比一致。
  const boxW = c ? W / c.w : W;
  const boxH = c ? H / c.h : H;
  const ox = c ? (-c.x / c.w) * W : 0;
  const oy = c ? (-c.y / c.h) * H : 0;
  const r = objectFitRect(img.naturalWidth, img.naturalHeight, boxW, boxH, el.fit);
  if (!r) return;
  ctx.drawImage(img, ox + r.x, oy + r.y, r.w, r.h);
}

/**
 * 一次完整处理：解码后的图 → 元素框图位 → 色键 → 四角重采样。
 *
 * 顺序与片段的 placement pass 一致：先按 fit / transform 摆好矩形，再做
 * 四角透视，最后在采样到的像素上算 alpha。反过来（先抠图再透视）会在
 * 四角的边缘产生「被拉伸的硬边」。
 */
function renderFx(img: HTMLImageElement, el: ImageElement): HTMLCanvasElement | null {
  const { w: W, h: H } = fxRasterSize(el);
  const cv = document.createElement('canvas');
  cv.width = W;
  cv.height = H;
  const ctx = cv.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  paintBase(ctx, img, W, H, el);

  if (el.key) {
    const data = ctx.getImageData(0, 0, W, H);
    applyKeyToRgba(data.data, el.key);
    ctx.putImageData(data, 0, 0);
  }

  if (el.quad && !isIdentityQuad(el.quad)) {
    const inv = quadInverseMatrix(el.quad);
    // 退化四角按「不调整」处理 —— 与引擎一致，**不丢元素**。
    if (inv) return remapQuad(cv, inv);
  }
  return cv;
}

/**
 * 用 H⁻¹ 重采样：目标像素 `(u,v)` → 源 uv。层外（uv 出 [0,1]）透明。
 *
 * 双线性 + `clamp` 边缘。`w <= 1e-6` 与 `placement.frag.ts` / `core/quad.ts`
 * 同阈值（消失线之外一律透明），否则 CPU 与 GPU 在消失线附近会给出不同的 alpha。
 */
function remapQuad(src: HTMLCanvasElement, inv: readonly number[]): HTMLCanvasElement {
  const W = src.width;
  const H = src.height;
  const sctx = src.getContext('2d', { willReadFrequently: true });
  if (!sctx) return src;
  const sd = sctx.getImageData(0, 0, W, H).data;

  const out = document.createElement('canvas');
  out.width = W;
  out.height = H;
  const octx = out.getContext('2d');
  if (!octx) return src;
  const od = octx.createImageData(W, H);
  const dd = od.data;

  const a = inv[0]!;
  const b = inv[1]!;
  const c = inv[2]!;
  const d = inv[3]!;
  const e = inv[4]!;
  const f = inv[5]!;
  const g = inv[6]!;
  const h = inv[7]!;
  const i = inv[8]!;

  for (let y = 0; y < H; y++) {
    const v = (y + 0.5) / H;
    for (let x = 0; x < W; x++) {
      const u = (x + 0.5) / W;
      const w = g * u + h * v + i;
      if (!(w > 1e-6)) continue;
      const su = (a * u + b * v + c) / w;
      const sv = (d * u + e * v + f) / w;
      if (!(su >= 0 && su <= 1 && sv >= 0 && sv <= 1)) continue;
      // 归一化 uv → 像素坐标（像素中心对齐）。
      const px = su * W - 0.5;
      const py = sv * H - 0.5;
      const x0 = Math.floor(px);
      const y0 = Math.floor(py);
      const fx = px - x0;
      const fy = py - y0;
      const x1 = Math.min(W - 1, Math.max(0, x0 + 1));
      const y1 = Math.min(H - 1, Math.max(0, y0 + 1));
      const xa = Math.min(W - 1, Math.max(0, x0));
      const ya = Math.min(H - 1, Math.max(0, y0));
      const w00 = (1 - fx) * (1 - fy);
      const w10 = fx * (1 - fy);
      const w01 = (1 - fx) * fy;
      const w11 = fx * fy;
      const i00 = (ya * W + xa) * 4;
      const i10 = (ya * W + x1) * 4;
      const i01 = (y1 * W + xa) * 4;
      const i11 = (y1 * W + x1) * 4;
      const o = (y * W + x) * 4;
      // 非预乘：四个通道各自插值。
      dd[o] = sd[i00]! * w00 + sd[i10]! * w10 + sd[i01]! * w01 + sd[i11]! * w11;
      dd[o + 1] = sd[i00 + 1]! * w00 + sd[i10 + 1]! * w10 + sd[i01 + 1]! * w01 + sd[i11 + 1]! * w11;
      dd[o + 2] = sd[i00 + 2]! * w00 + sd[i10 + 2]! * w10 + sd[i01 + 2]! * w01 + sd[i11 + 2]! * w11;
      dd[o + 3] = sd[i00 + 3]! * w00 + sd[i10 + 3]! * w10 + sd[i01 + 3]! * w01 + sd[i11 + 3]! * w11;
    }
  }
  octx.putImageData(od, 0, 0);
  return out;
}



/**
 * actions.ts — 排版编辑器的语义动作。
 *
 * Ribbon 的描述数组里挂的全是这里的函数。分这一层的理由：Ribbon 的按钮只该
 * 知道「点了我做什么」，不该知道「文档结构长什么样、怎么改才安全」。
 * 于是「加一个按钮」= 在 ribbon-defs 里加一行 + 可能在这里加一个函数，
 * 不需要碰任何组件。
 *
 * 所有写库都经 editorState（commit / 手势事务），这是撤销栈完整的唯一前提。
 */

import { browserPlatform } from '../../platform/browser';
import { appState } from '../app-state.svelte';
import { editorState } from './editor-state.svelte';
import { newId } from '../../core/schema';
import {
  createImageElement,
  createShapeElement,
  createTextElement,
  type ImageElement,
  type MixBlend,
  type ShapeElement,
  type TextStyle,
  type TypographyDocument,
  type TypographyElement,
  type ZOrderOp,
} from '../../typography/document';
import {
  alignElements,
  boundsOf,
  distribute,
  toRects,
  type AlignAxis,
  type Rect,
} from '../../typography/geometry';
import {
  createCustomAnimation,
  createPresetAnimation,
  sanitizeKeyframeBody,
  type AnimPreset,
  type AnimTiming,
} from '../../typography/animation';
import { putImageBytes, mimeForImageFilename } from '../../typography/image-assets';
import type { ShapePreset } from '../../typography/shapes';
import { tr } from '../../i18n/index.svelte';

/* ------------------------------------------------------------ 选择集工具 */

function selectedIds(): Set<string> {
  return new Set(editorState.selectedIds);
}

/** 可写的元素（锁定的跳过）。 */
function writable(doc: TypographyDocument): TypographyElement[] {
  const ids = selectedIds();
  return doc.elements.filter((el) => ids.has(el.id) && !el.locked);
}

function onlyText(doc: TypographyDocument) {
  return writable(doc).filter((el): el is Extract<TypographyElement, { kind: 'text' }> => el.kind === 'text');
}

function onlyShape(doc: TypographyDocument) {
  return writable(doc).filter((el): el is ShapeElement => el.kind === 'shape');
}

function onlyImage(doc: TypographyDocument) {
  return writable(doc).filter((el): el is ImageElement => el.kind === 'image');
}

function anyElement(doc: TypographyDocument): TypographyElement[] {
  return writable(doc);
}

/** 对齐目标框：画布，或选区外接框。 */
function targetRect(): Rect {
  const doc = editorState.doc;
  if (appState.typoAlignTarget === 'selection') {
    return boundsOf(toRects(editorState.selected));
  }
  const size = doc?.size ?? { w: 1920, h: 1080 };
  return { id: 'canvas', x: 0, y: 0, w: size.w, h: size.h };
}

/* ------------------------------------------------------------ 动作表 */

export interface TypographyActions {
  /* 文本 */
  setTextProp<K extends keyof TextStyle>(key: K, value: TextStyle[K]): void;
  setTextAlign(value: TextStyle['align']): void;
  setVAlign(value: TextStyle['vAlign']): void;
  toggleTextFlag(key: 'bold' | 'italic' | 'underline' | 'strike'): void;

  /* 插入 */
  addText(): void;
  addShape(preset: ShapePreset): void;
  addImage(): void;

  /* 通用元素属性 */
  setBlend(value: MixBlend): void;
  setOpacity(value: number): void;
  toggleFlag(key: 'locked' | 'visible'): void;
  duplicateSelection(): void;
  deleteSelection(): void;
  order(op: ZOrderOp): void;

  /* 图形 */
  setShapeFill(color: string): void;
  setShapeStroke(color: string): void;
  setShapeStrokeWidth(width: number): void;
  setShapeStrokeStyle(style: 'solid' | 'dashed' | 'dotted'): void;
  setShapeRadius(radius: number): void;

  /* 图片 */
  setImageFit(value: ImageElement['fit']): void;

  /* 对齐 */
  align(axis: AlignAxis): void;
  setAlignTarget(target: 'canvas' | 'selection'): void;

  /* 动画 */
  applyPreset(preset: AnimPreset): void;
  setAnimTiming(patch: Partial<AnimTiming>): void;
  /** 写入手写 keyframes 体。返回 false 表示代码非法（未写入）。 */
  applyCustomCss(css: string): boolean;
  clearAnimations(): void;

  /* 字体 */
  importFont(): void;

  /* 逃生舱 */
  /** 把排版文档 1:1 烘焙成一张 PNG，并把片段改成 image 源。 */
  flattenToImage(localSec: number): void;
}

const r2 = (n: number): number => Math.round(n * 100) / 100;

export function createTypographyActions(): TypographyActions {
  return {
    /* ---------------------------------------------------------- 文本 */

    setTextProp(key, value) {
      editorState.commit(tr('typo.undo.textProp'), (doc) => {
        for (const el of onlyText(doc)) el.style = { ...el.style, [key]: value };
      });
    },

    setTextAlign(value) {
      editorState.commit(tr('typo.undo.textAlign'), (doc) => {
        for (const el of onlyText(doc)) el.style = { ...el.style, align: value };
      });
    },

    setVAlign(value) {
      editorState.commit(tr('typo.undo.vAlign'), (doc) => {
        for (const el of onlyText(doc)) el.style = { ...el.style, vAlign: value };
      });
    },

    toggleTextFlag(flag) {
      editorState.commit(tr('typo.undo.fontStyle'), (doc) => {
        for (const el of onlyText(doc)) {
          const s = el.style;
          if (flag === 'bold') {
            el.style = { ...s, fontWeight: s.fontWeight >= 600 ? 400 : 700 };
          } else if (flag === 'italic') {
            el.style = { ...s, fontStyle: s.fontStyle === 'italic' ? 'normal' : 'italic' };
          } else if (flag === 'underline') {
            el.style = { ...s, textDecoration: s.textDecoration === 'underline' ? 'none' : 'underline' };
          } else {
            el.style = {
              ...s,
              textDecoration: s.textDecoration === 'line-through' ? 'none' : 'line-through',
            };
          }
        }
      });
    },

    /* ---------------------------------------------------------- 插入 */

    addText() {
      editorState.commit(tr('typo.undo.addText'), (doc) => {
        const el = createTextElement(doc.size);
        doc.elements = [...doc.elements, el];
        queueMicrotask(() => editorState.selectOnly(el.id));
      });
    },

    addShape(preset) {
      editorState.commit(tr('typo.undo.addShape'), (doc) => {
        const el = createShapeElement(doc.size, preset.id, {
          radius: preset.radius,
          sides: preset.sides,
        });
        doc.elements = [...doc.elements, el];
        queueMicrotask(() => editorState.selectOnly(el.id));
      });
    },

    addImage() {
      void (async () => {
        const picked = await browserPlatform.pickImageFile();
        if (!picked) return;
        const assetId = newId();
        // ① 渲染期解引用：snapDOM 要能把 <img> 取下来内联进快照。
        putImageBytes(assetId, picked.data, mimeForImageFilename(picked.name));
        // ② 持久化：字节进素材仓，并在工程的素材表里登记一条。
        //    两个都要 —— 只有 ① 保存时找不到字节（重开丢图），
        //    只有 ② 当时画面上就是空的。
        appState.assets.put(assetId, new Uint8Array(picked.data.slice(0)), {
          kind: 'image',
          name: picked.name,
          originName: picked.name,
        });
        appState.store.commit(tr('typo.undo.registerImageAsset'), (p) => {
          p.assets[assetId] = { id: assetId, kind: 'image', name: picked.name };
        });
        editorState.commit(tr('typo.undo.addImage'), (doc) => {
          const el = createImageElement(doc.size, assetId, { name: picked.name });
          doc.elements = [...doc.elements, el];
          queueMicrotask(() => editorState.selectOnly(el.id));
        });
      })();
    },

    /* ---------------------------------------------------- 通用属性 */

    setBlend(value) {
      editorState.commit(tr('typo.undo.blend'), (doc) => {
        for (const el of anyElement(doc)) el.blend = value;
      });
    },

    setOpacity(value) {
      editorState.commit(tr('typo.undo.opacity'), (doc) => {
        for (const el of anyElement(doc)) el.opacity = Math.max(0, Math.min(1, value));
      });
    },

    toggleFlag(key) {
      editorState.commit(key === 'locked' ? tr('typo.undo.lock') : tr('typo.undo.hide'), (doc) => {
        for (const el of writable(doc)) el[key] = !el[key];
      });
    },

    duplicateSelection() {
      const source = editorState.selected.filter((e) => !e.locked);
      if (!source.length) return;
      const offset = 24;
      const fresh: TypographyElement[] = [];
      for (const el of source) {
        const copy = structuredClone(el) as TypographyElement;
        copy.id = newId();
        copy.frame = { ...copy.frame, x: copy.frame.x + offset, y: copy.frame.y + offset };
        // 动画 id 也要换：不换的话两份元素会共用同一个 @keyframes 选择器，
        // 一改动画另一份跟着变。
        copy.animations = copy.animations.map((a) => ({ ...a, id: newId() }));
        fresh.push(copy);
      }
      editorState.commit(tr('typo.undo.duplicate'), (doc) => {
        doc.elements = [...doc.elements, ...fresh];
        queueMicrotask(() => editorState.setSelection(fresh.map((e) => e.id)));
      });
    },

    deleteSelection() {
      const ids = new Set(selectedIds());
      if (!ids.size) return;
      editorState.commit(tr('typo.undo.delete'), (doc) => {
        doc.elements = doc.elements.filter((el) => !ids.has(el.id) || el.locked);
      });
      editorState.clearSelection();
    },

    order(op) {
      // 唯一实现在 editorState（图层面板的上下移也走它），这里只做转发。
      editorState.order(op);
    },

    /* ---------------------------------------------------------- 图形 */

    setShapeFill(color) {
      editorState.commit(tr('typo.undo.shapeFill'), (doc) => {
        for (const el of onlyShape(doc)) el.fill = { kind: 'solid', color };
      });
    },

    setShapeStroke(color) {
      editorState.commit(tr('typo.undo.shapeStroke'), (doc) => {
        for (const el of onlyShape(doc)) {
          el.stroke = el.stroke ? { ...el.stroke, color } : { color, width: 4, style: 'solid' };
        }
      });
    },

    setShapeStrokeWidth(width) {
      editorState.commit(tr('typo.undo.strokeWidth'), (doc) => {
        for (const el of onlyShape(doc)) {
          if (!el.stroke) continue;
          el.stroke = { ...el.stroke, width: Math.max(0, width) };
        }
      });
    },

    setShapeStrokeStyle(style) {
      editorState.commit(tr('typo.undo.strokeStyle'), (doc) => {
        for (const el of onlyShape(doc)) {
          el.stroke = el.stroke ? { ...el.stroke, style } : { color: '#ffffff', width: 4, style };
        }
      });
    },

    setShapeRadius(radius) {
      editorState.commit(tr('typo.undo.radius'), (doc) => {
        for (const el of onlyShape(doc)) el.radius = Math.max(0, radius);
      });
    },

    /* ---------------------------------------------------------- 图片 */

    setImageFit(value) {
      editorState.commit(tr('typo.undo.imageFit'), (doc) => {
        for (const el of onlyImage(doc)) el.fit = value;
      });
    },

    /* ---------------------------------------------------------- 对齐 */

    align(axis) {
      const rects = toRects(editorState.selected.filter((e) => !e.locked));
      if (!rects.length) return;

      if (axis === 'distribute-h' || axis === 'distribute-v') {
        const axisShort = axis === 'distribute-h' ? 'h' : 'v';
        const map = distribute(rects, axisShort);
        if (!map.size) return;
        editorState.commit(tr('typo.undo.distribute'), (doc) => {
          for (const el of anyElement(doc)) {
            const v = map.get(el.id);
            if (v === undefined) continue;
            if (axisShort === 'h') el.frame.x = r2(v);
            else el.frame.y = r2(v);
          }
        });
        return;
      }

      const map = alignElements(rects, targetRect(), axis);
      editorState.commit(tr('typo.undo.align'), (doc) => {
        for (const el of anyElement(doc)) {
          const p = map.get(el.id);
          if (!p) continue;
          el.frame.x = r2(p.x);
          el.frame.y = r2(p.y);
        }
      });
    },

    setAlignTarget(target) {
      appState.typoAlignTarget = target;
    },

    /* ---------------------------------------------------------- 动画 */

    applyPreset(preset) {
      editorState.commit(tr('typo.undo.addAnim'), (doc) => {
        for (const el of anyElement(doc)) {
          const anim = createPresetAnimation(preset, newId());
          el.animations = [...el.animations, anim];
        }
      });
    },

    clearAnimations() {
      editorState.commit(tr('typo.undo.clearAnim'), (doc) => {
        for (const el of anyElement(doc)) el.animations = [];
      });
    },

    setAnimTiming(patch) {
      editorState.commit(tr('typo.undo.animTiming'), (doc) => {
        for (const el of anyElement(doc)) {
          el.animations = el.animations.map((a) => ({ ...a, ...patch }));
        }
      });
    },

    applyCustomCss(css) {
      // 清洗放在写库之前：非法代码绝不能进文档 —— 一旦进了，光栅化时
      // animationStyleSheet 会跳过它，但用户已经以为「保存成功」了。
      const body = sanitizeKeyframeBody(css);
      if (!body) return false;
      editorState.commit(tr('typo.undo.customAnim'), (doc) => {
        for (const el of anyElement(doc)) {
          const prev = el.animations[0];
          // 继承上一段动画的时序，否则用户手写一段 keyframes 之后时长会跳回
          // 默认的 0.6s，「只是改了下缓动」变成了「动画变快了」。
          el.animations = [
            createCustomAnimation(newId(), body, prev
              ? {
                  delay: prev.delay,
                  duration: prev.duration,
                  iterations: prev.iterations,
                  easing: prev.easing,
                  direction: prev.direction,
                  fill: prev.fill,
                }
              : {}),
          ];
        }
      });
      return true;
    },

    importFont() {
      void (async () => {
        const picked = await browserPlatform.pickFontFiles();
        if (!picked?.length) return;
        let ok = 0;
        for (const f of picked) {
          try {
            await appState.fonts.registerFile(f.name, f.data);
            ok += 1;
          } catch (err) {
            console.warn(`[typo] 字体 ${f.name} 导入失败`, err);
          }
        }
        appState.refreshFontFamilies();
        appState.flash(
          ok === picked.length
            ? tr('typo.fontsImported', { ok })
            : tr('typo.fontsImportedPartial', { ok, total: picked.length }),
        );
      })();
    },

    flattenToImage(localSec) {
      const clipId = editorState.clipId;
      const doc = editorState.doc;
      if (!clipId || !doc) return;
      void (async () => {
        const canvas = await appState.textRaster.rasterizeOnce(doc, doc.size.w, doc.size.h, localSec);
        const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/png'));
        if (!blob) {
          appState.flash(tr('typo.bakeFailed'), 'error');
          return;
        }
        const assetId = newId();
        const bytes = new Uint8Array(await blob.arrayBuffer());
        putImageBytes(assetId, bytes.buffer, 'image/png');
        appState.assets.put(assetId, bytes, {
          kind: 'image',
          name: tr('typo.bakedName'),
          originName: 'flatten.png',
        });
        appState.store.updateClip(clipId, tr('typo.undo.flatten'), (clip) => {
          if (clip.kind === 'source' && clip.source.type === 'text') {
            clip.source = { type: 'image', assetId };
          }
        });
        appState.store.commit(tr('typo.undo.registerImageAsset'), (p) => {
          p.assets[assetId] = { id: assetId, kind: 'image', name: tr('typo.bakedName') };
        });
        // 源已经不是 text 了，编辑页必须关掉 —— 留着会指向一个不存在的文档。
        appState.closeTypographyView();
      })();
    },
  };
}

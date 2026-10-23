/**
 * script/templates.ts — 内置示例脚本。
 *
 * 三条示例对应三种典型能力：逐字（结构预处理）、SVG 变形（纯几何）、
 * Canvas（自己的绘制表面）。它们不是「特效预设」—— 用户插入后就是一段
 * 可编辑的代码，改坏了也只是那一条脚本停摆。
 *
 * 代码里的注释必须是英文：`src/` 下不允许中文字面量（i18n 守卫会把它当成
 * 未抽取的文案），而这里每一行都会被写进工程文件。
 */

import type { MessageKey } from '../../i18n/locales';
import type { ScriptNeed } from './model';

export interface ScriptTemplate {
  id: 'typewriter' | 'morph' | 'canvas';
  labelKey: MessageKey;
  needs: ScriptNeed[];
  code: string;
}

const TYPEWRITER = `// Reveal every text element character by character.
const STAGGER = 0.045;
const DURATION = 0.35;

for (const el of ctx.els('text')) {
  const chars = ctx.chars(el.id);
  for (const c of chars) {
    const delay = c.index * STAGGER;
    const k = ctx.clamp((ctx.t - delay) / DURATION, 0, 1);
    const e = ctx.ease('out', k);
    c.opacity(e);
    c.transform({ y: (1 - e) * 26 });
  }
}
`;

const MORPH = `// Morph every authored SVG path into a circle and back.
const cycle = (ctx.t % ctx.duration) / Math.max(0.001, ctx.duration);
const k = cycle < 0.5 ? ctx.ease('in-out', cycle * 2) : ctx.ease('in-out', (1 - cycle) * 2);

for (const el of ctx.els('shape')) {
  if (!el.d) continue;
  const box = el.box();
  const px = el.pathUnit === 'px';
  const cx = px ? box.w / 2 : 50;
  const cy = px ? box.h / 2 : 50;
  const r = px ? Math.min(box.w, box.h) * 0.42 : 42;
  const circle =
    'M ' + (cx - r) + ' ' + cy +
    ' A ' + r + ' ' + r + ' 0 1 0 ' + (cx + r) + ' ' + cy +
    ' A ' + r + ' ' + r + ' 0 1 0 ' + (cx - r) + ' ' + cy + ' Z';
  el.path(ctx.morph(el.d, circle, k));
}
`;

const CANVAS = `// Draw a deterministic particle field on each element's canvas.
for (const el of ctx.els()) {
  const g = el.canvas();
  if (!g) continue;
  const box = el.box();
  const COUNT = 90;
  for (let i = 0; i < COUNT; i++) {
    const a = ctx.rand(i * 3);
    const b = ctx.rand(i * 3 + 1);
    const c = ctx.rand(i * 3 + 2);
    const speed = 20 + c * 80;
    const x = (a * box.w + ctx.t * speed) % box.w;
    const y = b * box.h;
    g.fillStyle = ctx.hsl((a * 360 + ctx.t * 40) % 360, 85, 62);
    g.fillRect(x, y, 2 + c * 3, 2 + c * 3);
  }
}
`;

export const SCRIPT_TEMPLATES: ScriptTemplate[] = [
  { id: 'typewriter', labelKey: 'typo.scriptTplTypewriter', needs: ['chars'], code: TYPEWRITER },
  { id: 'morph', labelKey: 'typo.scriptTplMorph', needs: [], code: MORPH },
  { id: 'canvas', labelKey: 'typo.scriptTplCanvas', needs: ['canvas'], code: CANVAS },
];

/**
 * plugin-spec.ts — 给模型看的**协议说明书**（按需取，不进系统提示）。
 *
 * 为什么是运行期组装而不是一份静态 md：`EFFECT_HEAD` / `ALGO_HEAD` 里的
 * uniform 列表是**唯一真源**，手抄一份到文档里必然在某次加 uniform 时漂掉，
 * 而漂掉的后果是模型写出「重复声明 u_time」这类编译错误 —— 它自己看不出来。
 * 所以头部直接从常量拼，静态部分（工作流 / 例子 / 清单）放在 `plugin-api.md`。
 *
 * 另一半理由：工具表与系统提示要省 token。这些细节只在模型真去写插件时才拉。
 */

import guide from './plugin-api.md?raw';
import { EFFECT_HEAD } from '../effects/shader-def';
import { ALGO_HEAD } from '../algos/shader-lib';
import { tr } from '../i18n/index.svelte';

const HELPERS = `// Paste these small helpers into your single-file plugin - imports are not allowed.
const f = (gl, l, v, k) => { const p = l['u_' + k]; if (p) gl.uniform1f(p, Number(v[k]) || 0); };
const i = (gl, l, v, k) => { const p = l['u_' + k]; if (p) gl.uniform1i(p, Math.round(Number(v[k]) || 0)); };
const rgb = (hex) => {
  const n = parseInt(String(hex || '#000000').slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
};
const c3 = (gl, l, v, k) => { const p = l['u_' + k]; if (p) gl.uniform3f(p, ...rgb(v[k])); };
const sel = (map, fallback = 0) => (v) => map[String(v)] ?? fallback;
`;

/** 完整插件协议说明（`help('plugin-api')` 的返回）。 */
export function pluginReference(): string {
  return [
    '# Artmatic plugin API (single-file ESM)',
    '',
    '## Shared preludes (the runtime prepends these; do NOT redeclare them)',
    '',
    '### Effect fragment prelude (`EFFECT_HEAD`)',
    '```glsl',
    EFFECT_HEAD.trim(),
    '```',
    '',
    '### Realtime generator prelude (`ALGO_HEAD`)',
    '```glsl',
    ALGO_HEAD.trim(),
    '```',
    '',
    '## Value helpers you can paste (no imports allowed)',
    '```js',
    HELPERS.trim(),
    '```',
    '',
    guide.trim(),
  ].join('\n');
}

const TIMELINE_HELP = `# Timeline model

- \`t\` is SECONDS and is snapped to the frame grid \`round(t*fps)/fps\`. Fields that
  need frame numbers are named \`*Frame\` (\`frameRange.from/to\`, \`frameStep\`).
- \`tracks[]\` order is compositing order: \`tracks[0]\` is the FRONT-most track.
  The API also gives you \`z\` = (visual track count - 1 - visual index); for an
  effect clip, "below" means smaller \`z\` (later in the array).
- Clip kinds: \`source\` (algo / image / video / text / solid), \`effect\`
  (adjustment layer with \`chain[]\` of effects), \`audio\`.
- An effect clip only affects tracks BELOW it. \`affectDepth\` limits it to the
  nearest N enabled visual tracks (0 = all below).
- Overlap is governed by \`project.overlapBehavior\` (\`push\` | \`reject\` | \`trim\`).
  A rejected placement changes NOTHING, so read the error instead of retrying
  the same coordinates.
- Every write is one undo entry. \`begin_transaction\` + \`commit_transaction\`
  groups a whole turn into one undo entry (a turn is wrapped automatically in
  the in-app panel; the MCP client should do it explicitly).
- Times for transitions: \`transitionOut\` hangs on the OUTGOING source clip; the
  window is centred on the cut (\`clip.end\`) and clamped by both neighbours.

Common workflow:
1. \`get_scene({ detail: 'ids' })\` - cheap overview.
2. \`get_capabilities({ detail: 'params', ids: [...] })\` - only the defs you plan to use.
3. Add / move clips, set params.
4. \`frame_signature({ t })\` to verify numerically, \`render_frame({ t })\` to look.
5. If a shader def id is wrong the renderer silently skips it - always take the
   id from the capability list instead of inventing one.`;

const TYPOGRAPHY_HELP = `# Typography documents

A text clip owns a \`TypographyDocument\`:

- \`size\` (document pixels, top-left origin, y down), \`background\` (Paint),
  \`elements[]\`, \`groups[]\`, \`fonts[]\`, optional \`theme\`.
- \`elements\` array index IS the z-order: index 0 is the bottom, last is the front.
  Do not invent a \`z\` field; use \`typo_reorder_element\`.
- Element kinds:
  - \`text\`: \`runs\` (plain text input is fine - we convert it), \`style\`
    (fontFamily, fontSize, fontWeight, letterSpacing, lineHeight, align, vAlign,
    color, textDecoration, textTransform, highlight, shadow, writingMode),
    optional \`fill\` (gradient / texture on glyphs), \`boxFill\`, \`boxStroke\`
    (the box rectangle), \`glyphStroke\` (\`{ color, width }\`, an outline on the
    glyphs themselves via \`-webkit-text-stroke\`; width is centred, so half of
    it eats into the glyph).
  - \`shape\`: \`shape\` kind (rect / ellipse / line / triangle / star / polygon /
    trapezoid / parallelogram / arrow / ring / frame / pie / svg), \`fill\`,
    \`stroke\`, \`radius\`, \`sides\`, \`waist\`, \`inner\`, \`angle\`, \`path\` (for svg).
  - \`image\`: \`assetId\`, \`fit\`, optional \`crop\`, \`radius\`.
- Every element also takes \`shadows\` (array of \`{ color, dx, dy, blur }\` in
  document px, rendered as chained \`filter: drop-shadow()\`) and \`blur\` (px,
  \`filter: blur()\`). A stroke's optional \`paint\` (same Paint shape) fills it
  with a gradient / texture instead of \`color\`.
- \`frame\` is the unrotated bounding box: \`{ x, y, w, h, rot }\` in document px.
  Rotation is around the box centre (radians).
- \`Paint\`: \`{ kind: 'none' }\` | \`{ kind:'solid', color }\` |
  \`{ kind:'linear', angle, stops:[{offset,color}] }\` |
  \`{ kind:'radial', stops }\` | \`{ kind:'texture', pattern, color, bg, scale, thickness }\`.
- Colors may reference the document theme: \`@accent1\`, \`@dk1\`, \`@lt1\` etc.
  Changing \`theme\` then recolors every element that uses a theme reference.

Layout: prefer \`typo_layout\` over hand-computing coordinates. It supports
\`align\` (canvas or selection), \`distribute\` (>=3 elements), \`grid\`, \`row\`,
\`column\` with \`gap\` / \`margin\`. Use \`typo_add_generated_shape\` for the 22
procedural SVG generators (rings, barcodes, contours, ...) - they accept
\`{ genId, params, seed }\` and become ordinary shape elements afterwards.`;

const WORKFLOW_HELP = `# Working with this editor

1. Read before writing: \`get_scene({detail:'ids'})\` / \`get_typography_doc({detail:'ids'})\`.
2. Ask for capabilities only for the ids you intend to use
   (\`get_capabilities({detail:'params', ids:[...]})\`).
3. Make changes with small, explicit tool calls. The in-app panel wraps a whole
   turn in one transaction, so a failed attempt is one undo away.
4. Look at the result: \`render_frame({ t })\` returns an image; sizes default to
   640x360 and are cheap. Use \`frame_signature\` when you only need "did anything
   change / is there structure".
5. Report what you changed in one or two sentences. Do not dump JSON.

Rules:
- Never invent ids (clip ids, def ids, asset ids): read them first.
- \`t\` is seconds. A clip's span is \`[start, end)\`.
- If a tool returns \`{ ok:false, error }\`, read \`error.code\` and \`error.detail\`;
  \`invalid-argument\` usually means a wrong key or a value out of range.
- Determinism matters: the same \`t\` always renders the same frame. Do not ask
  for "randomness" - set the project seed or generator parameters instead.`;

const IMAGE_HELP = `# Screenshots

- \`render_frame({ t, size? })\` renders through the SAME evaluation path as preview
  and export (including \`onSeek\` + async text rasterization). It temporarily pins
  the render size and restores it afterwards; the preview is not left resized.
- Images are injected as a user message right after the tool result (the chat API
  only accepts images in user messages). Each image costs at most ~1k tokens.
- Prefer small sizes. \`detail:'low'\` is used by default; ask for a larger size
  only when you need to read small text.
- Numeric alternative: \`frame_signature({ t, grid })\` returns per-channel means,
  spread, block means and sample colors. Use \`spread\` to answer "is there any
  structure" and per-channel means to catch color changes.`;

export type HelpTopic = 'plugin-api' | 'timeline' | 'typography' | 'workflow' | 'images';

export const HELP_TOPICS: HelpTopic[] = ['plugin-api', 'timeline', 'typography', 'workflow', 'images'];

/** `help(topic)` 的实现。未知 topic 返回可用清单（而不是抛错 —— 模型能自我纠正）。 */
export function helpText(topic: string | undefined): string {
  switch (topic) {
    case 'plugin-api':
      return pluginReference();
    case 'timeline':
      return TIMELINE_HELP;
    case 'typography':
      return TYPOGRAPHY_HELP;
    case 'workflow':
      return WORKFLOW_HELP;
    case 'images':
      return IMAGE_HELP;
    default:
      return `${tr('agent.llm.toolUnknown', { name: `help(${String(topic)})` })}\nAvailable topics: ${HELP_TOPICS.join(', ')}`;
  }
}

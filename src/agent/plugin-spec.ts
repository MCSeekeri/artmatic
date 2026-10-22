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
- **Bound effect clips** (\`boundClipId\`): the chain runs on ONE source clip's own
  layer (placed, filtered, then blended with that clip's blend/opacity). z order and
  \`affectDepth\` are irrelevant, it cannot affect anything else, and several bound
  clips can coexist on the same track if their time ranges do not overlap. Use it
  for beat-level accents (0.25s strobe on one shot) instead of opening a track per
  hit. Bound and depth are mutually exclusive; binding to a missing clip does nothing.
- Track economy: a long chain on one effect clip beats a track per effect, and
  \`boundClipId\` beats a track per accent. A human has to read \`tracks[]\`; 20 tracks
  is a project nobody can edit by hand afterwards.
- Overlap is governed by \`project.overlapBehavior\` (\`push\` | \`reject\` | \`trim\`).
  A rejected placement changes NOTHING, so read the error instead of retrying
  the same coordinates.
- Every write is one undo entry. \`begin_transaction\` + \`commit_transaction\`
  groups a whole turn into one undo entry (a turn is wrapped automatically in
  the in-app panel; the MCP client should do it explicitly).
- Times for transitions: \`transitionOut\` hangs on the OUTGOING source clip; the
  window is centred on the cut (\`clip.end\`) and clamped by both neighbours.
- Adding a clip past the current end **grows \`project.duration\`** (deliberate: the
  extra tail is what an outgoing transition fades into black). Read \`describe()\`
  after bulk edits if the total length matters.

## Sections (\`edit_sections\`)

A section stores ONLY its start time: section N ends where section N+1 starts, and
the last one ends at \`project.duration\`. That is why marking a drop is \`add\` and
cutting a long section is \`split\` (there is nothing to "resize").

\`op: add { start, name? } | split { sectionId, at } | rename { sectionId, name } |
remove { sectionId } | move { sectionId, start }\`

\`start\` / \`at\` are SECONDS. \`add\` clamps into \`[0, duration]\`. \`split\` fails (and
changes nothing) when either half would be shorter than the minimum gap — read the
error instead of assuming it cut. The sections come back sorted, so you can keep
composing against them without re-reading the scene.

## Clip look (\`set_clip_props\`)

Beyond \`label / fadeSec / blend / opacity / transform / fit / affectDepth / boundClipId\`:

| field | applies to | semantics |
|---|---|---|
| \`fadeIn\` / \`fadeOut\` | audio clips | seconds; \`fadeIn + fadeOut <= clip length\` (clamped); \`0\` removes |
| \`srcIn\` | audio / video | source offset in seconds — shifts the content inside the clip, does NOT move its edges |
| \`crop\` | source clips | \`{ left, top, right, bottom }\` = fraction of the SOURCE cut away (0..1). Narrow the window only, never scales the content |
| \`quad\` | source clips | \`{ tl, tr, br, bl }\`, each \`[x, y]\` in layer space. Degenerate (zero-area) quads are rejected — they render as nothing |
| \`key\` | image / video | \`{ color: "#rrggbb", tolerance?, softness?, spill? }\` (0..1). Omitted fields keep their value |

Passing \`null\` turns that effect OFF (field removed). All of these come back in
\`applied\` as the stored value. \`fadeSec\` is the VISUAL clip's cut fade — a
different thing from the audio fades.

Switch a single effect instance off with \`set_params({ target: 'effect', chainIndex })\`
— pass \`enabled\` only (no \`params\`) when you just want the A/B comparison. Two
candidate looks are easier to judge by toggling one instance than by deleting it.

\`set_generator\` replaces an algo clip's generator: params are reset to the new
generator's defaults (then merged with \`params\`), and curves keyed by the OLD
generator's params are deleted. Other curves (\`opacity\`, \`transform.*\`) survive.

## Curves (\`set_curve\`)

\`\`\`json
{
  "mode": "keyframe | impulse | follower",       // default keyframe
  "keys": [
    { "t": 0,   "v": 0, "interp": "smooth" },
    { "t": 0.5, "v": 1, "interp": "smooth", "hOut": [0.15, 0], "hIn": [-0.15, 0] }
  ],
  "beatAnchor": { "beat": 8 },
  "impulse": { "decay": 0.3 },
  "follower": { "attack": 0.05, "release": 0.3 }
}
\`\`\`
- \`t\` is SECONDS (relative to the clip start, or to the anchored beat), \`v\` is the
  value (there is no \`value\` key). \`interp\` defaults to \`smooth\` and only affects
  the segment from that key to the NEXT one. Keys must be sorted by \`t\`.
- \`hOut\` / \`hIn\` are bezier handle offsets \`[seconds, value]\` relative to the key;
  they only matter when the segment's \`interp\` is \`bezier\`.

## Key namespace (which \`param\` string to use)

| clip kind | keys |
|---|---|
| source | \`opacity\`, \`transform.x/y/sx/sy/rot\`, plus every range generator param (e.g. \`zoom\`) |
| effect | \`<instanceId>.<paramKey>\` for every range param of every instance in the chain |
| audio | \`gain\` |

\`set_curve\` also accepts readable forms when they are unambiguous: a unique
instanceId **prefix** (\`fx-38a8.amount\`), a defId when the chain has exactly one
instance of it (\`blur.amount\`), or the bare param key when only one instance has
it. Ambiguity is an error listing every candidate (chainIndex + full instanceId).
\`add_effect\` returns \`keyPrefix\` — \`keyPrefix + "<param>"\` is always valid.

## Isolation (\`only\` on render_frame / frame_signature / render_sequence)

\`only: { trackId: <id | id[]>, elementId: <id | id[]> }\` hides every visual track
that is not listed — **including effect (adjustment) clips on their own tracks**.
It answers "what does this layer look like by itself"; it is NOT a way to test a
chain (render without \`only\` for that). Effects bound to a listed clip stay, because
they are part of that layer. The result echoes \`layers\` (the tracks/clips that
actually composited) — if a chain looks like it did nothing, compare that list.

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
    it eats into the glyph). A SOLID \`fill\` is the same thing as \`style.color\`:
    passing \`{kind:'solid',color}\` writes \`style.color\` (gradient / radial /
    texture are the only kinds that live in \`fill\`). Both spellings work.
  - \`shape\`: \`shape\` kind (rect / ellipse / line / triangle / star / polygon /
    trapezoid / parallelogram / arrow / ring / frame / pie / svg), \`fill\`,
    \`stroke\`, \`radius\` (px), \`sides\` (count), \`waist\` (0..1), \`inner\` (px
    wall thickness), \`angle\` (degrees), \`path\` (for svg). If you give
    \`stroke\` and omit \`fill\`, the fill defaults to NONE - an outline shape
    does not get a solid block behind it.
  - \`image\`: \`assetId\`, \`fit\`, optional \`crop\`, \`radius\`.
- Every element also takes \`shadows\` (array of \`{ color, dx, dy, blur }\` in
  document px, rendered as chained \`filter: drop-shadow()\`), \`blur\` (px,
  \`filter: blur()\`) and \`transform3d\` (element-level 3D; a patch MERGES, \`null\`
  removes it — order is perspective → translate → rotate → skew → scale, degrees
  for angles). A stroke's optional \`paint\` (same Paint shape) fills it with a
  gradient / texture instead of \`color\`. Text elements have \`autoHeight\` (fixed
  width, height follows content); \`shape:"svg"\` elements have \`path\` +
  \`pathUnit\` (\`"px"\` for text-outline paths) — writing \`path\` bakes away the
  generator binding.
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
\`{ genId, params, seed }\` and become ordinary shape elements afterwards.

Units (also in \`get_typography_capabilities().units\`): frame x/y/w/h are
document px, \`rot\` is RADIANS. \`fontSize\` and \`letterSpacing\` are px (NOT em:
8 = 8px between glyphs); \`lineHeight\` is a MULTIPLIER of the font size (1.2 =
120%). Generator params are authored in a 0..100 box stretched to the element
frame; length-like values are ~1% of the frame side each, ratio-like values
(range 0..1) are fractions. A generator's \`notes\` flags clamping (e.g.
\`rings.width\` is capped by the ring pitch) and the paint rule (generators are
closed paths: paint them with \`fill\`, not \`stroke\` — a normal stroke width is
wider than a bar and neighbouring outlines merge into a solid plate).

Defaults for agent-created elements: shapes and generated shapes get
\`fill:{kind:'none'}\` and no stroke unless you pass them (nothing is drawn by
accident). No animation is attached unless you ask for one.

## Animation

\`typo_set_animation({ clipId?, elementId, animation, mode? })\` — one call,
one undo entry. Three forms:

\`\`\`json
{ "css": "@keyframes flip{from{transform:rotateY(90deg);opacity:0}to{transform:rotateY(0);opacity:1}}\\nanimation: flip .7s ease-out both;" }
\`\`\`
\`\`\`json
{ "preset": "slide-in-up", "duration": 0.6, "delay": 0, "loop": "once", "easing": "ease-out" }
\`\`\`
\`\`\`json
{
  "duration": 0.8, "easing": "ease-out",
  "keys": [
    { "at": 0,   "opacity": 0, "y": 40, "sx": 0.8 },
    { "at": 0.6, "opacity": 1, "y": 0,  "sx": 1.05 },
    { "at": 1,   "opacity": 1, "y": 0,  "sx": 1 }
  ]
}
\`\`\`
- \`css\` is the editor's "custom animation" syntax: one or more \`@keyframes name{…}\`
  blocks plus ONE top-level \`animation: name <duration> …;\` (comma-separate
  several). A bare keyframes body (\`from{…}to{…}\`) also works and takes its
  timing from \`duration\` / \`delay\` / \`loop\` / \`easing\`. **Any animatable CSS
  property** is allowed (3D rotate / clip-path / color / background-position …);
  names are namespaced per element, so two elements may each define
  \`@keyframes pulse\`. Top-level selectors, \`@import\` / \`@charset\` / \`@namespace\`
  and HTML tags are rejected — with the specific reason.
- \`at\` is 0..1 of the animation, or \`{ "beat": n }\` (converted with the project
  BPM). \`duration\` / \`delay\` are SECONDS; \`loop\` is \`"once" | "infinite" | number\`
  (\`iterations\` is accepted too — it is the read-back field name).
- Key props: \`opacity\`, \`x\`/\`y\` (px offsets), \`sx\`/\`sy\` (scale), \`rot\` (DEGREES),
  \`blur\` (px). 2..20 keys. When the motion needs something outside these seven
  properties, write \`css\` instead of approximating it.
- Preset names: \`get_typography_capabilities().animations.presets\`. Do not guess
  the spelling — a wrong name is rejected, not silently ignored.
- \`mode:'add'\` stacks another animation on the same element (each gets its own
  wrapper), so \`fade-in\` + \`shake\` compose. \`animation:null\` clears them all.
- Animations live in the document and are evaluated by the project clock: they
  are real in exports, not a preview-only effect. \`typo_add_element\` accepts the
  same field (\`animation\` / \`animations\`) so a new element can arrive animated
  in one call.

Bulk work: \`typo_add_elements\` / \`typo_update_elements\` take arrays and
commit ONE undo entry (array order = z order for adds). Every write returns
the stored element(s), so do not re-read the whole document to confirm.

Whole-document writes: \`typo_replace_doc\` drops bad elements (\`dropped\`), reports
every unrecognised key in \`droppedKeys\` (\`elements[2].colour\`) and every animation
entry that failed validation in \`droppedAnimations\` (\`elements[2].animations[0]\`).
Read both — a silent normalisation looks exactly like success.
\`get_typography_doc({detail:'full'})\` output is round-trippable: animations
(preset, keys and custom css), paints, styles, 3D and generator state all come back,
so edit-and-write-back is a legitimate workflow. Text is plain text on this path —
inline per-run formatting is not expressible.

Geometry: call \`typo_measure\` when text may overflow its frame, elements may
collide, or something may sit outside the canvas. It reports measured text
content height, clipped overflow, pairwise intersections and per-element
out-of-canvas amounts. \`render_frame({ only: { trackId } | { elementId } })\`
renders one layer in isolation without modifying the project.`;

const WORKFLOW_HELP = `# Working with this editor

1. Read before writing: \`get_scene({detail:'ids'})\` / \`get_typography_doc({detail:'ids'})\`.
2. Ask for capabilities only for the ids you intend to use
   (\`get_capabilities({detail:'params', ids:[...]})\`).
3. Make changes with explicit tool calls. Use \`typo_add_elements\` /
   \`typo_update_elements\` when a whole set changes together (one undo entry).
   The in-app panel wraps a whole turn in one transaction, so a failed attempt
   is one undo away.
4. Look at the result: \`render_frame({ t })\` returns an image; sizes default to
   640x360 and are cheap. Use \`frame_signature\` when you only need "did anything
   change / is there structure". \`render_sequence({from,to,step})\` gives a
   contact sheet for rhythm / beat timing. All three accept
   \`only:{trackId|elementId}\` (string or array) to inspect specific layers
   without touching the project — remember it hides effect tracks too, and the
   result's \`layers\` field says what really composited. For text overflow /
   overlaps, \`typo_measure\` is cheaper than guessing pixels. For fine detail,
   use \`region\` on render_frame instead of a huge render size.
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
- **Zoom instead of raising the resolution**: \`region: { x, y, w, h }\` (0..1)
  crops the rendered frame and upscales it to >=480px wide. ASCII / halftone /
  2px strokes are unreadable at 640 wide but obvious in a zoomed crop, and the
  token cost is the same.
- **Motion needs a sequence**: \`render_sequence({ from, to, step, size, cols })\`
  returns ONE contact-sheet image (each cell labelled with its time). A single
  still cannot tell you whether an accent lands on the beat. Keep cells small.
- Numeric alternative: \`frame_signature({ t, grid })\` returns per-channel means,
  spread, block means and sample colors. Use \`spread\` to answer "is there any
  structure" and per-channel means to catch color changes.
- Both \`render_frame\` and \`frame_signature\` echo \`layers\`: the tracks and clips
  that actually composited. When \`only\` is used, this is the only way to see that
  an effect track was hidden by the isolation (the picture looks identical to
  "my parameter did nothing").`;

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

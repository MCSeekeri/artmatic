/**
 * tools.ts — 应用内 Agent 的**工具表**（模型看得见的唯一清单）。
 *
 * ## 与 MCP 的关系
 *
 * `mcp/tools.mjs` 是同一批能力的网关侧声明（它还多一层 MCP 协议适配）。
 * 两边**名字集合必须一致**（应用内用短名，网关加 `artmatic_` 前缀），由
 * `tests/unit/agent-tools-parity.test.ts` 钉住 —— 加工具时忘了一边会立刻变红。
 *
 * ## 为什么描述是英文
 *
 * 这些句子是**给模型读的 API 文档**，不是界面文案（工具卡的标题走 i18n 的
 * `agent.*`）。英文与代码里的 GLSL / 类型名同语言，模型对「uniform / clip /
 * keyframe」这类词的对齐更稳；也避免 `i18n.test.ts` 把几十条指令当成
 * 「未抽取的界面文案」。
 *
 * ## `writes` 字段
 *
 * 会话层据此决定「这一轮要不要包事务」，以及面板上要不要提示「已修改 N 处」。
 * 漏标的后果是撤销栈里多出几条中间记录 —— 不报错，但用户按 Ctrl+Z 时会
 * 落到一个自己没见过的状态。
 */

export type ToolParamKind =
  | 'string'
  | 'number'
  | 'integer'
  | 'boolean'
  | 'size'
  | 'scalars'
  | 'frameRange'
  | 'curve'
  | 'json'
  | 'stringArray';

export interface ToolParam {
  key: string;
  kind: ToolParamKind;
  desc: string;
  required?: boolean;
  enum?: readonly string[];
}

export interface ToolSpec {
  /** 应用内短名。MCP 侧是 `artmatic_` + 这个名字。 */
  name: string;
  description: string;
  params: ToolParam[];
  /** 会改动工程（会话层据此包事务 / 计数）。 */
  writes: boolean;
  /** 慢操作（导出 / 编译 / 试挂）：超时与进度提示另算。 */
  slow?: boolean;
  /**
   * 只在应用内可用（MCP 网关没有等价能力）。
   *
   * 目前只有 `ask_user`：它需要**一个正在看着面板的人**来回答；外部 MCP 客户端
   * 可能没有 UI，所以网关里不声明它（一致性测试会跳过 appOnly 的条目）。
   */
  appOnly?: boolean;
}

const p = (
  key: string,
  kind: ToolParamKind,
  desc: string,
  extra: Partial<ToolParam> = {},
): ToolParam => ({ key, kind, desc, ...extra });

const req = (key: string, kind: ToolParamKind, desc: string, extra: Partial<ToolParam> = {}): ToolParam => ({
  key,
  kind,
  desc,
  required: true,
  ...extra,
});

const CLIP_ID = req('clipId', 'string', 'Clip id (from get_scene).');
const OPT_CLIP_ID = p('clipId', 'string', 'Text clip id. Omit to use the document open in the typography editor.');
const ELEMENT_ID = req('elementId', 'string', 'Typography element id.');
const T = p('t', 'number', 'Time in SECONDS (snapped to the frame grid). Omit = current playhead.');
const SIZE = p('size', 'size', 'Pixel size { w, h }. Omit = project resolution.');

export const AGENT_TOOLS: ToolSpec[] = [
  /* ---------------------------------------------------------------- 读 */
  {
    name: 'describe',
    description: 'Project metadata: API/schema version, fps, resolution, duration. Call it first.',
    params: [],
    writes: false,
  },
  {
    name: 'help',
    description:
      'Fetch a topic manual. Topics: plugin-api (how to write a plugin: shader preludes, ' +
      'parameter types, dispatch rules, examples), timeline, typography, workflow, images. ' +
      'Read `plugin-api` BEFORE writing plugin source.',
    params: [p('topic', 'string', 'One of: plugin-api, timeline, typography, workflow, images.')],
    writes: false,
  },
  {
    name: 'ask_user',
    description:
      'Pause and ask the user a direct question. Use it when the request is ambiguous, when a ' +
      'destructive action needs a decision, or when you are blocked after repeated failed calls. ' +
      'Do NOT guess the answer. The task resumes with the answer as the tool result.',
    params: [
      req('question', 'string', 'One short question, in the user\'s language.'),
      p('options', 'stringArray', 'Optional quick choices (2-4). The user can still type a custom answer.'),
      p('allowFreeText', 'boolean', 'Allow a free-form answer (default true).'),
    ],
    writes: false,
    appOnly: true,
  },
  {
    name: 'get_scene',
    description:
      "Compact snapshot at time t: tracks (with z order), clips (with `active`), curves. " +
      "Use detail:'ids' for a cheap overview of a long project.",
    params: [T, p('detail', 'string', "ids | full (default full).", { enum: ['ids', 'full'] })],
    writes: false,
  },
  {
    name: 'get_capabilities',
    description:
      "Legal ids and (with detail:'params') their parameter schemas: keys, types, ranges, options, " +
      'defaults, keyframability. Always take def ids from here instead of inventing them.',
    params: [
      p('detail', 'string', 'ids (cheap) | params (with parameter tables).', { enum: ['ids', 'params'] }),
      p('ids', 'stringArray', 'Optional filter: only these def ids. Prefer filtering when using detail=params.'),
    ],
    writes: false,
  },
  {
    name: 'get_typography_capabilities',
    description:
      'Shape kinds (with supported params), 22 procedural SVG generators (with parameter schemas), ' +
      'themes, paint forms, blend modes, layout ops.',
    params: [],
    writes: false,
  },
  {
    name: 'get_typography_doc',
    description:
      "A text clip's typography document. detail:'ids' gives element ids / kinds / frames only; " +
      "detail:'full' also gives styles, paints, text and generator state.",
    params: [OPT_CLIP_ID, p('detail', 'string', "ids | full (default full).", { enum: ['ids', 'full'] })],
    writes: false,
  },
  {
    name: 'get_clip',
    description: 'One clip with its effect chain, parameter values, curves and transition.',
    params: [CLIP_ID],
    writes: false,
  },
  {
    name: 'undo_state',
    description: 'Whether undo/redo is available. Useful right after a write to confirm it landed.',
    params: [],
    writes: false,
  },
  {
    name: 'frame_signature',
    description:
      'Cheap numeric fingerprint of a frame: per-channel means, spread (structure detector), ' +
      'block means, sample colors. Use this for self-checks; use render_frame when you must look.',
    params: [T, SIZE, p('grid', 'integer', 'Block grid size (default 4).')],
    writes: false,
  },
  {
    name: 'render_frame',
    description:
      'Render one frame through the real preview/export path and return it as an image. ' +
      'Default size 640x360 (cheap). Use it to judge composition and visual quality.',
    params: [T, SIZE],
    writes: false,
    slow: true,
  },

  /* ------------------------------------------------------------ 时间轴写 */
  {
    name: 'add_track',
    description:
      'Add a track. New tracks land at the END of tracks[], which is the BOTTOM of the composite ' +
      '(tracks[0] is front-most).',
    params: [
      req('kind', 'string', 'visual | audio', { enum: ['visual', 'audio'] }),
      p('name', 'string', 'Track name.'),
    ],
    writes: true,
  },
  {
    name: 'remove_track',
    description: 'Remove a track and all of its clips (one undo entry).',
    params: [req('trackId', 'string', 'Track id.')],
    writes: true,
  },
  {
    name: 'move_track',
    description: 'Move a track from index `from` to index `to`. Track order IS compositing order.',
    params: [
      req('from', 'integer', 'Current index (0 = front-most).'),
      req('to', 'integer', 'Target index.'),
    ],
    writes: true,
  },
  {
    name: 'set_track',
    description: 'Enable/disable or rename a track. A disabled track contributes nothing to the frame.',
    params: [
      req('trackId', 'string', 'Track id.'),
      p('enabled', 'boolean', 'Visibility.'),
      p('name', 'string', 'New name.'),
    ],
    writes: true,
  },
  {
    name: 'add_clip',
    description:
      "Add a source clip. kind: solid | algo | image | video | text. For algo pass `generator` + " +
      '`params` (keys from get_capabilities). For text, `doc` is optional: an empty document is created ' +
      'and you fill it with typo_* tools. Times in seconds.',
    params: [
      req('trackId', 'string', 'Visual track id.'),
      req('kind', 'string', 'solid | algo | image | video | text', {
        enum: ['solid', 'algo', 'image', 'video', 'text'],
      }),
      req('start', 'number', 'Start time in seconds.'),
      req('end', 'number', 'End time in seconds (> start).'),
      p('id', 'string', 'Explicit clip id (for reproducible scripts).'),
      p('label', 'string', 'Clip label shown on the timeline.'),
      p('generator', 'string', 'Generator id (kind=algo).'),
      p('params', 'scalars', 'Generator parameters (kind=algo).'),
      p('color', 'string', 'Hex color (kind=solid).'),
      p('assetId', 'string', 'Asset id (kind=image | video).'),
      p('srcIn', 'number', 'Source offset in seconds (kind=video).'),
      p('speed', 'number', 'Playback speed (kind=video).'),
      p('doc', 'json', 'Typography document (kind=text). Omit for a blank document.'),
      p('blend', 'string', 'Blend mode (see get_capabilities.blendModes).'),
      p('opacity', 'number', '0..1'),
      p('fit', 'string', 'contain | cover | stretch', { enum: ['contain', 'cover', 'stretch'] }),
      p('fadeSec', 'number', 'Fade in/out duration in seconds.'),
    ],
    writes: true,
  },
  {
    name: 'add_effect_clip',
    description:
      'Add an effect (adjustment) clip. It only affects tracks BELOW it. `chain` is applied in order.',
    params: [
      req('trackId', 'string', 'Visual track id.'),
      req('start', 'number', 'Start time in seconds.'),
      req('end', 'number', 'End time in seconds.'),
      p('chain', 'json', 'Array of { defId, values? } (defIds from get_capabilities).'),
      p('label', 'string', 'Clip label.'),
      p('fadeSec', 'number', 'Fade duration in seconds.'),
      p('affectDepth', 'integer', 'Only the nearest N enabled tracks below (0 = all).'),
    ],
    writes: true,
  },
  {
    name: 'remove_clip',
    description: 'Remove a clip by id.',
    params: [CLIP_ID],
    writes: true,
  },
  {
    name: 'move_clip',
    description:
      'Move a clip to another track / start time. Placement follows project.overlapBehavior; ' +
      'a rejected placement changes nothing (read the error instead of retrying blindly).',
    params: [
      CLIP_ID,
      req('targetTrackId', 'string', 'Destination track id.'),
      req('newStart', 'number', 'New start time in seconds.'),
    ],
    writes: true,
  },
  {
    name: 'resize_clip',
    description: 'Trim one edge of a clip.',
    params: [
      CLIP_ID,
      req('edge', 'string', 'start | end', { enum: ['start', 'end'] }),
      req('time', 'number', 'New edge time in seconds.'),
    ],
    writes: true,
  },
  {
    name: 'split_clip',
    description: 'Split a clip at time `at`. Returns the left id (unchanged) and the new right id.',
    params: [CLIP_ID, req('at', 'number', 'Cut time in seconds, inside the clip.')],
    writes: true,
  },
  {
    name: 'set_clip_props',
    description:
      'Patch label / fadeSec / blend / opacity / transform / fit / affectDepth. ' +
      'transform is { x, y, sx, sy, rot } with x/y as 0..1 anchors and rot in radians.',
    params: [CLIP_ID, req('patch', 'json', 'Whitelisted fields only.')],
    writes: true,
  },
  {
    name: 'set_params',
    description:
      "Set source params (target:'source') or an effect instance's params (target:'effect' + chainIndex). " +
      'Unknown keys are rejected — read get_capabilities first.',
    params: [
      CLIP_ID,
      req('target', 'string', 'source | effect', { enum: ['source', 'effect'] }),
      p('chainIndex', 'integer', 'Effect index inside the chain (required for target=effect).'),
      req('params', 'scalars', 'Parameter key/value pairs.'),
    ],
    writes: true,
  },
  {
    name: 'set_curve',
    description:
      'Attach a keyframe curve to a parameter, or pass null to remove it. ' +
      'Only range parameters can be keyframed. Keys are relative to clip start unless curve.beatAnchor.',
    params: [
      CLIP_ID,
      req('param', 'string', 'Parameter key (from get_clip.curves / capability params).'),
      p('curve', 'curve', 'Curve object, or null / omitted to remove the curve.'),
    ],
    writes: true,
  },
  {
    name: 'add_effect',
    description: "Append (or insert at `index`) an effect instance to an effect clip's chain.",
    params: [
      CLIP_ID,
      req('defId', 'string', 'Effect def id.'),
      p('values', 'scalars', 'Parameter overrides (defaults are filled in).'),
      p('index', 'integer', 'Insert position (default: end).'),
    ],
    writes: true,
  },
  {
    name: 'remove_effect',
    description: 'Remove one effect instance from a chain.',
    params: [CLIP_ID, req('chainIndex', 'integer', 'Index inside the chain.')],
    writes: true,
  },
  {
    name: 'reorder_effect',
    description: 'Move an effect instance inside a chain.',
    params: [CLIP_ID, req('from', 'integer', 'Current index.'), req('to', 'integer', 'Target index.')],
    writes: true,
  },
  {
    name: 'set_transition',
    description:
      'Attach an outgoing transition to a source clip. The window is centred on clip.end and clamped ' +
      'by both neighbours; the next clip on the same track is the incoming side.',
    params: [
      CLIP_ID,
      req('defId', 'string', 'Transition id.'),
      req('duration', 'number', 'Duration in seconds.'),
      p('values', 'scalars', 'Transition parameter overrides.'),
    ],
    writes: true,
  },
  {
    name: 'clear_transition',
    description: 'Remove the outgoing transition from a clip.',
    params: [CLIP_ID],
    writes: true,
  },
  {
    name: 'set_project',
    description: 'Change fps / resolution / duration / beatGrid / overlapBehavior. Each field is one undo entry.',
    params: [
      p('fps', 'number', 'Frame rate.'),
      p('resolution', 'size', 'Canvas size.'),
      p('duration', 'number', 'Duration in seconds.'),
      p('beatGrid', 'json', '{ bpm, offset, beatsPerBar }.'),
      p('overlapBehavior', 'string', 'push | reject | trim', { enum: ['push', 'reject', 'trim'] }),
    ],
    writes: true,
  },
  {
    name: 'load_scene',
    description:
      'Replace the whole project content with a Project JSON (one undo entry). Prefer semantic calls ' +
      'for local edits; use this for wholesale re-composition. Do not paste the whole project in ' +
      'context unless you must — read with detail:ids first.',
    params: [req('project', 'json', 'A complete Project object.')],
    writes: true,
  },
  {
    name: 'begin_transaction',
    description: 'Open a transaction so the following writes collapse into ONE undo entry.',
    params: [],
    writes: false,
  },
  {
    name: 'commit_transaction',
    description: 'Close the transaction opened by begin_transaction.',
    params: [p('label', 'string', 'Undo label.')],
    writes: true,
  },
  {
    name: 'cancel_transaction',
    description: 'Roll back everything since begin_transaction.',
    params: [],
    writes: true,
  },
  {
    name: 'undo',
    description: 'Undo one entry.',
    params: [],
    writes: true,
  },
  {
    name: 'redo',
    description: 'Redo one entry.',
    params: [],
    writes: true,
  },

  /* ---------------------------------------------------------------- 排版 */
  {
    name: 'typo_add_element',
    description:
      "Add a text / shape / image element. element.kind selects the variant: " +
      "{kind:'text', text, frame?, style?, fill?, boxFill?, boxStroke?} | " +
      "{kind:'shape', shape, frame?, fill?, stroke?, radius?, sides?, waist?, inner?, angle?, path?} | " +
      "{kind:'image', assetId, frame?, fit?, crop?}. Frames are { x, y, w, h, rot } in document px.",
    params: [OPT_CLIP_ID, req('element', 'json', 'Element input (see description).')],
    writes: true,
  },
  {
    name: 'typo_add_generated_shape',
    description:
      'Insert one of the 22 procedural SVG generators (rings, barcodes, contours, ...). Pass genId and ' +
      'optionally params / seed; the element becomes an ordinary shape afterwards.',
    params: [
      OPT_CLIP_ID,
      req('genId', 'string', 'Generator id (get_typography_capabilities).'),
      p('params', 'scalars', 'Generator parameters.'),
      p('seed', 'integer', 'Unsigned 32-bit seed (deterministic output).'),
      p('frame', 'json', 'Optional { x, y, w, h, rot }.'),
      p('name', 'string', 'Element name.'),
      p('fill', 'json', 'Paint object.'),
      p('stroke', 'json', 'Stroke object or null.'),
    ],
    writes: true,
  },
  {
    name: 'typo_update_element',
    description:
      'Patch one element: name, frame, blend, opacity, visible, locked, text, style, fill, boxFill, ' +
      'boxStroke, glyphStroke (text only: {color, width}, -webkit-text-stroke), ' +
      'stroke, radius, sides, waist, inner, angle, evenOdd, fit, crop, ' +
      'shadows (array of {color, dx, dy, blur}, document px), blur (px), ' +
      'gen (to re-seed a generated shape). Unknown keys are ignored.',
    params: [OPT_CLIP_ID, ELEMENT_ID, req('patch', 'json', 'Whitelisted fields.')],
    writes: true,
  },
  {
    name: 'typo_set_text',
    description: 'Replace an element\'s text (discards inline per-run formatting of the old runs).',
    params: [OPT_CLIP_ID, ELEMENT_ID, req('text', 'string', 'New plain text (may contain newlines).')],
    writes: true,
  },
  {
    name: 'typo_remove_element',
    description: 'Remove one element from the document.',
    params: [OPT_CLIP_ID, ELEMENT_ID],
    writes: true,
  },
  {
    name: 'typo_reorder_element',
    description: 'Change z order: front | back | forward | backward (array index = z order).',
    params: [
      OPT_CLIP_ID,
      ELEMENT_ID,
      req('op', 'string', 'front | back | forward | backward', {
        enum: ['front', 'back', 'forward', 'backward'],
      }),
    ],
    writes: true,
  },
  {
    name: 'typo_group',
    description: 'Group elements so they share a background / border shell. Members become contiguous in z order.',
    params: [
      OPT_CLIP_ID,
      req('elementIds', 'stringArray', 'At least 2 element ids.'),
      p('name', 'string', 'Group name.'),
    ],
    writes: true,
  },
  {
    name: 'typo_ungroup',
    description: 'Ungroup the groups that these elements belong to.',
    params: [OPT_CLIP_ID, req('elementIds', 'stringArray', 'Element ids.')],
    writes: true,
  },
  {
    name: 'typo_layout',
    description:
      "Arrange elements. op: align (axis left|center-h|right|top|middle|bottom; target canvas|selection) | " +
      "distribute (axis h|v, needs >=3) | grid (cols, rows?, gap?, margin?) | row | column. " +
      'Omit elementIds to lay out every unlocked element.',
    params: [
      OPT_CLIP_ID,
      req('op', 'string', 'align | distribute | grid | row | column', {
        enum: ['align', 'distribute', 'grid', 'row', 'column'],
      }),
      p('axis', 'string', 'align/distribute axis.'),
      p('target', 'string', 'canvas | selection (align only).', { enum: ['canvas', 'selection'] }),
      p('elementIds', 'stringArray', 'Elements to move.'),
      p('cols', 'integer', 'grid columns.'),
      p('rows', 'integer', 'grid rows.'),
      p('gap', 'number', 'Gap in px.'),
      p('margin', 'number', 'Outer margin in px.'),
    ],
    writes: true,
  },
  {
    name: 'typo_set_background',
    description: "Set the document background Paint (kind none | solid | linear | radial | texture).",
    params: [OPT_CLIP_ID, req('paint', 'json', 'Paint object.')],
    writes: true,
  },
  {
    name: 'typo_set_theme',
    description: 'Switch the document theme (null = default). Elements using @slot references recolor.',
    params: [OPT_CLIP_ID, p('theme', 'string', 'Theme id, or null for the default.')],
    writes: true,
  },
  {
    name: 'typo_replace_doc',
    description:
      'Replace the whole typography document (one undo entry). Bad elements are dropped instead of ' +
      'failing the whole call — check the returned `dropped` count.',
    params: [OPT_CLIP_ID, req('doc', 'json', 'A complete TypographyDocument.')],
    writes: true,
  },

  /* ---------------------------------------------------------------- 插件 */
  {
    name: 'plugin_try',
    description:
      'Validate + import + compile a single-file plugin in memory (no disk write). Returns qualified ' +
      "ids ('<plugin>/<local>') and structured issues. Fix issues and call again with the same id. " +
      'Requires explicit user approval (the source runs in the page immediately): without it this ' +
      'returns code=needs-approval and the panel asks the user. Call help(plugin-api) before writing source.',
    params: [
      req('id', 'string', 'Plugin id: [a-z0-9][a-z0-9._-]*'),
      req('name', 'string', 'Display name.'),
      req('source', 'string', 'Complete ESM source exporting `plugin`.'),
    ],
    writes: false,
    slow: true,
  },
  {
    name: 'plugin_install',
    description:
      'Write the tried plugin into the project plugins/ directory. Requires explicit user approval: ' +
      'without it this returns code=needs-approval and the panel asks the user.',
    params: [req('pluginId', 'string', 'Plugin id from plugin_try.')],
    writes: false,
  },
  {
    name: 'plugin_list',
    description: 'Installed plugins with status, counts, issues and whether a draft exists.',
    params: [],
    writes: false,
  },
  {
    name: 'plugin_discard',
    description: 'Drop the in-memory draft (does not delete an installed file).',
    params: [req('pluginId', 'string', 'Plugin id.')],
    writes: false,
  },
  {
    name: 'plugin_remove',
    description: 'Unregister a plugin and delete its file from the project directory.',
    params: [req('pluginId', 'string', 'Plugin id.')],
    writes: false,
  },
  {
    name: 'plugin_source',
    description: 'Return the current draft source (for review / diffing).',
    params: [req('pluginId', 'string', 'Plugin id.')],
    writes: false,
  },

  /* ---------------------------------------------------------------- 导出 */
  {
    name: 'export',
    description:
      'Export the project. format: mp4 | png (zip of the sequence) | gif. frameRange uses FRAME ' +
      'numbers, left-closed right-open. Large exports take a while; prefer small sizes for checks.',
    params: [
      req('format', 'string', 'mp4 | png | gif', { enum: ['mp4', 'png', 'gif'] }),
      p('frameRange', 'frameRange', '{ from, to } in frames.'),
      SIZE,
      p('frameStep', 'integer', 'Render every Nth frame (GIF).'),
    ],
    writes: false,
    slow: true,
  },
];

/** `name → spec`。会话层与执行器都按它查。 */
export const TOOL_BY_NAME = new Map(AGENT_TOOLS.map((t) => [t.name, t]));

/* ------------------------------------------------------- JSON Schema 产出 */

function paramSchema(param: ToolParam): Record<string, unknown> {
  const base: Record<string, unknown> = { description: param.desc };
  switch (param.kind) {
    case 'string':
      base.type = 'string';
      break;
    case 'number':
      base.type = 'number';
      break;
    case 'integer':
      base.type = 'integer';
      break;
    case 'boolean':
      base.type = 'boolean';
      break;
    case 'size':
      base.type = 'object';
      base.properties = { w: { type: 'integer' }, h: { type: 'integer' } };
      base.required = ['w', 'h'];
      base.additionalProperties = false;
      break;
    case 'scalars':
      base.type = 'object';
      base.additionalProperties = { type: ['number', 'string'] };
      break;
    case 'frameRange':
      base.type = 'object';
      base.properties = { from: { type: 'integer' }, to: { type: 'integer' } };
      base.required = ['from', 'to'];
      base.additionalProperties = false;
      break;
    case 'curve':
      base.type = ['object', 'null'];
      break;
    case 'stringArray':
      base.type = 'array';
      base.items = { type: 'string' };
      break;
    default:
      // `json`: 结构由控制平面校验，这里只要求是对象。
      base.type = ['object', 'array', 'string', 'number', 'boolean', 'null'];
      break;
  }
  if (param.enum) base.enum = [...param.enum];
  return base;
}

export interface OpenAiTool {
  type: 'function';
  function: { name: string; description: string; parameters: Record<string, unknown> };
}

/**
 * 一个工具参数的 JSON Schema（`type:'object'`）。
 *
 * 抽出来是因为 **Anthropic 也要用**：它的 `input_schema` 与 OpenAI 的 `parameters`
 * 是同一份东西，只是外面套的壳不同。写两份的话，某个参数的 `enum` / `required`
 * 迟早只有一边更新。
 */
export function toolParameters(spec: ToolSpec): Record<string, unknown> {
  const properties: Record<string, unknown> = {};
  const required: string[] = [];
  for (const param of spec.params) {
    properties[param.key] = paramSchema(param);
    if (param.required) required.push(param.key);
  }
  return { type: 'object', properties, required, additionalProperties: false };
}

/** Chat Completions 的 `tools` 数组。 */
export function openAiTools(specs: readonly ToolSpec[] = AGENT_TOOLS): OpenAiTool[] {
  return specs.map((t) => ({
    type: 'function' as const,
    function: { name: t.name, description: t.description, parameters: toolParameters(t) },
  }));
}

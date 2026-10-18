/**
 * tools.mjs — MCP 工具清单 + 入参校验。
 *
 * **这一层的定位**（方案 `docs/agent-control-plane.md` §2.1）：网关是**薄壳** ——
 * 不含业务逻辑（业务在页面内的控制平面里），只做三件事：
 *   1. schema：把工具入参的形状声明一次，同时产出 JSON Schema（给 `tools/list`）
 *      与校验函数（给 `tools/call`）；
 *   2. 协议适配：MCP ⇄ CDP；
 *   3. 错误归一：控制平面本来就不抛异常，这里只保证**校验失败也是同一种形状**。
 *
 * ## 为什么把「声明」与「校验」放在同一个来源
 *
 * 各写一份的 bug 形态很具体：JSON Schema 里改了枚举、校验函数忘了跟着改，
 * 于是「客户端按 schema 传的值被网关拒掉」——而两边看起来都对。
 * 所以这里只有一张表：`F.*` 描述字段，`buildSchema` 与 `validateArgs` 都读它。
 *
 * ## 为什么拒绝未知字段
 *
 * 拼错一个参数名（`trackid` / `clipID`）如果不报错，MCP 客户端会以为调用成功了，
 * 而工具用的是默认值 —— 这是最难查的一类「静默」。所以
 * `additionalProperties: false` 与校验里的 unknown-key 拒绝是**同一个决定**。
 *
 * ## 单位纪律
 *
 * `t` 是**秒**（控制平面会吸附到帧栅格）；要帧号的地方字段名带 `Frame`
 * （`frameRange.from` / `frameStep`）。与 `src/agent/types.ts` 顶部那条是同一件事。
 */

/* --------------------------------------------------------------- 字段声明 */

/**
 * 字段类型。`json` 是给 `tools/list` 的 JSON Schema 片段，`check` 是校验函数的
 * 单值判据（返回错误描述或 null）。
 */
const KINDS = {
  string: {
    json: () => ({ type: 'string' }),
    check: (v) => (typeof v === 'string' ? null : '必须是字符串'),
  },
  number: {
    json: () => ({ type: 'number' }),
    check: (v) => (typeof v === 'number' && Number.isFinite(v) ? null : '必须是有限数字'),
  },
  integer: {
    json: () => ({ type: 'integer' }),
    check: (v) => (Number.isInteger(v) ? null : '必须是整数'),
  },
  boolean: {
    json: () => ({ type: 'boolean' }),
    check: (v) => (typeof v === 'boolean' ? null : '必须是布尔值'),
  },
  /** `{ w, h }`：像素尺寸。非整数会被渲染层四舍五入，这里先挡住。 */
  size: {
    json: () => ({
      type: 'object',
      properties: { w: { type: 'integer' }, h: { type: 'integer' } },
      required: ['w', 'h'],
      additionalProperties: false,
    }),
    check: (v) => {
      if (typeof v !== 'object' || v === null || Array.isArray(v)) return '必须是 { w, h }';
      if (!Number.isInteger(v.w) || !Number.isInteger(v.h)) return 'w / h 必须是整数';
      if (v.w < 2 || v.h < 2) return 'w / h 至少为 2';
      return null;
    },
  },
  /** `Record<string, number | string>`：特效 / 生成器参数表。 */
  scalars: {
    json: () => ({ type: 'object', additionalProperties: { type: ['number', 'string'] } }),
    check: (v) => {
      if (typeof v !== 'object' || v === null || Array.isArray(v)) return '必须是对象';
      for (const [k, x] of Object.entries(v)) {
        if (typeof x !== 'number' && typeof x !== 'string') return `${k} 必须是数字或字符串`;
        if (typeof x === 'number' && !Number.isFinite(x)) return `${k} 不是有限数字`;
      }
      return null;
    },
  },
  /** `{ from, to }`：**帧号**，左闭右开（AGENTS §5.8 的约定）。 */
  frameRange: {
    json: () => ({
      type: 'object',
      properties: { from: { type: 'integer' }, to: { type: 'integer' } },
      required: ['from', 'to'],
      additionalProperties: false,
    }),
    check: (v) => {
      if (typeof v !== 'object' || v === null || Array.isArray(v)) return '必须是 { from, to }';
      if (!Number.isInteger(v.from) || !Number.isInteger(v.to)) return 'from / to 必须是整数帧号';
      if (v.from < 0) return 'from 不能为负';
      if (v.to <= v.from) return 'to 必须大于 from（左闭右开）';
      return null;
    },
  },
  /** `Curve | null`：形状由控制平面深校验（它才是知道键约定的一方），这里只看外壳。 */
  curve: {
    json: () => ({ type: ['object', 'null'] }),
    check: (v) => (v === null || (typeof v === 'object' && !Array.isArray(v)) ? null : '必须是曲线对象或 null'),
  },
  /** 字符串数组（能力清单按 id 过滤、排版元素的 id 列表）。 */
  stringArray: {
    json: () => ({ type: 'array', items: { type: 'string' } }),
    check: (v) => {
      if (!Array.isArray(v)) return '必须是字符串数组';
      for (const x of v) if (typeof x !== 'string') return '数组元素必须是字符串';
      return null;
    },
  },
  /** 透传：结构由控制平面校验（它才有 schema 与注册表）。 */
  any: {
    json: () => ({}),
    check: () => null,
  },
};

const F = Object.fromEntries(
  Object.entries(KINDS).map(([name, def]) => [name, (extra = {}) => ({ kind: name, ...extra })]),
);

/**
 * 一个「指向已有对象」的 id 字段：**一律必需**。
 *
 * 每张表里的 id 都是「你要改哪一个」，没有可省略的余地 —— 省了就只能靠猜，
 * 而猜错的表现是改到别的片段上（还会入撤销栈，用户以为自己没动过那一段）。
 * 合法性（这个 id 真的存在吗）由控制平面判，它才有 `Project`。
 */
const ID = (what) => F.string({ required: true, description: `${what} id。` });

/* ------------------------------------------------------------- Schema 产出 */

/** 字段声明 → JSON Schema 片段。 */
export function fieldSchema(spec) {
  const base = KINDS[spec.kind].json();
  const out = { ...base };
  if (spec.description) out.description = spec.description;
  if (spec.enum) {
    out.enum = spec.enum;
    if (!out.type) out.type = 'string';
  }
  if (spec.minimum !== undefined) out.minimum = spec.minimum;
  if (spec.maximum !== undefined) out.maximum = spec.maximum;
  if (out.type === undefined && !out.enum && out.additionalProperties === undefined) {
    // `any`：JSON Schema 里空对象即「任意」
    return out;
  }
  return out;
}

export function buildSchema(args) {
  const properties = {};
  const required = [];
  for (const [name, spec] of Object.entries(args)) {
    properties[name] = fieldSchema(spec);
    if (spec.required) required.push(name);
  }
  return {
    type: 'object',
    properties,
    required,
    // 见文件头：拼错的参数名必须报错，不许静默取默认值。
    additionalProperties: false,
  };
}

function bad(message, detail) {
  return { ok: false, error: { code: 'invalid-argument', message, ...(detail ? { detail } : {}) } };
}

/**
 * 校验一次工具调用的入参。**不抛异常** —— 失败也是一种正常返回值
 * （与控制平面的 `{ ok, data }` 包法是同一个理由）。
 */
export function validateArgs(tool, raw) {
  const args = raw === undefined || raw === null ? {} : raw;
  if (typeof args !== 'object' || Array.isArray(args)) {
    return bad('参数必须是对象');
  }

  const spec = tool.args ?? {};
  const unknown = Object.keys(args).filter((k) => !(k in spec));
  if (unknown.length > 0) {
    return bad(`不认识的参数：${unknown.join(', ')}`, { unknown, known: Object.keys(spec) });
  }

  const value = {};
  for (const [name, def] of Object.entries(spec)) {
    const v = args[name];
    if (v === undefined) {
      if (def.required) return bad(`缺少必需参数 ${name}`);
      continue;
    }
    const err = KINDS[def.kind].check(v);
    if (err) return bad(`${name}：${err}`, { field: name });
    if (def.enum && !def.enum.includes(v)) {
      return bad(`${name} 只能是 ${def.enum.join(' / ')}`, { field: name, validIds: def.enum });
    }
    if (def.minimum !== undefined && v < def.minimum) {
      return bad(`${name} 不能小于 ${def.minimum}`, { field: name, minimum: def.minimum });
    }
    if (def.maximum !== undefined && v > def.maximum) {
      return bad(`${name} 不能大于 ${def.maximum}`, { field: name, maximum: def.maximum });
    }
    value[name] = v;
  }
  return { ok: true, value };
}

/* ------------------------------------------------- 需要「外部事实」的校验 */

/**
 * 某个 id 必须在能力清单里（`defId` / `generator` / `blend`）。
 *
 * **必须在网关拦一次**：agent 最容易犯的错就是凭印象写 `defId`，而着色器是
 * 惰性编译的，拼错的特效在作用到画面之前不会有任何提示（AGENTS §5.5）。
 * 控制平面也会拦（那里有注册表），这里提前拦的好处是**连往返都省了**。
 */
export function checkIdInList(value, list, what) {
  if (list.includes(value)) return { ok: true };
  return {
    ok: false,
    error: {
      code: 'not-found',
      message: `${what} ${value} 不在能力清单里`,
      detail: { validIds: list },
    },
  };
}

/**
 * `frameRange` 越界检查。
 *
 * 越界本身不会崩（`runExport` 会再夹一次），但它会让「导了多少帧」与 agent 的
 * 预期不符 —— 而 agent 正是靠帧数算体积与时长预算的。所以宁可在这里报错，
 * 也不要把一个被悄悄改过的区间放过去。
 */
export function checkFrameRange(range, totalFrames) {
  if (!range) return { ok: true };
  if (range.from >= totalFrames) {
    return {
      ok: false,
      error: {
        code: 'invalid-argument',
        message: `frameRange.from ${range.from} 超出工程帧数（0..${totalFrames - 1}）`,
        detail: { totalFrames },
      },
    };
  }
  if (range.to > totalFrames) {
    return {
      ok: false,
      error: {
        code: 'invalid-argument',
        message: `frameRange.to ${range.to} 超出工程帧数（最多 ${totalFrames}）`,
        detail: { totalFrames },
      },
    };
  }
  return { ok: true };
}

/* --------------------------------------------------------------- 工具清单 */

const t = (v) => F.number({ description: '秒。会被吸附到帧栅格。', ...v });

/**
 * 工具表。`kind` 只用于文档与统计，网关不据此改行为。
 * `call` 字段没有 —— 映射写在 `index.mjs`（那里才有 bridge 与控制平面的接线）。
 */
export const TOOLS = [
  /* --------------------------------------------------------------- 读 */
  {
    name: 'artmatic_describe',
    kind: 'read',
    description: '握手 / 能力协商：API 版本、schema 版本、帧率、分辨率、时长。',
    args: {},
  },
  {
    name: 'artmatic_get_scene',
    kind: 'read',
    description:
      '工程在 t 时刻的紧凑快照：轨道（含 z 序）、片段（含 active）、曲线。' +
      "detail:'ids' 只给 id/start/end/label，用于长工程里先探路。",
    args: {
      t: t({ description: '查询时刻（秒）。省略 = 当前播放头。' }),
      detail: F.string({ enum: ['ids', 'full'], description: '默认 full。' }),
    },
  },
  {
    name: 'artmatic_get_capabilities',
    kind: 'read',
    description:
      '生成器 / 特效 / 转场 / 混合模式 / fit / 曲线模式清单。**选 id 只依据它**。' +
      "detail:'params' 额外给出参数表（键 / 类型 / 区间 / 选项 / 默认值 / 能否打关键帧），" +
      '配合 ids 过滤，避免一次吐几千 token。',
    args: {
      detail: F.string({ enum: ['ids', 'params'], description: '默认 ids。' }),
      ids: F.stringArray({ description: '只展开这几个 def id（省略 = 全部）。' }),
    },
  },
  {
    name: 'artmatic_get_clip',
    kind: 'read',
    description: '单个片段（含关键帧与特效链）。',
    args: { clipId: ID('片段') },
  },
  {
    name: 'artmatic_list_projects',
    kind: 'read',
    description: '已打开的工程列表（多工程是常态：顶栏选项卡每个是一份工程）。',
    args: {},
  },
  {
    name: 'artmatic_undo_state',
    kind: 'read',
    description: '撤销栈状态 { canUndo, canRedo }。agent 写完一步可以据此确认真的入栈了。',
    args: {},
  },
  {
    name: 'artmatic_compile_all',
    kind: 'read',
    description:
      '把上下文里所有着色器预编译一遍（特效 + realtime 算法 + 全部转场）。' +
      '着色器是惰性编译的，所以这是 agent 挂完一批特效后**唯一**能自查的手段。',
    args: {},
  },

  /* --------------------------------------------------------------- 写 */
  {
    name: 'artmatic_add_track',
    kind: 'write',
    description: '加一条轨道。新轨落在列表末尾（= z 最低 = 最底层）。',
    args: {
      kind: F.string({ required: true, enum: ['visual', 'audio'] }),
      name: F.string(),
    },
  },
  {
    name: 'artmatic_remove_track',
    kind: 'write',
    description: '删一条轨道（连同它的片段，一笔撤销）。',
    args: { trackId: ID('轨道') },
  },
  {
    name: 'artmatic_move_track',
    kind: 'write',
    description:
      '把轨道从 from 挪到 to 位。**轨道顺序就是合成顺序**：tracks[0] 在最前景（NLE 惯例）。',
    args: {
      from: F.integer({ required: true, minimum: 0 }),
      to: F.integer({ required: true, minimum: 0 }),
    },
  },
  {
    name: 'artmatic_set_track',
    kind: 'write',
    description: '改轨道的开关或名字。**关掉一条轨 = 它的画面整条不进合成**，做 A/B 时很有用。',
    args: {
      trackId: ID('轨道'),
      enabled: F.boolean(),
      name: F.string(),
    },
  },
  {
    name: 'artmatic_add_clip',
    kind: 'write',
    description:
      '加一个片段（一笔撤销）。kind:source 时其余字段按源类型取用；' +
      "kind:effect 时用 chain 给特效链（可同时给 defId 简写为单条链）。" +
      'params / 特效参数都会用**出厂默认值**补齐，只给想改的那几个。',
    args: {
      trackId: ID('轨道'),
      kind: F.string({ required: true, enum: ['algo', 'solid', 'image', 'video', 'text', 'effect'] }),
      start: t({ required: true }),
      end: t({ required: true }),
      id: F.string({ description: '显式 id（重放脚本的前提）。省略则生成。' }),
      label: F.string(),
      generator: F.string({ description: "kind:'algo' 的生成器 id。" }),
      params: F.scalars({ description: "kind:'algo' 的参数。" }),
      color: F.string({ description: "kind:'solid' 的颜色（#rrggbb）。" }),
      assetId: F.string({ description: "kind:'image' | 'video' 的素材 id。" }),
      srcIn: F.number({ description: "kind:'video' 的源内偏移（秒）。" }),
      speed: F.number({ description: "kind:'video' 的倍速。" }),
      doc: F.any({ description: "kind:'text' 的排版文档。" }),
      blend: F.string({ description: '混合模式，取值见 get_capabilities。' }),
      opacity: F.number(),
      transform: F.any({ description: '{ x, y, sx, sy, rot }，缺项取默认。' }),
      fit: F.string({ enum: ['contain', 'cover', 'stretch'] }),
      fadeSec: F.number({ minimum: 0 }),
      chain: F.any({ description: "kind:'effect' 的特效链：[{ defId, values? }]" }),
    },
  },
  {
    name: 'artmatic_add_effect_clip',
    kind: 'write',
    description:
      '加一个特效（调整层）片段。**只作用于它下方（z 更小）的轨道**；chain 按顺序执行。' +
      'affectDepth 限定只作用下方最近 N 条启用轨（0 = 全部）。',
    args: {
      trackId: ID('轨道'),
      start: t({ required: true }),
      end: F.number({ required: true, description: '秒。' }),
      chain: F.any({ description: 'effects 链：[{ defId, values? }]' }),
      label: F.string(),
      fadeSec: F.number({ minimum: 0 }),
      affectDepth: F.integer({ minimum: 0 }),
    },
  },
  {
    name: 'artmatic_remove_clip',
    kind: 'write',
    description: '删一个片段（一笔撤销；用户在时间轴上按 Delete 是同一条路）。',
    args: { clipId: ID('片段') },
  },
  {
    name: 'artmatic_move_clip',
    kind: 'write',
    description: '移动片段到另一条轨道的 newStart。落点被重叠策略拒绝时整次不动（conflict）。',
    args: {
      clipId: ID('片段'),
      targetTrackId: ID('轨道'),
      newStart: t({ required: true }),
    },
  },
  {
    name: 'artmatic_resize_clip',
    kind: 'write',
    description:
      "拖一条边到 time。**start 边会推进 srcIn**（trim-in 语义：裁掉的就是素材头部）。",
    args: {
      clipId: ID('片段'),
      edge: F.string({ required: true, enum: ['start', 'end'] }),
      time: t({ required: true }),
    },
  },
  {
    name: 'artmatic_split_clip',
    kind: 'write',
    description: '在 at（秒）处切开。返回左右两段的 id（右半段是新的）。',
    args: { clipId: ID('片段'), at: t({ required: true }) },
  },
  {
    name: 'artmatic_set_clip_props',
    kind: 'write',
    description: '改片段属性。可写字段只有 label / fadeSec / blend / opacity / transform / fit。',
    args: {
      clipId: ID('片段'),
      patch: F.any({ required: true, description: '{ label?, fadeSec?, blend?, opacity?, transform?, fit? }' }),
    },
  },
  {
    name: 'artmatic_set_params',
    kind: 'write',
    description: '改参数。target:source 走源的参数表（algo 的生成器参数 / solid 的颜色），target:effect 走特效链第 chainIndex 条的 values。',
    args: {
      clipId: ID('片段'),
      target: F.string({ required: true, enum: ['source', 'effect'] }),
      chainIndex: F.integer({ minimum: 0, description: "target:'effect' 时要给。" }),
      params: F.scalars({ required: true }),
    },
  },
  {
    name: 'artmatic_set_curve',
    kind: 'write',
    description:
      '设 / 删一条关键帧曲线。param 的合法取值与片段类型有关，' +
      '（源：opacity / transform.* / algo 的 range 参数；特效：`<instanceId>.<参数>`；音频：gain）。curve 传 null 即删除。',
    args: {
      clipId: ID('片段'),
      param: F.string({ required: true }),
      curve: F.curve({ required: false }),
    },
  },
  {
    name: 'artmatic_add_effect',
    kind: 'write',
    description: '往特效片段的链里插一条特效（默认值自动补齐）。',
    args: {
      clipId: ID('特效片段'),
      defId: F.string({ required: true }),
      values: F.scalars(),
      index: F.integer({ minimum: 0, description: '插入位置，省略 = 追加到末尾。' }),
    },
  },
  {
    name: 'artmatic_remove_effect',
    kind: 'write',
    description: '从特效链里删掉一条（下标按 get_clip 给的 chain 顺序）。',
    args: { clipId: ID('特效片段'), chainIndex: F.integer({ required: true, minimum: 0 }) },
  },
  {
    name: 'artmatic_reorder_effect',
    kind: 'write',
    description: '重排特效链。**顺序有语义**：链后的特效吃到链前的结果。',
    args: {
      clipId: ID('特效片段'),
      from: F.integer({ required: true, minimum: 0 }),
      to: F.integer({ required: true, minimum: 0 }),
    },
  },
  {
    name: 'artmatic_set_transition',
    kind: 'write',
    description: '设出画转场（窗口以 clip.end 为中心，作用于**同轨紧邻的下一个 source 片段**）。',
    args: {
      clipId: ID('片段'),
      defId: F.string({ required: true }),
      duration: F.number({ required: true, minimum: 0.01 }),
      values: F.scalars(),
    },
  },
  {
    name: 'artmatic_clear_transition',
    kind: 'write',
    description: '删掉片段上的出画转场（A/B 时用它做对照）。',
    args: { clipId: ID('片段') },
  },
  {
    name: 'artmatic_set_project',
    kind: 'write',
    description: '改工程级参数（fps / resolution / duration / beatGrid / overlapBehavior）。',
    args: {
      fps: F.number(),
      resolution: F.size(),
      duration: F.number({ minimum: 0.1 }),
      beatGrid: F.any({ description: '{ bpm?, offset?, beatsPerBar? }' }),
      overlapBehavior: F.string({ enum: ['push', 'reject', 'trim'] }),
    },
  },
  {
    name: 'artmatic_load_scene',
    kind: 'write',
    description:
      '整体改写（路径 B）：传一份完整 Project（纯 JSON）。会先迁移 + 校验，' +
      '走 loadFrom ⇒ **整次只有一笔撤销**。生成式创作 / 批量重排用它。',
    args: { project: F.any({ required: true }) },
  },
  {
    name: 'artmatic_begin_transaction',
    kind: 'write',
    description: '开一段事务：后续所有写操作合成**一笔**撤销。写「一组改动」之前调它。',
    args: {},
  },
  {
    name: 'artmatic_commit_transaction',
    kind: 'write',
    description: '结束事务。label 会写进撤销记录。',
    args: { label: F.string() },
  },
  {
    name: 'artmatic_cancel_transaction',
    kind: 'write',
    description: '回滚整段事务（回到 begin 之前的状态）。',
    args: {},
  },
  {
    name: 'artmatic_undo',
    kind: 'write',
    description: '撤销一步（用户在界面上按 Ctrl+Z 是同一条路）。',
    args: {},
  },
  {
    name: 'artmatic_redo',
    kind: 'write',
    description: '重做一步（撤销之后想再试一次时用）。',
    args: {},
  },

  /* ---------------------------------------------------------- 看 / 导 */
  {
    name: 'artmatic_frame_signature',
    kind: 'view',
    description:
      '一帧的**数值指纹**（逐通道均值 + 分块均值 + 点采样 + 结构跨度）。' +
      '判断「改对没改对」默认用它 —— 一张 PNG 输入约合上千 token，指纹只有几十个数字。',
    args: {
      t: t(),
      size: F.size({ description: '默认 320×宽（小尺寸更快）。' }),
      grid: F.integer({ minimum: 1, maximum: 16, description: '分块数，默认 4。' }),
    },
  },
  {
    name: 'artmatic_render_frame',
    kind: 'view',
    description: '出图（PNG）。**只在需要「看」的时候用**：审美判断 / 最终验收 / 给人看。',
    args: { t: t(), size: F.size({ description: '默认工程分辨率。' }) },
  },
  {
    name: 'artmatic_export',
    kind: 'export',
    description:
      '导出到磁盘。**区间用帧号**（左闭右开）。' +
      '走的是与导出面板完全相同的驱动循环（硬约束 1.1：预览与导出同一条求值路径）。',
    args: {
      format: F.string({ required: true, enum: ['mp4', 'png', 'gif'] }),
      frameRange: F.frameRange({ description: '{ from, to } 帧号，左闭右开。' }),
      size: F.size({ description: '默认工程分辨率；GIF 默认 480 宽。' }),
      frameStep: F.integer({ minimum: 1, description: '抽帧步进，默认 1。' }),
      outPath: F.string({ description: '落盘路径。省略则写系统临时目录。' }),
    },
  },
  {
    name: 'artmatic_open_project',
    kind: 'project',
    description:
      "打开一份工程。给 name 走 OPFS（headless 驱动用），不给则弹系统目录选择器（需要用户手势）。",
    args: { name: F.string() },
  },
  {
    name: 'artmatic_save_project',
    kind: 'project',
    description: '保存当前工程到它的目录句柄。未绑定目录时会失败（不是「另存为」）。',
    args: {},
  },

  /* ------------------------------------------------------- 说明（按需取） */
  {
    name: 'artmatic_help',
    kind: 'read',
    description:
      '取一份说明：plugin-api（插件怎么写：着色器头 / 参数类型 / 派发规则 / 例子）|' +
      'timeline | typography | workflow | images。写插件之前先取 plugin-api。',
    args: { topic: F.string({ description: '主题名。省略 = 可用清单。' }) },
  },

  /* ------------------------------------------------------------ 排版 */
  {
    name: 'artmatic_get_typography_capabilities',
    kind: 'read',
    description: '排版能力：图形种类（及各自的专属参数）、22 个程序化生成器、配色方案、填充形态、布局操作。',
    args: {},
  },
  {
    name: 'artmatic_get_typography_doc',
    kind: 'read',
    description:
      '读文本片段的排版文档。detail:\'ids\' 只给元素 id / 类型 / 框，full 还给样式、填充、文本与生成器状态。' +
      '省略 clipId 时用排版编辑器当前打开的那份。',
    args: {
      clipId: F.string({ description: '文本片段 id；省略 = 当前打开的排版文档。' }),
      detail: F.string({ enum: ['ids', 'full'] }),
    },
  },
  {
    name: 'artmatic_typo_add_element',
    kind: 'write',
    description:
      '加排版元素。element.kind 决定形态：text{text,frame?,style?,fill?,boxFill?,boxStroke?} |' +
      'shape{shape,frame?,fill?,stroke?,radius?,sides?,waist?,inner?,angle?,path?} |' +
      'image{assetId,frame?,fit?,crop?}。frame = {x,y,w,h,rot}（文档 px，左上原点）。',
    args: {
      clipId: F.string(),
      element: F.any({ required: true, description: '元素对象（见 description）。' }),
    },
  },
  {
    name: 'artmatic_typo_add_generated_shape',
    kind: 'write',
    description: '插入一个程序化 SVG 生成器（环 / 条码 / 等高线…）。参数与种子决定图案，之后就是普通图形元素。',
    args: {
      clipId: F.string(),
      genId: F.string({ required: true }),
      params: F.scalars(),
      seed: F.integer({ description: '32 位无符号种子。' }),
      frame: F.any({ description: '{x,y,w,h,rot}。' }),
      name: F.string(),
      fill: F.any(),
      stroke: F.any(),
    },
  },
  {
    name: 'artmatic_typo_update_element',
    kind: 'write',
    description:
      '改一个元素：name / frame / blend / opacity / visible / locked / text / style / fill / boxFill /' +
      'boxStroke / stroke / radius / sides / waist / inner / angle / evenOdd / fit / crop / gen。',
    args: {
      clipId: F.string(),
      elementId: F.string({ required: true }),
      patch: F.any({ required: true }),
    },
  },
  {
    name: 'artmatic_typo_set_text',
    kind: 'write',
    description: '替换元素的文本（丢弃旧的逐段格式）。',
    args: { clipId: F.string(), elementId: F.string({ required: true }), text: F.string({ required: true }) },
  },
  {
    name: 'artmatic_typo_remove_element',
    kind: 'write',
    description: '从排版文档里删掉一个元素（一笔撤销；组合会在写库后自动收口）。',
    args: { clipId: F.string(), elementId: F.string({ required: true }) },
  },
  {
    name: 'artmatic_typo_reorder_element',
    kind: 'write',
    description: '调层级：front | back | forward | backward（数组下标即 z 序）。',
    args: {
      clipId: F.string(),
      elementId: F.string({ required: true }),
      op: F.string({ required: true, enum: ['front', 'back', 'forward', 'backward'] }),
    },
  },
  {
    name: 'artmatic_typo_group',
    kind: 'write',
    description: '成组（成员共享背景 / 边框外壳；在数组里变成连续一段）。',
    args: {
      clipId: F.string(),
      elementIds: F.stringArray({ required: true }),
      name: F.string(),
    },
  },
  {
    name: 'artmatic_typo_ungroup',
    kind: 'write',
    description: '解组（只影响这些元素所在的组）。',
    args: { clipId: F.string(), elementIds: F.stringArray({ required: true }) },
  },
  {
    name: 'artmatic_typo_layout',
    kind: 'write',
    description:
      '排版布局：align（axis + target canvas|selection）| distribute（axis h|v，至少 3 个）|' +
      'grid（cols, rows?, gap?, margin?）| row | column。省略 elementIds = 所有未锁定元素。',
    args: {
      clipId: F.string(),
      op: F.string({ required: true, enum: ['align', 'distribute', 'grid', 'row', 'column'] }),
      axis: F.string(),
      target: F.string({ enum: ['canvas', 'selection'] }),
      elementIds: F.stringArray(),
      cols: F.integer({ minimum: 1 }),
      rows: F.integer({ minimum: 1 }),
      gap: F.number({ minimum: 0 }),
      margin: F.number({ minimum: 0 }),
    },
  },
  {
    name: 'artmatic_typo_set_background',
    kind: 'write',
    description: '文档背景（Paint：none | solid | linear | radial | texture）。',
    args: { clipId: F.string(), paint: F.any({ required: true }) },
  },
  {
    name: 'artmatic_typo_set_theme',
    kind: 'write',
    description: '切配色方案；用 @slot 引用的元素会自动换色。theme 传 null = 默认方案。',
    args: { clipId: F.string(), theme: F.string() },
  },
  {
    name: 'artmatic_typo_replace_doc',
    kind: 'write',
    description: '整体替换文档（一笔撤销）。坏元素整条丢弃而不是整次失败 —— 看返回的 dropped。',
    args: { clipId: F.string(), doc: F.any({ required: true }) },
  },

  /* ------------------------------------------------------------ 插件 */
  {
    name: 'artmatic_plugin_try',
    kind: 'write',
    description:
      '校验 + 载入内存 + 真 GL 编译一个单文件插件（**不写盘**）。返回限定 id 与结构化 issue，' +
      '模型据此自修复后再次调用（同一个 id 会热替换草稿）。',
    args: {
      id: F.string({ required: true, description: '[a-z0-9][a-z0-9._-]*' }),
      name: F.string({ required: true }),
      source: F.string({ required: true, description: '完整 ESM 源码（export const plugin = …）。' }),
    },
  },
  {
    name: 'artmatic_plugin_install',
    kind: 'write',
    description:
      '把试挂中的插件写进工程 plugins/。**需要用户确认**：不传 confirm 时返回 code=needs-approval，' +
      '面板上点「安装」之后页面内会带 confirm=true 再调一次。',
    args: {
      pluginId: F.string({ required: true }),
      confirm: F.boolean({ description: '页面内审批后由界面传 true；MCP 客户端不要自己传。' }),
    },
  },
  {
    name: 'artmatic_plugin_list',
    kind: 'read',
    description: '已安装插件（状态 / 条目数 / issue / 是否有草稿）。',
    args: {},
  },
  {
    name: 'artmatic_plugin_discard',
    kind: 'write',
    description: '丢弃内存里的草稿（不删已安装的文件）。',
    args: { pluginId: F.string({ required: true }) },
  },
  {
    name: 'artmatic_plugin_remove',
    kind: 'write',
    description: '摘注册表 + 删工程目录里的插件文件。',
    args: { pluginId: F.string({ required: true }) },
  },
  {
    name: 'artmatic_plugin_source',
    kind: 'read',
    description: '取当前草稿源码（给审批 / 对比用）。',
    args: { pluginId: F.string({ required: true }) },
  },
];

export const TOOL_BY_NAME = new Map(TOOLS.map((tool) => [tool.name, tool]));

/** `tools/list` 的返回体。 */
export function listToolDescriptors() {
  return TOOLS.map((tool) => ({
    name: tool.name,
    description: tool.description,
    inputSchema: buildSchema(tool.args),
  }));
}

/**
 * M3 的守卫（方案 §8）：**网关的 schema 校验**。
 *
 * 这一层守得住的东西很具体：非法 `defId`、越界 `frameRange`、拼错的参数名。
 * 为什么值得守：这三类错在浏览器里都不会崩 —— 拼错的参数被静默当成默认值、
 * 拼错的特效 id 要等到它被挂上画面才报（着色器是惰性编译的）、越界的区间会被
 * `runExport` 悄悄夹一次。三种都是「看起来成功」的失败，而那正是 agent 最难
 * 自查的一类。校验逻辑是纯函数，所以在 Node 里就能钉死。
 *
 * 网关是 `.mjs`（Node 直接跑 `.ts` 不可靠，见 `mcp/tools.d.mts` 的注释）。
 */

import { describe, expect, it } from 'vitest';
import {
  TOOLS,
  TOOL_BY_NAME,
  buildSchema,
  checkFrameRange,
  checkIdInList,
  listToolDescriptors,
  validateArgs,
  type ToolSpec,
} from '../../mcp/tools.mjs';

const tool = (name: string): ToolSpec => {
  const t = TOOL_BY_NAME.get(name);
  if (!t) throw new Error(`没有工具 ${name}`);
  return t;
};

function expectFail(result: ReturnType<typeof validateArgs>): { code: string; message: string; detail?: unknown } {
  if (result.ok) throw new Error(`期望校验失败，实际通过：${JSON.stringify(result.value)}`);
  return result.error;
}

/* --------------------------------------------------------------- 入参校验 */

describe('validateArgs —— 形状与枚举', () => {
  it('缺必需参数时报错，并点名是哪一个', () => {
    const err = expectFail(validateArgs(tool('artmatic_remove_clip'), {}));
    expect(err.code).toBe('invalid-argument');
    expect(err.message).toContain('clipId');
  });

  it('不认识的参数名必须报错（拼错一个字母不许静默取默认值）', () => {
    const err = expectFail(validateArgs(tool('artmatic_remove_clip'), { clipID: 'x' }));
    expect(err.code).toBe('invalid-argument');
    expect((err.detail as { unknown: string[] }).unknown).toEqual(['clipID']);
    // 合法清单要一并给出，agent 才能改对
    expect((err.detail as { known: string[] }).known).toContain('clipId');
  });

  it('枚举之外的取值被拒', () => {
    expect(expectFail(validateArgs(tool('artmatic_get_scene'), { detail: 'everything' })).code).toBe(
      'invalid-argument',
    );
    expect(expectFail(validateArgs(tool('artmatic_export'), { format: 'webm' })).code).toBe('invalid-argument');
  });

  it('size 必须是非负整数对的 { w, h }（1px 的 buffer 在渲染层是未定义行为）', () => {
    const t = tool('artmatic_frame_signature');
    expect(validateArgs(t, { size: { w: 320, h: 180 } }).ok).toBe(true);
    expect(expectFail(validateArgs(t, { size: { w: 3.5, h: 180 } })).message).toContain('整数');
    expect(expectFail(validateArgs(t, { size: { w: 1, h: 180 } })).message).toContain('至少');
    expect(expectFail(validateArgs(t, { size: { w: 320 } })).message).toContain('h');
  });

  it('frameRange 是**帧号**、左闭右开（to > from）', () => {
    const t = tool('artmatic_export');
    expect(validateArgs(t, { format: 'mp4', frameRange: { from: 0, to: 30 } }).ok).toBe(true);
    expect(expectFail(validateArgs(t, { format: 'mp4', frameRange: { from: 0, to: 0 } })).message).toContain('to');
    expect(expectFail(validateArgs(t, { format: 'mp4', frameRange: { from: -1, to: 30 } })).message).toContain('负');
    expect(expectFail(validateArgs(t, { format: 'mp4', frameRange: { from: 0, to: 1.5 } })).message).toContain('整数');
  });

  it('scalars 只收有限数字与字符串（NaN 会在 uniform 写入时静默变 0）', () => {
    const t = tool('artmatic_set_params');
    const base = { clipId: 'c', target: 'source' };
    expect(validateArgs(t, { ...base, params: { zoom: 1, color: '#fff' } }).ok).toBe(true);
    expect(expectFail(validateArgs(t, { ...base, params: { zoom: Number.NaN } })).message).toContain('有限');
    expect(expectFail(validateArgs(t, { ...base, params: { zoom: { a: 1 } } })).message).toContain('数字或字符串');
  });

  it('没给的参数不塞进 value（控制平面靠缺项走默认值）', () => {
    const r = validateArgs(tool('artmatic_get_scene'), {});
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error('应当通过');
    expect(Object.keys(r.value)).toEqual([]);
  });

  it('函数式字段被赋值 null 时不当成「没给」', () => {
    // set_curve 的 curve:null 是「删除这条曲线」的明确意图，不能被当成缺项
    const r = validateArgs(tool('artmatic_set_curve'), { clipId: 'c', param: 'opacity', curve: null });
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error('应当通过');
    expect(r.value.curve).toBeNull();
  });
});

/* ----------------------------------------------------------------- Schema */

describe('buildSchema —— 给 tools/list 的 JSON Schema', () => {
  it('required 与 additionalProperties:false 都在', () => {
    const schema = buildSchema(tool('artmatic_move_clip').args);
    expect(schema.required).toEqual(['clipId', 'targetTrackId', 'newStart']);
    expect(schema.additionalProperties).toBe(false);
  });

  it('frameRange 在 schema 里是整数对的 { from, to }（单位问题在客户端就可见）', () => {
    const schema = buildSchema(tool('artmatic_export').args);
    const props = schema.properties as Record<string, { items?: unknown; properties?: Record<string, { type: string }> }>;
    expect(props.frameRange!.properties!.from!.type).toBe('integer');
    expect(props.frameRange!.properties!.to!.type).toBe('integer');
  });

  it('每个工具的 schema 都能建出来（字段类型写错会在这里炸，而不是在运行期）', () => {
    for (const t of TOOLS) {
      expect(() => buildSchema(t.args), t.name).not.toThrow();
      expect(() => validateArgs(t, {}), t.name).not.toThrow();
    }
  });

  it('tools/list 的描述符与控制平面的工具一一对应', () => {
    const descriptors = listToolDescriptors();
    expect(descriptors).toHaveLength(TOOLS.length);
    const names = descriptors.map((d) => d.name);
    expect(new Set(names).size).toBe(names.length);
    for (const d of descriptors) {
      expect(d.description.length, d.name).toBeGreaterThan(10);
      expect(d.inputSchema.type, d.name).toBe('object');
    }
  });
});

/* ------------------------------------------------------- 需要外部事实的校验 */

describe('非法 defId 被拒（凭印象写 defId 是 agent 最常见的错）', () => {
  const effects = ['echo', 'slices', 'rgb-split'];
  const transitions = ['fade', 'CrossZoom'];

  it('不在清单里 → not-found，并把合法清单带回去', () => {
    const r = checkIdInList('ecoh', effects, '特效');
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error('应当失败');
    expect(r.error.code).toBe('not-found');
    expect(r.error.message).toContain('ecoh');
    expect((r.error.detail as { validIds: string[] }).validIds).toEqual(effects);
  });

  it('转场同一套判据（122 条第三方条目里挑错的概率更高）', () => {
    expect(checkIdInList('CrossZoom', transitions, '转场').ok).toBe(true);
    expect(checkIdInList('crosszoom', transitions, '转场').ok).toBe(false);
  });
});

describe('越界 frameRange 被拒', () => {
  it('from 超出工程帧数 → 报错并带回总帧数', () => {
    const r = checkFrameRange({ from: 300, to: 301 }, 300);
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error('应当失败');
    expect(r.error.detail).toEqual({ totalFrames: 300 });
  });

  it('to 超出工程帧数 → 报错（右端是**开**区间，to = total 是合法的）', () => {
    expect(checkFrameRange({ from: 0, to: 300 }, 300).ok).toBe(true);
    expect(checkFrameRange({ from: 299, to: 301 }, 300).ok).toBe(false);
  });

  it('没给区间就整段导，不校验', () => {
    expect(checkFrameRange(undefined, 300).ok).toBe(true);
  });
});

/* ------------------------------------------------------------ 清单完整性 */

describe('工具清单覆盖方案 §4 的表', () => {
  /** 方案 §4 列出的工具名。少一个就是「方案说了但没实现」。 */
  const REQUIRED = [
    'artmatic_describe',
    'artmatic_get_scene',
    'artmatic_get_capabilities',
    'artmatic_get_clip',
    'artmatic_list_projects',
    'artmatic_undo_state',
    'artmatic_add_clip',
    'artmatic_remove_clip',
    'artmatic_move_clip',
    'artmatic_resize_clip',
    'artmatic_split_clip',
    'artmatic_set_clip_props',
    'artmatic_set_params',
    'artmatic_set_curve',
    'artmatic_add_effect',
    'artmatic_remove_effect',
    'artmatic_reorder_effect',
    'artmatic_set_transition',
    'artmatic_clear_transition',
    'artmatic_add_track',
    'artmatic_remove_track',
    'artmatic_set_track',
    'artmatic_set_project',
    'artmatic_load_scene',
    'artmatic_begin_transaction',
    'artmatic_commit_transaction',
    'artmatic_undo',
    'artmatic_redo',
    'artmatic_render_frame',
    'artmatic_frame_signature',
    'artmatic_export',
    'artmatic_open_project',
    'artmatic_save_project',
    'artmatic_compile_all',
  ];

  it('一个不少', () => {
    const names = new Set(TOOLS.map((t) => t.name));
    expect(REQUIRED.filter((n) => !names.has(n))).toEqual([]);
  });

  it('全部带 artmatic_ 前缀（工具名前缀是方案 §4 的约定）', () => {
    for (const t of TOOLS) expect(t.name.startsWith('artmatic_'), t.name).toBe(true);
  });

  it('写类工具都明确标了 kind:write（撤销语义要能被一眼看出）', () => {
    const writeOnly = ['artmatic_undo', 'artmatic_redo', 'artmatic_begin_transaction'];
    for (const name of writeOnly) expect(tool(name).kind).toBe('write');
  });
});

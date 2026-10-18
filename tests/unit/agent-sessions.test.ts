/**
 * Agent 会话历史的两个不变量：
 *
 *  1. **坏数据不能把工程弄成打不开的**：清洗函数永不抛，逐条丢弃。
 *  2. **撤销栈不碰历史**：`ProjectStore` 的快照剔除 `agentSessions`、恢复时保留
 *     当前值 —— 否则用户按一次 Ctrl+Z 会把聊天记录一起退回去。
 */

import { describe, expect, it } from 'vitest';
import { sanitizeAgentSessions, validateProject, type AgentSessionRecord } from '../../src/core/schema';
import { ProjectStore } from '../../src/core/project-store';
import { createBlankProject } from '../../src/core/demo-project';

function session(id: string, updatedAt = 1): AgentSessionRecord {
  return {
    id,
    title: `会话 ${id}`,
    createdAt: 1,
    updatedAt,
    messages: [{ role: 'user', text: '你好' }],
  };
}

describe('sanitizeAgentSessions', () => {
  it('非数组 / 坏条目直接丢弃，不抛', () => {
    expect(sanitizeAgentSessions(null)).toEqual([]);
    expect(sanitizeAgentSessions('x')).toEqual([]);
    expect(
      sanitizeAgentSessions([
        { id: '', messages: [] },
        { id: 'a', messages: 'nope' },
        { id: 'b', messages: [{ role: 'wat', text: 'x' }, { role: 'user', text: 'ok' }] },
      ]).map((s) => s.id),
    ).toEqual(['b']);
  });

  it('按 updatedAt 保留最近的 30 个', () => {
    const many = Array.from({ length: 40 }, (_, i) => session(`s${i}`, i));
    const out = sanitizeAgentSessions(many);
    expect(out).toHaveLength(30);
    expect(out[0]!.id).toBe('s39');
    expect(out.at(-1)!.id).toBe('s10');
  });

  it('同一 id 只留一条；单条文本与消息数有上限', () => {
    const out = sanitizeAgentSessions([
      { ...session('dup', 1) },
      { ...session('dup', 2) },
      {
        id: 'long',
        title: 't',
        createdAt: 0,
        updatedAt: 3,
        messages: Array.from({ length: 500 }, () => ({ role: 'assistant', text: 'x'.repeat(30_000) })),
      },
    ]);
    expect(out.map((s) => s.id)).toEqual(['long', 'dup']);
    expect(out[0]!.messages).toHaveLength(400);
    expect(out[0]!.messages[0]!.text).toHaveLength(20_000);
  });
});

describe('validateProject / ProjectStore', () => {
  it('合法会话随工程保留；坏会话不会让工程打不开', () => {
    const p = createBlankProject('sessions');
    p.agentSessions = [session('keep')];
    expect(validateProject(structuredClone(p)).agentSessions?.map((s) => s.id)).toEqual(['keep']);

    const bad = structuredClone(p) as unknown as { agentSessions: unknown };
    bad.agentSessions = [{ id: 'x' }];
    expect(validateProject(bad).agentSessions).toBeUndefined();
  });

  it('撤销不会退回会话历史（快照剔除该字段）', () => {
    const store = new ProjectStore(createBlankProject('undo-sessions'));
    store.commit('rename', (p) => (p.name = 'changed'));
    store.setAgentSessions([session('a'), session('b', 2)]);

    expect(store.project.name).toBe('changed');
    expect(store.project.agentSessions).toHaveLength(2);

    expect(store.undo()).toBe(true);
    expect(store.project.name).toBe('undo-sessions');
    // 历史保留（它不是「改动」）
    expect(store.project.agentSessions?.map((s) => s.id)).toEqual(['a', 'b']);

    expect(store.redo()).toBe(true);
    expect(store.project.name).toBe('changed');
  });
});

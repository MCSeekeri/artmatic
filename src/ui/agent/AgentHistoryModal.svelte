<script lang="ts">
  /**
   * AgentHistoryModal — 当前工程的 Agent 会话历史（只读）。
   *
   * 数据源是 `project.agentSessions`（随工程保存、可一键清空）。刻意**不做
   * 「载入并继续对话」**：续聊需要完整的 wire 消息（tool_calls / tool_call_id），
   * 那些存进工程既臃肿又容易和当前模型不兼容。这里只解决「翻回去看当时做了什么」。
   */
  import Modal from '../controls/Modal.svelte';
  import Button from '../controls/Button.svelte';
  import ConfirmDialog from '../ConfirmDialog.svelte';
  import IconButton from '../controls/IconButton.svelte';
  import Icon from '../Icon.svelte';
  import { agentState } from './agent-state.svelte';
  import { toolLabel } from './tool-labels';
  import { tr } from '../../i18n/index.svelte';
  import type { AgentSessionRecord, AgentStoredMessage } from '../../core/schema';

  interface Props {
    onclose: () => void;
  }
  const { onclose }: Props = $props();

  let query = $state('');
  let selectedId = $state<string | null>(null);
  let confirmingClear = $state(false);

  const sessions = $derived(agentState.history);

  const filtered = $derived.by(() => {
    const q = query.trim().toLowerCase();
    if (!q) return sessions;
    return sessions.filter(
      (s) =>
        s.title.toLowerCase().includes(q) ||
        s.messages.some((m) => m.text.toLowerCase().includes(q)),
    );
  });

  const selected = $derived(filtered.find((s) => s.id === selectedId) ?? filtered[0] ?? null);

  function fmtTime(ts: number): string {
    if (!ts) return '—';
    const d = new Date(ts);
    const pad = (n: number): string => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  function roleLabel(role: AgentStoredMessage['role']): string {
    switch (role) {
      case 'user':
        return tr('agent.historyRole.user');
      case 'assistant':
        return tr('agent.historyRole.assistant');
      case 'reasoning':
        return tr('agent.historyRole.reasoning');
      case 'tool':
        return tr('agent.historyRole.tool');
      case 'image':
        return tr('agent.historyRole.image');
      default:
        return tr('agent.historyRole.error');
    }
  }

  function entryTitle(m: AgentStoredMessage): string {
    if (m.role === 'tool') return m.toolName ? toolLabel(m.toolName) : tr('agent.historyRole.tool');
    return roleLabel(m.role);
  }

  function clearAll(): void {
    confirmingClear = false;
    agentState.clearHistory();
    selectedId = null;
  }

  function remove(s: AgentSessionRecord): void {
    agentState.deleteSession(s.id);
    if (selectedId === s.id) selectedId = null;
  }
</script>

<Modal title={tr('agent.history')} testid="agent-history-modal" width="wide" onclose={onclose}>
  <div class="history">
    <div class="list-col">
      <div class="search">
        <Icon name="search" size={12} />
        <input
          type="text"
          data-exempt
          spellcheck="false"
          data-testid="agent-history-search"
          placeholder={tr('agent.historySearch')}
          bind:value={query}
        />
        {#if sessions.length}
          <IconButton
            icon="trash"
            label={tr('agent.historyClear')}
            size="sm"
            testid="agent-history-clear"
            onclick={() => (confirmingClear = true)}
          />
        {/if}
      </div>

      {#if filtered.length === 0}
        <p class="empty">
          {query.trim() ? tr('agent.historyNoMatch') : tr('agent.historyEmpty')}
        </p>
      {:else}
        <div class="list">
          {#each filtered as s (s.id)}
            <div class="item" class:active={selected?.id === s.id}>
              <button
                type="button"
                class="item-main"
                data-testid="agent-history-item"
                onclick={() => (selectedId = s.id)}
              >
                <span class="item-title">{s.title || tr('agent.historyUntitled')}</span>
                <span class="item-meta">
                  {tr('agent.historyMeta', { n: s.messages.length, time: fmtTime(s.updatedAt) })}
                </span>
              </button>
              <IconButton
                icon="trash"
                label={tr('agent.historyDelete')}
                size="sm"
                testid="agent-history-delete"
                onclick={() => remove(s)}
              />
            </div>
          {/each}
        </div>
      {/if}
      <p class="note">{tr('agent.historyReadonly')}</p>
    </div>

    <div class="detail-col" data-testid="agent-history-detail">
      {#if selected}
        <div class="detail-head">
          <span class="detail-title">{selected.title || tr('agent.historyUntitled')}</span>
          <span class="detail-meta">{fmtTime(selected.updatedAt)}</span>
        </div>
        <div class="messages">
          {#each selected.messages as m, i (i)}
            <div class="entry {m.role}">
              <div class="entry-head">
                <span class="entry-role">{entryTitle(m)}</span>
                {#if m.role === 'tool' && m.toolStatus}
                  <span class="entry-status {m.toolStatus}">
                    {tr(m.toolStatus === 'error' ? 'agent.tool.error' : 'agent.tool.ok')}
                  </span>
                {/if}
                {#if m.ms !== undefined}<span class="entry-ms">{m.ms} ms</span>{/if}
              </div>
              {#if m.text}<div class="entry-text">{m.text}</div>{/if}
            </div>
          {/each}
        </div>
      {:else}
        <p class="empty">{tr('agent.historyEmpty')}</p>
      {/if}
    </div>
  </div>

  {#snippet footer()}
    <Button
      label={tr('agent.exportLog')}
      variant="ghost"
      testid="agent-history-export"
      onclick={() => agentState.exportLog()}
    />
    <Button label={tr('common.close')} variant="outline" testid="agent-history-close" onclick={onclose} />
  {/snippet}
</Modal>

{#if confirmingClear}
  <ConfirmDialog
    title={tr('agent.historyClearTitle')}
    message={tr('agent.historyClearBody', { n: sessions.length })}
    confirmLabel={tr('agent.historyClear')}
    cancelLabel={tr('common.cancel')}
    danger
    testid="agent-history-confirm-clear"
    onconfirm={clearAll}
    oncancel={() => (confirmingClear = false)}
  />
{/if}

<style>
  .history {
    display: grid;
    grid-template-columns: 260px minmax(0, 1fr);
    gap: var(--sp-4);
    min-height: 420px;
    max-height: 62vh;
  }
  .list-col {
    display: flex;
    flex-direction: column;
    min-height: 0;
    border-right: 1px solid var(--border);
    padding-right: var(--sp-3);
  }
  .search {
    display: flex;
    align-items: center;
    gap: var(--sp-2);
    flex-shrink: 0;
    padding: 2px var(--sp-2);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    color: var(--text-muted);
  }
  .search input {
    flex: 1;
    min-width: 0;
    height: 24px;
    background: transparent;
    border: none;
    color: var(--text-primary);
    font-family: inherit;
    font-size: 11px;
  }
  .search input:focus {
    outline: none;
  }
  .list {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    margin-top: var(--sp-2);
  }
  .item {
    display: flex;
    align-items: center;
    gap: 2px;
    border-radius: var(--radius-sm);
  }
  .item:hover {
    background: var(--surface-hover);
  }
  .item.active {
    background: var(--accent-weak);
  }
  .item-main {
    flex: 1;
    min-width: 0;
    padding: 5px var(--sp-2);
    background: transparent;
    border: none;
    color: var(--text-secondary);
    text-align: left;
    cursor: pointer;
  }
  .item-title {
    display: block;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--text-primary);
    font-size: var(--fs-sm);
  }
  .item-meta {
    display: block;
    margin-top: 1px;
    color: var(--text-muted);
    font-size: 10px;
    font-variant-numeric: tabular-nums;
  }
  .note {
    flex-shrink: 0;
    margin: var(--sp-2) 0 0;
    color: var(--text-muted);
    font-size: 10px;
    line-height: 1.5;
  }
  .empty {
    padding: var(--sp-4) var(--sp-2);
    color: var(--text-muted);
    font-size: 11px;
    line-height: 1.6;
  }
  .detail-col {
    display: flex;
    flex-direction: column;
    min-height: 0;
    min-width: 0;
  }
  .detail-head {
    display: flex;
    align-items: baseline;
    gap: var(--sp-2);
    flex-shrink: 0;
    padding-bottom: var(--sp-2);
    border-bottom: 1px solid var(--border);
  }
  .detail-title {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--text-primary);
    font-size: var(--fs-md);
    font-weight: 500;
  }
  .detail-meta {
    color: var(--text-muted);
    font-size: 10px;
    font-variant-numeric: tabular-nums;
  }
  .messages {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding-top: var(--sp-2);
  }
  .entry {
    padding: 4px var(--sp-2);
    border-left: 2px solid var(--border);
    margin-bottom: var(--sp-2);
  }
  .entry.user {
    border-left-color: var(--accent);
  }
  .entry.tool {
    border-left-color: var(--border-strong, var(--border));
  }
  .entry.error {
    border-left-color: var(--danger);
  }
  .entry-head {
    display: flex;
    align-items: center;
    gap: var(--sp-2);
    color: var(--text-muted);
    font-size: 10px;
  }
  .entry-role {
    color: var(--text-secondary);
  }
  .entry-status.ok {
    color: var(--success);
  }
  .entry-status.error {
    color: var(--danger);
  }
  .entry-ms {
    font-variant-numeric: tabular-nums;
  }
  .entry-text {
    margin-top: 2px;
    color: var(--text-primary);
    font-size: 11px;
    line-height: 1.55;
    white-space: pre-wrap;
    word-break: break-word;
    max-height: 220px;
    overflow-y: auto;
  }
</style>

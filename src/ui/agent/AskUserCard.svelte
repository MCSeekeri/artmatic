<script lang="ts">
  /**
   * AskUserCard — 模型通过 `ask_user` 暂停任务时的问题卡。
   *
   * 为什么不是「往输入框里塞一句提示」：模型在**等一个回答**，会话此刻是挂起
   * 状态。把问题做成流里的一张卡（带选项按钮与自由输入），回答路径唯一，
   * 也不会和用户下一句话混淆。
   */
  import Button from '../controls/Button.svelte';
  import type { AgentMessage } from './agent-state.svelte';
  import { agentState } from './agent-state.svelte';
  import { tr } from '../../i18n/index.svelte';

  interface Props {
    msg: AgentMessage;
  }
  const { msg }: Props = $props();

  let text = $state('');

  const answered = $derived(msg.answer !== undefined);
  const cancelled = $derived(msg.answer === null);

  function submit(value: string): void {
    const v = value.trim();
    if (!v) return;
    agentState.resolveAsk(v);
  }
</script>

<div class="ask" data-testid="agent-ask">
  <div class="title">{tr('agent.ask.title')}</div>
  <div class="question" data-testid="agent-ask-question">{msg.text}</div>

  {#if answered}
    <div class="result" data-testid="agent-ask-answer">
      {cancelled ? tr('agent.ask.cancelled') : msg.answer}
    </div>
  {:else}
    {#if msg.options?.length}
      <div class="options">
        {#each msg.options as opt (opt)}
          <button type="button" class="option" data-testid="agent-ask-option" onclick={() => submit(opt)}>
            {opt}
          </button>
        {/each}
      </div>
    {/if}
    {#if msg.allowFreeText !== false}
      <div class="input-row">
        <input
          type="text"
          data-exempt
          spellcheck="false"
          data-testid="agent-ask-input"
          placeholder={tr('agent.ask.placeholder')}
          bind:value={text}
          onkeydown={(e) => {
            if (e.isComposing) return;
            if (e.key === 'Enter') {
              e.preventDefault();
              submit(text);
            }
          }}
        />
        <Button
          label={tr('agent.ask.submit')}
          variant="accent"
          size="sm"
          disabled={!text.trim()}
          testid="agent-ask-submit"
          onclick={() => submit(text)}
        />
        <Button
          label={tr('agent.ask.cancel')}
          variant="ghost"
          size="sm"
          testid="agent-ask-cancel"
          onclick={() => agentState.resolveAsk(null)}
        />
      </div>
    {/if}
  {/if}
</div>

<style>
  .ask {
    flex: 0 0 auto;
    padding: var(--sp-2) var(--sp-3);
    border: 1px solid var(--border);
    border-left: 2px solid var(--accent);
    border-radius: var(--radius-sm);
    background: var(--surface-1);
  }
  .title {
    margin-bottom: 2px;
    color: var(--text-muted);
    font-size: 10px;
    letter-spacing: 0.06em;
    text-transform: uppercase;
  }
  .question {
    color: var(--text-primary);
    font-size: var(--fs-sm);
    line-height: 1.55;
    white-space: pre-wrap;
  }
  .options {
    display: flex;
    flex-wrap: wrap;
    gap: var(--sp-2);
    margin-top: var(--sp-2);
  }
  .option {
    padding: 3px var(--sp-3);
    background: var(--surface-2);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    color: var(--text-secondary);
    font-size: 11px;
    cursor: pointer;
  }
  .option:hover {
    border-color: var(--accent);
    color: var(--accent);
  }
  .input-row {
    display: flex;
    align-items: center;
    gap: var(--sp-2);
    margin-top: var(--sp-2);
  }
  input {
    flex: 1;
    min-width: 0;
    height: 24px;
    padding: 0 var(--sp-2);
    background: var(--surface-0);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    color: var(--text-primary);
    font-family: inherit;
    font-size: 11px;
  }
  input:focus {
    outline: none;
    border-color: var(--accent);
  }
  .result {
    margin-top: var(--sp-1);
    padding: 3px var(--sp-2);
    border-radius: 3px;
    background: var(--surface-2);
    color: var(--text-secondary);
    font-size: 11px;
    white-space: pre-wrap;
  }
</style>

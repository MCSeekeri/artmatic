<script lang="ts">
  /**
   * ReasoningBlock — 模型的思考过程（`delta.reasoning_content`）。
   *
   * 生成中默认展开（用户能看见它在干什么），整轮结束自动折叠。
   * 这是**内部推理**，样式上刻意比回答弱一档（muted + 左侧竖线），
   * 免得被误读成「已经做完的事」。
   */
  import Icon from '../Icon.svelte';
  import { agentState } from './agent-state.svelte';
  import { tr } from '../../i18n/index.svelte';

  interface Props {
    text: string;
  }
  const { text }: Props = $props();

  let open = $state(agentState.busy);

  $effect(() => {
    if (!agentState.busy) open = false;
  });
</script>

<div class="reasoning" data-testid="agent-reasoning">
  <button type="button" class="head" onclick={() => (open = !open)} aria-expanded={open}>
    <Icon name="brain" size={11} />
    <span class="label">{tr('agent.reasoning')}</span>
    <span class="spacer"></span>
    <span class="caret"><Icon name={open ? 'chevron-down' : 'chevron-right'} size={11} /></span>
  </button>
  {#if open}
    <div class="text" data-testid="agent-reasoning-text">{text}</div>
  {/if}
</div>

<style>
  .reasoning {
    flex: 0 0 auto;
    border-left: 2px solid var(--border-strong, var(--border));
    padding-left: var(--sp-2);
  }
  .head {
    display: flex;
    align-items: center;
    gap: 4px;
    width: 100%;
    padding: 2px 0;
    background: transparent;
    border: none;
    color: var(--text-muted);
    font-size: 10px;
    text-align: left;
    cursor: pointer;
  }
  .head:hover {
    color: var(--text-secondary);
  }
  .label {
    color: var(--text-secondary);
    letter-spacing: 0.04em;
  }
  .spacer {
    flex: 1;
  }
  .caret {
    display: inline-flex;
  }
  .text {
    max-height: 220px;
    overflow-y: auto;
    padding: 2px var(--sp-2) var(--sp-2) 0;
    color: var(--text-muted);
    font-size: 10px;
    line-height: 1.55;
    white-space: pre-wrap;
    word-break: break-word;
  }
</style>

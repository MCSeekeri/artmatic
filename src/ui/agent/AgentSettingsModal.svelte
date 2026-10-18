<script lang="ts">
  /**
   * AgentSettingsModal — Agent 的模型 / Key / 行为设置。
   *
   * 结构与 `SettingsModal` 完全一致（左 navside + 右内容 + 底部动作），
   * 因为这两个面板是同一类东西：**设置**。堆成一长条会让「访问 / 模型 /
   * 行为 / 隐私」混在一起，找一项要滚半天。
   *
   * **挂在根级**（`App.svelte` 的 `.page` 上），不挂进 Agent 抽屉：
   * 抽屉是一个带 `z-index` 的层叠上下文，从它里面打开的 modal 会被困在那一层，
   * 右侧检查器（同 z）会盖住遮罩。根级还顺带保证「两个视图只有一个实例」。
   */
  import Modal from '../controls/Modal.svelte';
  import Button from '../controls/Button.svelte';
  import Field from '../controls/Field.svelte';
  import TextField from '../controls/TextField.svelte';
  import NumberInput from '../controls/NumberInput.svelte';
  import Checkbox from '../controls/Checkbox.svelte';
  import Select from '../controls/Select.svelte';
  import { agentState, type AgentEffort } from './agent-state.svelte';
  import { MAX_STEPS_LIMIT } from '../../agent/llm/index';
  import { tr } from '../../i18n/index.svelte';

  type Section = 'access' | 'model' | 'behavior' | 'security';
  let section = $state<Section>('access');

  const SECTIONS: { id: Section; labelKey: 'agent.access' | 'agent.modelSection' | 'agent.behavior' | 'agent.security' }[] = [
    { id: 'access', labelKey: 'agent.access' },
    { id: 'model', labelKey: 'agent.modelSection' },
    { id: 'behavior', labelKey: 'agent.behavior' },
    { id: 'security', labelKey: 'agent.security' },
  ];

  const EFFORTS: { value: AgentEffort; labelKey: 'agent.effort.off' | 'agent.effort.low' | 'agent.effort.high' | 'agent.effort.max' }[] = [
    { value: 'off', labelKey: 'agent.effort.off' },
    { value: 'low', labelKey: 'agent.effort.low' },
    { value: 'high', labelKey: 'agent.effort.high' },
    { value: 'max', labelKey: 'agent.effort.max' },
  ];

  function close(): void {
    agentState.closeSettings();
  }
</script>

<Modal
  title={tr('agent.settings')}
  testid="agent-settings-modal"
  width="tall"
  flushBody
  onclose={close}
>
  {#snippet footer()}
    <Button label={tr('agent.settingsDone')} variant="accent" testid="agent-settings-done" onclick={close} />
  {/snippet}

  <div class="set">
    <nav class="set-nav" aria-label={tr('agent.settings')} data-testid="agent-settings-nav">
      {#each SECTIONS as s (s.id)}
        <button
          type="button"
          class="set-nav-item"
          class:active={section === s.id}
          data-testid={`agent-settings-nav-${s.id}`}
          onclick={() => (section = s.id)}
        >
          {tr(s.labelKey)}
        </button>
      {/each}
    </nav>

    <div class="set-pane" data-testid="agent-settings-panel">
      {#if section === 'access'}
        <Field label={tr('agent.key')}>
          <input
            class="key-input"
            type="password"
            autocomplete="off"
            spellcheck="false"
            data-exempt
            data-testid="agent-key"
            placeholder="sk-…"
            value={agentState.apiKey}
            onchange={(e) => agentState.setApiKey((e.currentTarget as HTMLInputElement).value)}
          />
        </Field>
        <p class="hint">{tr('agent.keyHint')}</p>
        <div class="row">
          <Checkbox
            checked={agentState.prefs.sessionOnly}
            label={tr('agent.sessionOnly')}
            testid="agent-session-only"
            onchange={(v) => agentState.setPrefs({ sessionOnly: v })}
          />
          <span class="spacer"></span>
          <Button
            label={tr('agent.clearKey')}
            variant="ghost"
            testid="agent-clear-key"
            onclick={() => agentState.clearApiKey()}
          />
        </div>
      {:else if section === 'model'}
        <div class="row">
          <span class="lbl">{tr('agent.modelName')}</span>
          <div class="ctl">
            <TextField
              value={agentState.prefs.model}
              ariaLabel={tr('agent.modelName')}
              testid="agent-model"
              onchange={(v) => agentState.setPrefs({ model: v.trim() || 'deepseek-flash' })}
            />
          </div>
        </div>
        <div class="row">
          <span class="lbl">{tr('agent.baseUrl')}</span>
          <div class="ctl">
            <TextField
              value={agentState.prefs.baseUrl}
              ariaLabel={tr('agent.baseUrl')}
              testid="agent-base-url"
              onchange={(v) => agentState.setPrefs({ baseUrl: v.trim() || 'https://api.deepseek.com' })}
            />
          </div>
        </div>
        <p class="hint">{tr('agent.baseUrlHint')}</p>

        <div class="row">
          <span class="lbl">{tr('agent.effort')}</span>
          <div class="ctl">
            <Select
              value={agentState.prefs.effort}
              options={EFFORTS.map((e) => ({ value: e.value, label: tr(e.labelKey) }))}
              onchange={(v) => agentState.setPrefs({ effort: v })}
              ariaLabel={tr('agent.effort')}
              testid="agent-effort"
            />
          </div>
        </div>
        <p class="hint">{tr('agent.effortHint')}</p>

        <div class="row">
          <span class="lbl">{tr('agent.temperature')}</span>
          <div class="ctl narrow">
            <NumberInput
              value={agentState.prefs.temperature}
              min={0}
              max={2}
              step={0.1}
              testid="agent-temperature"
              onchange={(v) => agentState.setPrefs({ temperature: Math.max(0, Math.min(2, v)) })}
            />
          </div>
        </div>
        <p class="hint">{tr('agent.temperatureHint')}</p>
        <div class="row">
          <span class="lbl">{tr('agent.maxSteps')}</span>
          <div class="ctl narrow">
            <NumberInput
              value={agentState.prefs.maxSteps}
              min={1}
              max={MAX_STEPS_LIMIT}
              step={10}
              testid="agent-max-steps"
              onchange={(v) =>
                agentState.setPrefs({ maxSteps: Math.max(1, Math.min(MAX_STEPS_LIMIT, Math.round(v))) })}
            />
          </div>
        </div>
      {:else if section === 'behavior'}
        <Checkbox
          checked={agentState.prefs.screenshots}
          label={tr('agent.screenshots')}
          testid="agent-screenshots"
          onchange={(v) => agentState.setPrefs({ screenshots: v })}
        />
        <p class="hint">{tr('agent.screenshotsHint')}</p>
      {:else if section === 'security'}
        <p class="hint risk">{tr('agent.pluginRiskHint')}</p>
        <p class="hint">{tr('agent.privacyHint')}</p>
      {/if}
    </div>
  </div>
</Modal>

<style>
  /* navside 固定宽 + 内容列吃满；两者都必须能各自滚动/裁剪。 */
  .set {
    display: grid;
    grid-template-columns: 128px minmax(0, 1fr);
    width: 100%;
    min-width: 0;
    min-height: 0;
  }
  .set-nav {
    display: flex;
    flex-direction: column;
    gap: 1px;
    padding: var(--sp-4) var(--sp-3);
    background: var(--surface-2);
    border-right: 1px solid var(--border);
    overflow-y: auto;
  }
  .set-nav-item {
    padding: 5px var(--sp-4);
    background: transparent;
    border: none;
    border-radius: var(--radius-sm);
    color: var(--text-secondary);
    font-size: var(--fs-sm);
    text-align: left;
    cursor: pointer;
  }
  .set-nav-item:hover {
    background: var(--surface-hover);
    color: var(--text-primary);
  }
  .set-nav-item.active {
    background: var(--accent-weak);
    color: var(--accent);
  }
  .set-pane {
    min-width: 0;
    min-height: 0;
    overflow-y: auto;
    padding: var(--sp-5);
  }
  .row {
    display: flex;
    align-items: center;
    gap: var(--sp-4);
    margin-bottom: var(--sp-3);
  }
  .lbl {
    width: 108px;
    flex-shrink: 0;
    color: var(--text-secondary);
    font-size: var(--fs-sm);
  }
  .ctl {
    flex: 1;
    min-width: 0;
  }
  .ctl.narrow {
    max-width: 140px;
  }
  .key-input {
    width: 100%;
    height: 24px;
    padding: 0 var(--sp-2);
    background: var(--surface-0);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    color: var(--text-primary);
    font-family: 'Cascadia Code', Consolas, monospace;
    font-size: 11px;
  }
  .key-input:focus {
    outline: none;
    border-color: var(--accent);
  }
  .spacer {
    flex: 1;
  }
  .hint {
    margin: var(--sp-2) 0 var(--sp-4);
    color: var(--text-muted);
    font-size: var(--fs-xs);
    line-height: 1.55;
  }
  .hint.risk {
    padding-left: var(--sp-2);
    border-left: 2px solid var(--warning);
    color: var(--text-secondary);
  }
</style>

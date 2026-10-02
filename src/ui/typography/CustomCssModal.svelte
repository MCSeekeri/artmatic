<script lang="ts">
  /**
   * CustomCssModal — 手写 CSS 动画的唯一入口。
   *
   * 只收 **@keyframes 的体**（`from{opacity:0} to{opacity:1}`），不收整段 CSS。
   * 理由不是偷懒：允许顶层选择器的话，用户就能影响同页的其它元素（预览页里
   * 还有时间轴和面板）；`@import` 会外发请求破坏离线与确定性；`position:fixed`
   * 能让元素逃出快照区域，光栅化结果不可预测。限制成 keyframes 体之后，
   * 它只能影响被绑定的那个元素，而且注入点唯一。
   *
   * 校验在写入前做（sanitizeKeyframeBody 会剥掉 @import / 标签，并校验花括号
   * 配平）—— 非法代码绝不能进文档，否则用户会以为「保存成功了」。
   */
  import Modal from '../controls/Modal.svelte';
  import Button from '../controls/Button.svelte';
  import { isValidKeyframeBody, sanitizeKeyframeBody } from '../../typography/animation';
  import { tr } from '../../i18n/index.svelte';

  interface Props {
    /**
     * 初值用**函数**而不是字符串：弹窗每次打开都是新建的，所以这里要的是
     * 「打开那一刻的快照」。传字符串会让 Svelte 报「只捕获了初值」——
     * 那确实是我们想要的语义，但用函数表达出来更清楚，也不产生警告。
     */
    initialOf: () => string;
    onclose: () => void;
    /** 返回 false 表示代码非法。 */
    onsave: (css: string) => boolean;
  }
  const { initialOf, onclose, onsave }: Props = $props();

  // svelte-ignore state_referenced_locally -- 只取挂载那一刻的快照，正是意图
  let text = $state(initialOf());
  let error = $state<string | null>(null);

  const body = $derived(sanitizeKeyframeBody(text));

  function save(): void {
    if (!isValidKeyframeBody(text)) {
      error = tr('typo.customCssUnbalanced');
      return;
    }
    if (!onsave(body)) {
      error = tr('typo.customCssUnwritable');
      return;
    }
    onclose();
  }
</script>

<Modal title={tr('typo.customCssTitle')} onclose={onclose} testid="typo-css-modal" width="wide">
  <p class="hint">{tr('typo.customCssHintA')}<code>@keyframes</code>{tr('typo.customCssHintB')}<strong>{tr('typo.customCssHintC')}</strong>{tr('typo.customCssHintD')}<code>from&#123;opacity:0&#125;to&#123;opacity:1&#125;</code>{tr('typo.customCssHintE')}{tr('typo.customCssHintF')}<code>@import</code>{tr('typo.customCssHintG')}<code>position:fixed</code>{tr('typo.customCssHintH')}</p>

  <textarea
    class="code"
    spellcheck="false"
    bind:value={text}
    data-testid="typo-css-input"
    oninput={() => (error = null)}
  ></textarea>

  {#if error}
    <p class="err" data-testid="typo-css-error">{error}</p>
  {:else if !body}
    <p class="err">{tr('typo.customCssEmpty')}</p>
  {:else}
    <p class="ok">{tr('typo.customCssResult')}<code>@keyframes …&#123;{body}&#125;</code></p>
  {/if}

  <div class="acts">
    <Button label={tr('common.cancel')} testid="typo-css-cancel" onclick={onclose} />
    <Button label={tr('common.save')} variant="accent" testid="typo-css-save" onclick={save} />
  </div>
</Modal>

<style>
  .hint {
    margin: 0 0 var(--sp-4);
    font-size: var(--fs-sm);
    color: var(--text-secondary);
    line-height: 1.6;
  }
  code {
    font-family: ui-monospace, Consolas, monospace;
    font-size: var(--fs-sm);
    color: var(--text-primary);
  }
  .code {
    width: 100%;
    min-height: 140px;
    padding: var(--sp-3);
    background: var(--input-bg);
    border: 1px solid var(--input-border);
    border-radius: var(--radius-sm);
    color: var(--input-fg);
    font-family: ui-monospace, Consolas, monospace;
    font-size: var(--fs-md);
    line-height: 1.6;
    resize: vertical;
  }
  .code:focus {
    outline: 1px solid var(--border-focus);
    outline-offset: -1px;
  }
  .err {
    margin: var(--sp-3) 0 0;
    font-size: var(--fs-sm);
    color: var(--danger);
    line-height: 1.5;
  }
  .ok {
    margin: var(--sp-3) 0 0;
    font-size: var(--fs-sm);
    color: var(--text-muted);
    line-height: 1.5;
    word-break: break-all;
  }
  .acts {
    display: flex;
    justify-content: flex-end;
    gap: var(--sp-3);
    margin-top: var(--sp-5);
  }
</style>
